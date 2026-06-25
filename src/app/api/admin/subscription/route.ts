// POST /api/admin/subscription — admin manual subscription activate / deactivate
// (PR-C, Vsevolod: ручная активация/деактивация в админ-панели).
//
// Gated by the SAME admin allowlist as the /admin pages (getAdminUser → silent
// 404 for non-admins, never disclosing the endpoint). All money mutation +
// audit happens inside the security-definer RPCs (0012); this route only
// validates input and passes the acting admin's email for the audit trail.

import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import { isBillingTier } from "@/lib/billing";

export const runtime = "nodejs";
export const maxDuration = 15;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    // Mirror the pages' silent 404 — do not disclose the endpoint exists.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const adminEmail = admin.email ?? "unknown-admin";

  let body: {
    action?: unknown;
    userId?: unknown;
    tier?: unknown;
    period?: unknown;
    invoiceNo?: unknown;
    amount?: unknown;
    reason?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "invalid_user" }, { status: 400 });
  }

  const db = createSupabaseAdmin();

  if (body.action === "deactivate") {
    const reason =
      typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
    const { data, error } = await db.rpc("admin_deactivate_subscription", {
      p_user_id: userId,
      p_admin_email: adminEmail,
      p_reason: reason,
    });
    if (error) {
      console.error("[admin/subscription] deactivate failed", {
        userId,
        message: error.message,
      });
      return NextResponse.json({ error: "rpc_failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, result: data });
  }

  if (body.action === "activate") {
    const tier = typeof body.tier === "string" ? body.tier : "";
    if (!isBillingTier(tier)) {
      return NextResponse.json({ error: "invalid_tier" }, { status: 400 });
    }
    const periodMonths = body.period === "year" ? 12 : 1;
    const invoiceNo =
      typeof body.invoiceNo === "string" && body.invoiceNo.trim()
        ? body.invoiceNo.trim().slice(0, 100)
        : null;
    const amountNum =
      typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount >= 0
        ? body.amount
        : null;

    const { data, error } = await db.rpc("admin_activate_subscription", {
      p_user_id: userId,
      p_tier: tier,
      p_period_months: periodMonths,
      p_admin_email: adminEmail,
      p_invoice_no: invoiceNo,
      p_amount: amountNum,
    });
    if (error) {
      console.error("[admin/subscription] activate failed", {
        userId,
        tier,
        message: error.message,
      });
      return NextResponse.json({ error: "rpc_failed" }, { status: 502 });
    }
    const result = data as { ok?: boolean; reason?: string } | null;
    if (!result?.ok) {
      return NextResponse.json(
        { error: result?.reason ?? "activation_failed" },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, result });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
