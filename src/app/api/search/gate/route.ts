import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { assessDescription } from "@/lib/assess-description";

export const runtime = "nodejs";

const MIN_LEN_FOR_GEMINI = 150;

export async function POST(req: Request) {
  const limited = await rateLimit(req, {
    windowMs: 60_000,
    max: 30,
    keyPrefix: "gate",
  });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const description =
    typeof (body as { description?: unknown })?.description === "string"
      ? ((body as { description: string }).description).trim()
      : "";

  if (description.length < MIN_LEN_FOR_GEMINI) {
    return NextResponse.json({
      sufficient: false,
      reason: "too_short",
      skippedGemini: true,
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      sufficient: false,
      reason: "gemini_unavailable",
      skippedGemini: true,
    });
  }

  try {
    const result = await assessDescription(description, apiKey);
    return NextResponse.json({
      sufficient: result.sufficient,
      reason: result.reason,
      skippedGemini: false,
    });
  } catch {
    return NextResponse.json({
      sufficient: false,
      reason: "assess_failed",
      skippedGemini: false,
    });
  }
}
