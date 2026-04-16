import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { extractSearchTerms } from "@/lib/extract-search-terms";

export const runtime = "nodejs";

const TIMEOUT_MS = 30_000;

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

type PatSearchHit = {
  id?: string;
  biblio?: {
    ru?: { title?: string; abstract?: string };
    en?: { title?: string; abstract?: string };
  };
  common?: {
    publication_date?: string;
    classifications?: { ipc?: { fullname?: string }[] };
  };
};

type PatSearchResponse = {
  hits?: PatSearchHit[];
  total?: number;
};

function countryFromId(id: string): string {
  const m = /^([A-Z]{2})/.exec(id);
  return m ? m[1] : "";
}

function buildUrl(id: string, country: string): string {
  if (!id) return "";
  if (country === "RU") {
    const num = (/^RU(\d+)/.exec(id)?.[1]) ?? id.replace(/\D/g, "");
    return `https://new.fips.ru/registers-doc-view/fips_servlet?DB=RUPAT&DocNumber=${num}&TypeFile=html`;
  }
  return `https://searchplatform.rospatent.gov.ru/docs/${encodeURIComponent(id)}`;
}

function ipcSubclasses(codes: string[]): string[] {
  const out: string[] = [];
  for (const c of codes) {
    const head = c.trim().split(/[/\s]/, 1)[0];
    if (head && !out.includes(head)) out.push(head);
  }
  return out;
}

export async function POST(req: Request) {
  const rl = rateLimit(req, { windowMs: 60_000, max: 5, keyPrefix: "search" });
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

  let qn: string;
  let extractedIpc: string[] = [];
  try {
    const terms = await extractSearchTerms(query, geminiKey);
    qn = terms.qn;
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
  const datasets = (body.datasets && body.datasets.length > 0)
    ? body.datasets
    : DEFAULT_DATASETS;
  const ipcInput = body.ipcCodes && body.ipcCodes.length > 0
    ? body.ipcCodes
    : extractedIpc;
  const subclasses = ipcSubclasses(ipcInput);

  const payload: Record<string, unknown> = {
    qn,
    limit,
    offset: 0,
    datasets,
    include_facets: false,
    highlight: body.highlight ?? false,
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
    console.error("[search-rospatent] fetch failed", {
      name: e instanceof Error ? e.name : typeof e,
      message: e instanceof Error ? e.message : String(e),
      queryLen: query.length,
    });
    return NextResponse.json({ error: "Patent search service unavailable" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => "");
    console.error("[search-rospatent] non-ok response", {
      status: resp.status,
      statusText: resp.statusText,
      body: bodyText.slice(0, 500),
      queryLen: query.length,
      payload: JSON.stringify(payload).slice(0, 300),
    });
    return NextResponse.json({ error: "Patent search service error" }, { status: 502 });
  }

  const raw = (await resp.json()) as PatSearchResponse;
  const hits = (raw.hits ?? []).map((h) => {
    const id = h.id ?? "";
    const country = countryFromId(id);
    const pubDate = h.common?.publication_date ?? "";
    const ipc = (h.common?.classifications?.ipc ?? [])
      .map((c) => c.fullname ?? "")
      .filter(Boolean);
    const titleRu = h.biblio?.ru?.title?.trim() ?? "";
    const titleEn = h.biblio?.en?.title?.trim() ?? "";
    const abstract = (h.biblio?.ru?.abstract ?? h.biblio?.en?.abstract ?? "")
      .trim()
      .slice(0, 600);
    return {
      id,
      title: titleRu || titleEn,
      titleRu,
      titleEn,
      year: pubDate.slice(0, 4),
      country,
      ipc,
      url: buildUrl(id, country),
      abstract,
      source: "patsearch",
    };
  });

  return NextResponse.json({
    hits,
    total: raw.total ?? hits.length,
    usedQn: qn,
    usedIpc: subclasses,
  });
}
