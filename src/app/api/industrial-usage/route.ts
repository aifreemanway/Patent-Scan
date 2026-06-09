// Lazy-load endpoint for the Industrial Usage Layer (Feature 4).
//
// Called from the novelty report UI when a user expands the "Industrial Usage"
// section on a patent row. Returns a per-patent commercial map: canonical
// assignee + company profile + product mentions + competitor list + sources.
//
// Available on ALL tiers (Vsevolod 2026-06-09 — «IUL на всех тарифах, не Team+»).
// No quota charge — cost is ~₽1 per call on Gemini Flash, far below the threshold
// where per-call billing would be worth the friction. Per-IP rate limit caps
// abuse; the per-user toggle (/account/profile) can still hide the section.

import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { requireAuth } from "@/lib/auth-quota";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import { buildIndustrialUsage } from "@/lib/industrial-usage/pipeline";
import { RATE_WINDOW_MS } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request): Promise<NextResponse> {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: 20,
    keyPrefix: "industrial_usage",
  });
  if (rl) return rl;

  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  // Available on all tiers. We still load the per-user toggle so a user who
  // turned the section off in /account/profile gets the lock instead.
  const admin = createSupabaseAdmin();
  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("industrial_usage_enabled")
    .eq("id", guard.user.id)
    .single();
  if (profErr || !profile) {
    return NextResponse.json({ error: "profile_lookup_failed" }, { status: 500 });
  }
  // User-level toggle (set in /account/profile) lets a user hide the section
  // entirely. We still return 403 so the UI knows to render the lock.
  if (profile.industrial_usage_enabled === false) {
    return NextResponse.json(
      { error: "toggled_off", upsell: "Включите «Промышленное применение» в настройках профиля." },
      { status: 403 }
    );
  }

  let body: { patentId?: string; patentTitle?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const patentId = (body.patentId ?? "").trim();
  if (!patentId || !/^[A-Z]{2}[0-9A-Z_]+$/.test(patentId)) {
    return NextResponse.json({ error: "invalid_patent_id" }, { status: 400 });
  }

  const apiKey = process.env.TIMEWEB_AI_KEY;
  const patsearchToken = process.env.PATSEARCH_TOKEN;
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!apiKey || !patsearchToken || !tavilyKey) {
    return NextResponse.json({ error: "service_misconfigured" }, { status: 500 });
  }

  try {
    const report = await buildIndustrialUsage({
      patentId,
      patentTitle: body.patentTitle,
      apiKey,
      patsearchToken,
      tavilyKey,
    });
    return NextResponse.json(report);
  } catch (e) {
    console.error("[industrial-usage] pipeline error", {
      patentId,
      message: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "pipeline_error" }, { status: 502 });
  }
}
