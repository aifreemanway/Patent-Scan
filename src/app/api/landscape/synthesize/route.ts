import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import {
  synthesizeLandscape,
  type SynthesisPatent,
} from "@/lib/landscape-synthesize";
import {
  MAX_DESCRIPTION_LEN,
  MAX_PATENTS_SYNTHESIZE,
  RATE_WINDOW_MS,
  RATE_MAX,
} from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

type IncomingPatent = {
  id?: unknown;
  title?: unknown;
  year?: unknown;
  country?: unknown;
  ipc?: unknown;
  abstract?: unknown;
};

function normalize(p: IncomingPatent): SynthesisPatent | null {
  if (typeof p.id !== "string" || !p.id.trim()) return null;
  const ipc = Array.isArray(p.ipc)
    ? p.ipc.filter((x): x is string => typeof x === "string")
    : [];
  return {
    id: p.id.trim(),
    title: typeof p.title === "string" ? p.title.trim() : "",
    year: typeof p.year === "string" ? p.year.trim() : "",
    country: typeof p.country === "string" ? p.country.trim() : "",
    ipc,
    abstract:
      typeof p.abstract === "string" ? p.abstract.trim().slice(0, 200) : "",
  };
}

export async function POST(req: Request) {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.landscapeSynthesize,
    keyPrefix: "landscape-synthesize",
  });
  if (rl) return rl;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Service configuration error" },
      { status: 500 }
    );
  }

  let body: { topic?: string; patents?: IncomingPatent[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const topic = (body.topic ?? "").trim();
  if (topic.length < 40) {
    return NextResponse.json(
      { error: "topic must be at least 40 characters" },
      { status: 400 }
    );
  }
  if (topic.length > MAX_DESCRIPTION_LEN) {
    return NextResponse.json(
      { error: `topic must be at most ${MAX_DESCRIPTION_LEN} characters` },
      { status: 413 }
    );
  }

  if (!Array.isArray(body.patents) || body.patents.length === 0) {
    return NextResponse.json(
      { error: "patents must be a non-empty array" },
      { status: 400 }
    );
  }

  const seen = new Set<string>();
  const patents: SynthesisPatent[] = [];
  for (const raw of body.patents) {
    const n = normalize(raw);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    patents.push(n);
    if (patents.length >= MAX_PATENTS_SYNTHESIZE) break;
  }

  if (patents.length === 0) {
    return NextResponse.json(
      { error: "no valid patents in input" },
      { status: 400 }
    );
  }

  try {
    const result = await synthesizeLandscape(topic, patents, apiKey);
    return NextResponse.json({ topic, patentsUsed: patents.length, ...result });
  } catch (e) {
    console.error("[landscape-synthesize] failed", {
      message: e instanceof Error ? e.message : String(e),
      topicLen: topic.length,
      patentsLen: patents.length,
    });
    return NextResponse.json(
      { error: "Synthesis service failed" },
      { status: 502 }
    );
  }
}
