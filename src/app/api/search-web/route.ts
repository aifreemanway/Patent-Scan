import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const TIMEOUT_MS = 30_000;

const TAVILY_URL = "https://api.tavily.com/search";

const INCLUDE_DOMAINS = [
  "reddit.com",
  "news.ycombinator.com",
  "kickstarter.com",
  "indiegogo.com",
  "producthunt.com",
  "habr.com",
  "vc.ru",
  "github.com",
];

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
};

type TavilyResponse = {
  results?: TavilyResult[];
  answer?: string;
};

export async function POST(req: Request) {
  const rl = rateLimit(req, { windowMs: 60_000, max: 5, keyPrefix: "web" });
  if (rl) return rl;

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Service configuration error" }, { status: 500 });
  }

  let body: { query?: string; maxResults?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (query.length < 3) {
    return NextResponse.json(
      { error: "query must be at least 3 characters" },
      { status: 400 }
    );
  }

  const maxResults = Math.min(Math.max(body.maxResults ?? 10, 1), 20);

  const payload = {
    api_key: apiKey,
    query,
    search_depth: "advanced",
    include_answer: false,
    include_domains: INCLUDE_DOMAINS,
    max_results: maxResults,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch {
    return NextResponse.json({ error: "Web search service unavailable" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    return NextResponse.json({ error: "Web search service error" }, { status: 502 });
  }

  const raw = (await resp.json()) as TavilyResponse;
  const results = (raw.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 500),
    score: r.score ?? 0,
    publishedDate: r.published_date ?? "",
  }));

  return NextResponse.json({ results });
}
