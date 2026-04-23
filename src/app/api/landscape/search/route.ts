import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { requireAuth } from "@/lib/auth-quota";
import {
  normalizeHit,
  type PatSearchHit,
} from "@/lib/patsearch-normalize";
import {
  PATSEARCH_URL,
  PATSEARCH_TIMEOUT_MS,
  PATSEARCH_ABSTRACT_LIMIT,
  PATSEARCH_DATASETS_ALL,
  PATSEARCH_DATASETS_ALLOWED,
  MAX_QN_LEN,
  RATE_WINDOW_MS,
  RATE_MAX,
} from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

type PatSearchResponse = {
  hits?: PatSearchHit[];
  total?: number;
};

export async function POST(req: Request) {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.landscapeSearch,
    keyPrefix: "landscape-search",
  });
  if (rl) return rl;

  const token = process.env.PATSEARCH_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Service configuration error" }, { status: 500 });
  }

  let body: {
    qn?: string;
    ipcSubclasses?: string[];
    limit?: number;
    datasets?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const qn = (body.qn ?? "").trim();
  if (qn.length < 3) {
    return NextResponse.json({ error: "qn must be at least 3 characters" }, { status: 400 });
  }
  if (qn.length > MAX_QN_LEN) {
    return NextResponse.json(
      { error: `qn must be at most ${MAX_QN_LEN} characters` },
      { status: 413 }
    );
  }

  // Auth gate — landscape sub-calls aren't quota-charged (billed at plan step)
  // but still need login so we don't burn Rospatent budget on anonymous traffic.
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const limit = Math.min(Math.max(body.limit ?? 30, 1), 50);
  const userDatasets = Array.isArray(body.datasets)
    ? body.datasets.filter(
        (d): d is string => typeof d === "string" && PATSEARCH_DATASETS_ALLOWED.has(d)
      )
    : [];
  const datasets = userDatasets.length > 0 ? userDatasets : PATSEARCH_DATASETS_ALL;
  const subclasses = (body.ipcSubclasses ?? [])
    .filter((c) => typeof c === "string" && /^[A-H]\d{2}[A-Z]$/.test(c.trim()))
    .map((c) => c.trim());

  const payload: Record<string, unknown> = {
    qn,
    limit,
    offset: 0,
    datasets,
    include_facets: false,
    highlight: false,
  };
  if (subclasses.length > 0) {
    payload.filter = {
      "classification.ipc_subclass": { values: subclasses },
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PATSEARCH_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(PATSEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (e) {
    console.error("[landscape-search] fetch failed", {
      name: e instanceof Error ? e.name : typeof e,
      message: e instanceof Error ? e.message : String(e),
      qnLen: qn.length,
    });
    return NextResponse.json(
      { error: "Patent search service unavailable" },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => "");
    console.error("[landscape-search] non-ok response", {
      status: resp.status,
      body: bodyText.slice(0, 500),
      qnLen: qn.length,
    });
    return NextResponse.json(
      { error: "Patent search service error" },
      { status: 502 }
    );
  }

  const raw = (await resp.json()) as PatSearchResponse;
  const hits = (raw.hits ?? []).map((h) =>
    normalizeHit(h, { abstractLimit: PATSEARCH_ABSTRACT_LIMIT.landscape })
  );

  return NextResponse.json({
    qn,
    hits,
    total: raw.total ?? hits.length,
  });
}
