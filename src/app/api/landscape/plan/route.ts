import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { planLandscape } from "@/lib/landscape-plan";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TOPIC_LEN = 50_000;

export async function POST(req: Request) {
  const rl = await rateLimit(req, { windowMs: 60_000, max: 5, keyPrefix: "landscape-plan" });
  if (rl) return rl;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Service configuration error" }, { status: 500 });
  }

  let body: { topic?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const topic = (body.topic ?? "").trim();
  if (topic.length < 60) {
    return NextResponse.json(
      { error: "topic must be at least 60 characters" },
      { status: 400 }
    );
  }
  if (topic.length > MAX_TOPIC_LEN) {
    return NextResponse.json(
      { error: `topic must be at most ${MAX_TOPIC_LEN} characters` },
      { status: 413 }
    );
  }

  try {
    const plan = await planLandscape(topic, apiKey);
    return NextResponse.json({ topic, ...plan });
  } catch (e) {
    console.error("[landscape-plan] failed", {
      message: e instanceof Error ? e.message : String(e),
      topicLen: topic.length,
    });
    return NextResponse.json(
      { error: "Planning service failed" },
      { status: 502 }
    );
  }
}
