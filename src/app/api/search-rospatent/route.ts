import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { requireAuthAndQuota } from "@/lib/auth-quota";
import { extractSearchTerms } from "@/lib/extract-search-terms";
import {
  normalizeHit,
  resolveIdAndCountry,
  type NormalizedHit,
  type PatSearchHit,
} from "@/lib/patsearch-normalize";
import {
  PATSEARCH_URL,
  PATSEARCH_TIMEOUT_MS,
  PATSEARCH_ABSTRACT_LIMIT,
  PATSEARCH_DATASETS_RU,
  PATSEARCH_DATASETS_EN,
  PATSEARCH_DATASETS_ALLOWED,
  MAX_DESCRIPTION_LEN,
  RATE_WINDOW_MS,
  RATE_MAX,
} from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 90;

type PatSearchResponse = {
  hits?: PatSearchHit[];
  total?: number;
};

type EnrichedHit = NormalizedHit & { source: string };

function ipcSubclasses(codes: string[]): string[] {
  const out: string[] = [];
  for (const c of codes) {
    const head = c.trim().split(/[/\s]/, 1)[0];
    if (head && !out.includes(head)) out.push(head);
  }
  return out;
}

function normalizeHits(hits: PatSearchHit[]): EnrichedHit[] {
  return hits.map((h) => ({
    ...normalizeHit(h, { abstractLimit: PATSEARCH_ABSTRACT_LIMIT.search }),
    source: "patsearch",
  }));
}

async function searchPatSearch(
  payload: Record<string, unknown>,
  token: string,
  signal: AbortSignal,
  logTag: string
): Promise<{ ok: true; data: PatSearchResponse } | { ok: false }> {
  try {
    const resp = await fetch(PATSEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => "");
      console.error("[search-rospatent] non-ok response", {
        tag: logTag,
        status: resp.status,
        statusText: resp.statusText,
        body: bodyText.slice(0, 500),
        payload: JSON.stringify(payload).slice(0, 300),
      });
      return { ok: false };
    }
    const data = (await resp.json()) as PatSearchResponse;
    return { ok: true, data };
  } catch (e) {
    console.error("[search-rospatent] fetch failed", {
      tag: logTag,
      name: e instanceof Error ? e.name : typeof e,
      message: e instanceof Error ? e.message : String(e),
    });
    return { ok: false };
  }
}

export async function POST(req: Request) {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.searchRospatent,
    keyPrefix: "search",
  });
  if (rl) return rl;

  const token = process.env.PATSEARCH_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!token || !geminiKey) {
    return NextResponse.json({ error: "Service configuration error" }, { status: 500 });
  }

  let body: {
    query?: string;
    ipcCodes?: string[];
    limit?: number;
    datasets?: string[];
    highlight?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (query.length < 2) {
    return NextResponse.json(
      { error: "query must be at least 2 characters" },
      { status: 400 }
    );
  }
  if (query.length > MAX_DESCRIPTION_LEN) {
    return NextResponse.json(
      { error: `query must be at most ${MAX_DESCRIPTION_LEN} characters` },
      { status: 413 }
    );
  }

  // Auth + quota charge AFTER body validation, BEFORE Gemini term extraction.
  const guard = await requireAuthAndQuota("search");
  if (!guard.ok) return guard.response;

  let qn: string;
  let qnEn: string;
  let extractedIpc: string[] = [];
  try {
    const terms = await extractSearchTerms(query, geminiKey);
    qn = terms.qn;
    qnEn = terms.qnEn;
    extractedIpc = terms.ipcCodes;
  } catch (e) {
    console.error("[search-rospatent] term extraction failed", {
      message: e instanceof Error ? e.message : String(e),
      queryLen: query.length,
    });
    return NextResponse.json(
      { error: "Query preprocessing failed" },
      { status: 502 }
    );
  }

  const limit = Math.min(Math.max(body.limit ?? 10, 1), 50);
  const ipcInput = body.ipcCodes && body.ipcCodes.length > 0
    ? body.ipcCodes
    : extractedIpc;
  const subclasses = ipcSubclasses(ipcInput);
  const highlight = body.highlight ?? false;

  const filter = subclasses.length > 0
    ? { "classification.ipc_subclass": { values: subclasses } }
    : undefined;

  const userDatasets = Array.isArray(body.datasets)
    ? body.datasets.filter(
        (d): d is string => typeof d === "string" && PATSEARCH_DATASETS_ALLOWED.has(d)
      )
    : [];
  const useUserDatasets = userDatasets.length > 0;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PATSEARCH_TIMEOUT_MS);

  try {
    if (useUserDatasets) {
      const payload: Record<string, unknown> = {
        qn,
        limit,
        offset: 0,
        datasets: userDatasets,
        include_facets: false,
        highlight,
      };
      if (filter) payload.filter = filter;

      const result = await searchPatSearch(payload, token, ctrl.signal, "legacy");
      if (!result.ok) {
        return NextResponse.json(
          { error: "Patent search service error" },
          { status: 502 }
        );
      }
      const hits = normalizeHits(result.data.hits ?? []);
      return NextResponse.json({
        hits,
        total: result.data.total ?? hits.length,
        usedQn: qn,
        usedQnEn: qnEn,
        usedIpc: subclasses,
      });
    }

    const perBranchLimit = Math.max(Math.ceil(limit / 2), 5);

    const ruPayload: Record<string, unknown> = {
      qn,
      limit: perBranchLimit,
      offset: 0,
      datasets: PATSEARCH_DATASETS_RU,
      include_facets: false,
      highlight,
    };
    const enPayload: Record<string, unknown> = {
      qn: qnEn,
      limit: perBranchLimit,
      offset: 0,
      datasets: PATSEARCH_DATASETS_EN,
      include_facets: false,
      highlight,
    };
    if (filter) {
      ruPayload.filter = filter;
      enPayload.filter = filter;
    }

    const [ruResult, enResult] = await Promise.all([
      searchPatSearch(ruPayload, token, ctrl.signal, "ru"),
      searchPatSearch(enPayload, token, ctrl.signal, "en"),
    ]);

    if (!ruResult.ok && !enResult.ok) {
      return NextResponse.json(
        { error: "Patent search service error" },
        { status: 502 }
      );
    }

    const ruHits = ruResult.ok ? ruResult.data.hits ?? [] : [];
    const enHits = enResult.ok ? enResult.data.hits ?? [] : [];
    const ruTotal = ruResult.ok ? ruResult.data.total ?? ruHits.length : 0;
    const enTotal = enResult.ok ? enResult.data.total ?? enHits.length : 0;

    const seen = new Set<string>();
    const combined: PatSearchHit[] = [];
    for (const h of [...ruHits, ...enHits]) {
      const { id } = resolveIdAndCountry(h);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      combined.push(h);
    }
    const hits = normalizeHits(combined);

    return NextResponse.json({
      hits,
      total: ruTotal + enTotal,
      usedQn: qn,
      usedQnEn: qnEn,
      usedIpc: subclasses,
    });
  } finally {
    clearTimeout(timer);
  }
}
