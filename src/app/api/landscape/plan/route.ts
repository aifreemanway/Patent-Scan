import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { planLandscape } from "@/lib/landscape-plan";
import {
  MAX_DESCRIPTION_LEN,
  RATE_WINDOW_MS,
  RATE_MAX,
} from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.landscapePlan,
    keyPrefix: "landscape-plan",
  });
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
  if (topic.length > MAX_DESCRIPTION_LEN) {
    return NextResponse.json(
      { error: `topic must be at most ${MAX_DESCRIPTION_LEN} characters` },
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
