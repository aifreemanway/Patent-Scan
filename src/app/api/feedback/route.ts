// POST /api/feedback — user submits survey from the QuotaExceededBlock,
// gets +1 slot back for the operation they hit the limit on.
// One-time per (user, operation) — enforced by DB unique constraint + RPC.

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-quota";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import { validateFeedbackPayload } from "@/lib/feedback-schema";

export const runtime = "nodejs";
export const maxDuration = 10;

type GrantResult = {
  granted: boolean;
  reason?: "invalid_operation" | "already_granted";
  operation?: string;
  new_count?: number;
  period_start?: string;
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const validation = validateFeedbackPayload(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdmin();
  const { data, error } = await admin.rpc("grant_feedback_bonus", {
    p_user_id: auth.user.id,
    p_operation: validation.operation,
    p_answers: validation.answers,
  });

  if (error) {
    console.error("[feedback] rpc failed", {
      message: error.message,
      userId: auth.user.id,
      operation: validation.operation,
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const result = data as GrantResult | null;
  if (!result) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (!result.granted) {
    if (result.reason === "already_granted") {
      return NextResponse.json(
        { error: "already_granted", operation: validation.operation },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({
    granted: true,
    operation: validation.operation,
    new_count: result.new_count,
  });
}
