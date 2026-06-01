// GET /api/deep-analysis/[id]/status
// Polling endpoint for the async Deep Analysis flow (report page polls this
// every few seconds after submit). RLS scopes the row to the calling user.
//
// Returns the `result` jsonb (the verdict) once status='completed', so the
// client renders straight from the poll response — no second fetch needed.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-quota";

export const runtime = "nodejs";
export const maxDuration = 5;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const { createSupabaseServer } = await import("@/lib/supabase-server");
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from("search_requests")
    .select("id, type, status, result, error_message, created_at")
    .eq("id", id)
    .eq("type", "deep_analysis")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[deep-analysis/status] db error", { id, message: error.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(data);
}
