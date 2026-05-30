// GET /api/literature-review/[id]/status
// Lightweight polling endpoint for /literature-review/processing. RLS scopes
// the row to the calling user automatically.

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

  // Use the user-scoped client so RLS does the auth check on the row's user_id.
  const { createSupabaseServer } = await import("@/lib/supabase-server");
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from("search_requests")
    .select("id, type, status, stage, progress_pct, result_pdf_url, error_message, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[litreview/status] db error", { id, message: error.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(data);
}
