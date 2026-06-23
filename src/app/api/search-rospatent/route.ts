import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { spendGuard, perUserSpendGuard } from "@/lib/spend-guard";
import { requireAuth } from "@/lib/auth-quota";
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

// Full IPC group, e.g. "G01R31/34" (no internal space). The precise
// classification.ipc filter — the documented working field (root CLAUDE.md,
// and what landscape/search uses). A truncated subclass head ("G01R31") sent
// to classification.ipc_subclass returns total=0 (verified 2026-06-02), so we
// prefer full codes; a valid 4-char subclass ("G01R") is only a fallback.
const IPC_GROUP_RE = /^[A-H]\d{2}[A-Z]\d{1,4}\/\d{1,6}$/;
const IPC_SUBCLASS_RE = /^[A-H]\d{2}[A-Z]$/;

function ipcGroups(codes: string[]): string[] {
  const out = new Set<string>();
  for (const c of codes) {
    const g = c.replace(/\s+/g, "");
    if (IPC_GROUP_RE.test(g)) out.add(g);
  }
  return [...out];
}

function ipcSubclasses(codes: string[]): string[] {
  const out = new Set<string>();
  for (const c of codes) {
    const head = c.replace(/\s+/g, "").slice(0, 4);
    if (IPC_SUBCLASS_RE.test(head)) out.add(head);
  }
  return [...out];
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
  const paused = await spendGuard();
  if (paused) return paused;
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.searchRospatent,
    keyPrefix: "search",
  });
  if (rl) return rl;

  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  // Per-user daily spend breaker (СЛОЙ-2) — after requireAuth (needs user.id).
  const overBudget = await perUserSpendGuard(guard.user.id, guard.tier);
  if (overBudget) return overBudget;

  const token = process.env.PATSEARCH_TOKEN;
  const geminiKey = process.env.TIMEWEB_AI_KEY;
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

  let qn: string;
  let qnEn: string;
  let extractedIpc: string[] = [];
  try {
    const terms = await extractSearchTerms(query, geminiKey, undefined, undefined, guard.user.id);
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
  const fullGroups = ipcGroups(ipcInput);
  const subclasses = ipcSubclasses(ipcInput);
  const highlight = body.highlight ?? false;

  // Prefer the precise classification.ipc group filter; fall back to a valid
  // 4-char subclass. (The old code truncated "G01R31/34"→"G01R31" into
  // classification.ipc_subclass, which PatSearch returns 0 for — dead filter.)
  const filter = fullGroups.length > 0
    ? { "classification.ipc": { values: fullGroups } }
    : subclasses.length > 0
      ? { "classification.ipc_subclass": { values: subclasses } }
      : undefined;
  const usedIpc = fullGroups.length > 0 ? fullGroups : subclasses;

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
        usedIpc,
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
      usedIpc,
    });
  } finally {
    clearTimeout(timer);
  }
}
