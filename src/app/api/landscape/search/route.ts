import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import {
  normalizeHit,
  type PatSearchHit,
} from "@/lib/patsearch-normalize";

export const runtime = "nodejs";
export const maxDuration = 60;

const TIMEOUT_MS = 30_000;
const ABSTRACT_LIMIT = 400;

const PATSEARCH_URL =
  "https://searchplatform.rospatent.gov.ru/patsearch/v0.2/search";
const DEFAULT_DATASETS = [
  "ru_since_1994",
  "ru_till_1994",
  "cis",
  "us",
  "ep",
  "jp",
  "cn",
];

type PatSearchResponse = {
  hits?: PatSearchHit[];
  total?: number;
};

export async function POST(req: Request) {
  const rl = rateLimit(req, { windowMs: 60_000, max: 20, keyPrefix: "landscape-search" });
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

  const limit = Math.min(Math.max(body.limit ?? 30, 1), 50);
  const datasets =
    body.datasets && body.datasets.length > 0 ? body.datasets : DEFAULT_DATASETS;
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
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

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
    normalizeHit(h, { abstractLimit: ABSTRACT_LIMIT })
  );

  return NextResponse.json({
    qn,
    hits,
    total: raw.total ?? hits.length,
  });
}
