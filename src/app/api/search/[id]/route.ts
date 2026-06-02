// GET /api/search/[id]
// Fetch a single saved search request (any type) by id so the report pages can
// REBUILD from search_requests.result when re-opened from /account/history —
// sessionStorage is empty in a fresh session, which used to show "Нет данных".
//
// RLS scopes the row to the calling user (createSupabaseServer uses the user's
// JWT), so a user can only read their own requests — no extra owner-check needed.
// Soft-deleted rows are excluded. Returns the same `result` jsonb the live flow
// stored, so the client hydrates the identical view object.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-quota";

export const runtime = "nodejs";
export const maxDuration = 10;

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
    .select(
      "id, type, status, topic, result, error_message, progress_pct, created_at"
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[search/:id] db error", { id, message: error.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(data);
}
