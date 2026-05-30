// POST /api/literature-review/[id]/retry
// Only valid for rows in status='error'. Re-charges the literature_review
// quota (the previous run was refunded when it errored), resets retry_count,
// and flips the row back to 'pending' so the worker picks it up.

import { NextResponse } from "next/server";
import {
  requireAuth,
} from "@/lib/auth-quota";
import { checkAndChargeQuota } from "@/lib/quota";
import { createSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  // Confirm ownership + current status via RLS-scoped read.
  const { createSupabaseServer } = await import("@/lib/supabase-server");
  const supabase = await createSupabaseServer();
  const { data: row, error: readErr } = await supabase
    .from("search_requests")
    .select("id, status, type")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (readErr) {
    console.error("[litreview/retry] read error", { id, message: readErr.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.type !== "literature_review") {
    return NextResponse.json({ error: "wrong_type" }, { status: 400 });
  }
  if (row.status !== "error") {
    return NextResponse.json({ error: "not_in_error_state", status: row.status }, { status: 409 });
  }

  // Re-charge quota. The previous run's slot was refunded when status flipped
  // to error, so this is a fresh charge — the user is consuming their monthly
  // allotment again.
  const quota = await checkAndChargeQuota(auth.user.id, "literature_review");
  if (!quota.ok) {
    if (quota.reason === "quota_exceeded") {
      return NextResponse.json(
        {
          error: "quota_exceeded",
          tier: quota.tier,
          limit: quota.limit,
          used: quota.used,
          operation: "literature_review",
        },
        { status: 402 }
      );
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const admin = createSupabaseAdmin();
  const { error: updErr } = await admin
    .from("search_requests")
    .update({
      status: "pending",
      retry_count: 0,
      error_message: null,
      progress_pct: 0,
      stage: null,
      started_at: null,
      completed_at: null,
      // Reset notify_error so a future failure can send the email again
      notify_error_sent_at: null,
    })
    .eq("id", id);

  if (updErr) {
    console.error("[litreview/retry] update error", { id, message: updErr.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ id, status: "pending" });
}
