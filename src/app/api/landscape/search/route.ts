import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { requireAuthCached } from "@/lib/auth-quota";
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

  const guard = await requireAuthCached();
  if (!guard.ok) return guard.response;

  const token = process.env.PATSEARCH_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Service configuration error" }, { status: 500 });
  }

  let body: {
    qn?: string;
    ipcSubclasses?: string[];
    ipcGroups?: string[];
    limit?: number;
    offset?: number;
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

  const limit = Math.min(Math.max(body.limit ?? 30, 1), 50);
  // Offset enables depth-pagination of a class-sweep beyond the first page:
  // the novelty class-sweep walks a high-value subclass (e.g. G01R, ~65k docs)
  // limit×N pages deep to surface in-class analogs past the top-30. PatSearch
  // caps `available` at 1000, so clamp accordingly. Defaults to 0 → existing
  // single-page callers are unchanged.
  const offset = Math.min(Math.max(body.offset ?? 0, 0), 1000);
  const userDatasets = Array.isArray(body.datasets)
    ? body.datasets.filter(
        (d): d is string => typeof d === "string" && PATSEARCH_DATASETS_ALLOWED.has(d)
      )
    : [];
  const datasets = userDatasets.length > 0 ? userDatasets : PATSEARCH_DATASETS_ALL;
  const subclasses = (body.ipcSubclasses ?? [])
    .filter((c) => typeof c === "string" && /^[A-H]\d{2}[A-Z]$/.test(c.trim()))
    .map((c) => c.trim());
  // Full IPC group, e.g. "C21C5/46" (no space). A group filter is far more
  // precise than a subclass and is what makes the prior-art class-sweep
  // surface in-class analogs that semantic ranking alone buries.
  const groups = (body.ipcGroups ?? [])
    .filter(
      (g) => typeof g === "string" && /^[A-H]\d{2}[A-Z]\d{1,4}\/\d{1,6}$/.test(g.trim())
    )
    .map((g) => g.trim());

  const payload: Record<string, unknown> = {
    qn,
    limit,
    offset,
    datasets,
    include_facets: false,
    highlight: false,
  };
  if (groups.length > 0) {
    payload.filter = { "classification.ipc": { values: groups } };
  } else if (subclasses.length > 0) {
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
