import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { spendGuard, perUserSpendGuard } from "@/lib/spend-guard";
import { requireAuthCached } from "@/lib/auth-quota";
import { decomposeFacets } from "@/lib/facet-decompose";
import { MAX_DESCRIPTION_LEN, RATE_WINDOW_MS, RATE_MAX } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

// Facet decomposition stage (P2 full-depth novelty retrieval). Splits a verbose
// invention into atomic technical facets so each becomes a separate semantic
// probe. Same auth/rate shape as /api/landscape/plan; one Gemini call.
export async function POST(req: Request) {
  const paused = await spendGuard();
  if (paused) return paused;
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.facetDecompose,
    keyPrefix: "facet-decompose",
  });
  if (rl) return rl;

  const guard = await requireAuthCached();
  if (!guard.ok) return guard.response;

  // Per-user daily spend breaker (СЛОЙ-2) — after requireAuth (needs user.id).
  const overBudget = await perUserSpendGuard(guard.user.id, guard.tier);
  if (overBudget) return overBudget;

  const apiKey = process.env.TIMEWEB_AI_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Service configuration error" }, { status: 500 });
  }

  let body: { invention?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const invention = (body.invention ?? "").trim();
  if (invention.length < 60) {
    return NextResponse.json(
      { error: "invention must be at least 60 characters" },
      { status: 400 }
    );
  }
  if (invention.length > MAX_DESCRIPTION_LEN) {
    return NextResponse.json(
      { error: `invention must be at most ${MAX_DESCRIPTION_LEN} characters` },
      { status: 413 }
    );
  }

  try {
    const facets = await decomposeFacets(invention, apiKey, undefined, guard.user.id);
    return NextResponse.json({ facets });
  } catch (e) {
    console.error("[facet-decompose] failed", {
      message: e instanceof Error ? e.message : String(e),
      inventionLen: invention.length,
    });
    return NextResponse.json({ error: "Facet decomposition failed" }, { status: 502 });
  }
}
