// POST /api/billing/invoice-request — «Оплата по счёту» (B2B, design §4b).
//
// This is the PRIMARY checkout path (Vsevolod: приоритет на оплату по счёту) and
// it is SAFE regardless of BILLING_LIVE: it moves no money automatically. It is a
// заявка — the user picks a tier + period, we email support@ with the request +
// confirm to the user, then Vsevolod issues an invoice OUTSIDE the system and
// activates the subscription manually via /admin (subscriptions 0010). No 54-ФЗ
// receipt here — the closing document is the УПД, generated outside the system
// (ba handoff 2026-06-09).
//
// Authed-only: the modal lives in /account/billing, so the user is logged in and
// email-verified — no Turnstile needed (the account is the anti-abuse anchor).

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-quota";
import { rateLimit } from "@/lib/rate-limit";
import { sendTransactionalEmail } from "@/lib/resend";
import { invoicePlan, tierLabel, type BillingPeriod } from "@/lib/billing";
import { RATE_WINDOW_MS } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 15;

const SUPPORT_INBOX = "support@patent-scan.com";

type Body = {
  tier?: unknown;
  period?: unknown;
  name?: unknown; // ФИО или название компании
  inn?: unknown;
  phone?: unknown;
};

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatRub(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n) + " ₽";
}

export async function POST(req: Request) {
  // Rate-limit — 5 заявок / 10 минут с одного IP (anti-spam backstop; the auth
  // gate is the real anchor).
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS * 10,
    max: 5,
    keyPrefix: "billing-invoice-request",
  });
  if (rl) return rl;

  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const period: BillingPeriod = body.period === "year" ? "year" : "month";
  const plan = invoicePlan(asString(body.tier), period);
  if (!plan) return NextResponse.json({ error: "invalid_tier" }, { status: 400 });

  const name = asString(body.name);
  const inn = asString(body.inn);
  const phone = asString(body.phone);
  const email = guard.user.email ?? "";

  // Validation — name + a usable account email are required; inn/phone optional.
  if (!name || name.length > 300) {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }
  if (inn && !/^\d{10,12}$/.test(inn)) {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }
  if (phone) {
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.length < 7 || digits.length > 15) {
      return NextResponse.json({ error: "invalid_format" }, { status: 400 });
    }
  }

  const periodRu = period === "year" ? "Год" : "Месяц";
  const subject = `[Счёт] ${tierLabel(plan.tier)} (${periodRu}) — ${name}`;

  const rows: Array<[string, string]> = [
    ["Тариф", tierLabel(plan.tier)],
    ["Период", periodRu],
    ["Сумма к счёту", formatRub(plan.amountRub)],
    ["Период (мес)", String(plan.periodMonths)],
    ["ФИО / компания", name],
    ["ИНН", inn || "—"],
    ["Email аккаунта", email],
    ["Телефон", phone || "—"],
    ["user_id", guard.user.id],
  ];
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;color:#475569;">${esc(k)}</td><td style="padding:6px 12px;color:#0f172a;font-weight:500;">${esc(v)}</td></tr>`
    )
    .join("");
  const internalHtml = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;padding:24px;">
    <h2 style="margin-top:0;">Заявка на счёт (подписка)</h2>
    <table style="border-collapse:collapse;margin-bottom:16px;">${rowsHtml}</table>
    <p style="color:#64748b;font-size:13px;">Выставить счёт по реквизитам, после оплаты — активировать тариф в /admin → пользователи → этот аккаунт → Активировать подписку. Закрывающий = УПД (вне системы).</p>
  </body></html>`;
  const internalText = [
    "Заявка на счёт (подписка)",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "После оплаты активировать тариф в /admin. Закрывающий = УПД (вне системы).",
  ].join("\n");

  const internal = await sendTransactionalEmail({
    to: SUPPORT_INBOX,
    subject,
    html: internalHtml,
    text: internalText,
  });
  if (!internal.ok) {
    console.error("[billing/invoice-request] support notification failed", {
      userId: guard.user.id,
      tier: plan.tier,
      error: internal.error,
    });
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  // Confirmation to the requester (best-effort — the request is already captured).
  const confHtml = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;padding:24px;max-width:600px;">
    <h2 style="margin-top:0;">Заявка на счёт получена</h2>
    <p>Здравствуйте, ${esc(name)}.</p>
    <p>Мы получили заявку на тариф <strong>${esc(tierLabel(plan.tier))}</strong> (${esc(periodRu.toLowerCase())}, ${esc(formatRub(plan.amountRub))}). Выставим счёт по указанным реквизитам и пришлём его на этот email. Доступ к тарифу откроется после поступления оплаты.</p>
    <p>Если что-то срочно — отвечайте на это письмо или пишите на <a href="mailto:support@patent-scan.com">support@patent-scan.com</a>.</p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">— Команда ПатентСкан</p>
  </body></html>`;
  const confText = [
    `Здравствуйте, ${name}.`,
    "",
    `Мы получили заявку на тариф ${tierLabel(plan.tier)} (${periodRu.toLowerCase()}, ${formatRub(plan.amountRub)}). Выставим счёт по указанным реквизитам и пришлём его на этот email. Доступ к тарифу откроется после поступления оплаты.`,
    "",
    "Если что-то срочно — отвечайте на это письмо или пишите на support@patent-scan.com.",
    "",
    "— Команда ПатентСкан",
  ].join("\n");
  await sendTransactionalEmail({
    to: email,
    subject: "Заявка на счёт ПатентСкан получена",
    html: confHtml,
    text: confText,
  });

  return NextResponse.json({ ok: true });
}
