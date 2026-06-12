// POST /api/enterprise/request — приём заявок с /enterprise.
//
// Не привязан к auth (юзер ещё не зарегистрирован). Поток: Turnstile-verify →
// rate-limit по IP → email на support@patent-scan.com с реквизитами лида +
// confirmation на email самого лида. В БД пока не пишем — добавим
// enterprise_leads таблицу когда появится sales pipeline.
//
// Per ap-marketing B5-outreach-templates: SLA 24ч после получения брифа.

import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { sendTransactionalEmail } from "@/lib/resend";
import { RATE_WINDOW_MS } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 15;

const SUPPORT_INBOX = "support@patent-scan.com";

type Body = {
  fullName?: unknown;
  position?: unknown;
  organization?: unknown;
  inn?: unknown;
  email?: unknown;
  phone?: unknown;
  topic?: unknown;
  marketingConsent?: unknown;
  turnstileToken?: unknown;
  locale?: unknown;
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Rate limit — 5 заявок / 10 минут с одного IP.
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS * 10,
    max: 5,
    keyPrefix: "enterprise_request",
  });
  if (rl) return rl;

  // 2. Body parse.
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const fullName = asString(body.fullName);
  const position = asString(body.position);
  const organization = asString(body.organization);
  const inn = asString(body.inn);
  const email = asString(body.email).toLowerCase();
  const phone = asString(body.phone);
  const topic = asString(body.topic);
  const marketingConsent = body.marketingConsent === true;
  const turnstileToken = asString(body.turnstileToken);

  // 3. Validation.
  if (!fullName || !position || !organization || !email || !topic) {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }
  if (inn && !/^\d{10,12}$/.test(inn)) {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }
  // Phone is optional; if present, require 7-15 digits (E.164 minimum
  // significantly trims junk submissions per BUG-ENT-PHONE 2026-05-31:
  // user could submit "1" and the form accepted it because the client
  // pattern was missing).
  if (phone) {
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.length < 7 || digits.length > 15) {
      return NextResponse.json({ error: "invalid_format" }, { status: 400 });
    }
  }
  if (topic.length > 4000) {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }

  // 4. Turnstile.
  const captcha = await verifyTurnstile(turnstileToken, clientIp(req));
  if (!captcha.ok) {
    const code =
      captcha.reason === "missing_token" ? "captcha_missing" : "captcha_failed";
    return NextResponse.json({ error: code }, { status: 400 });
  }

  // 5. Send internal notification on support@.
  const ip = clientIp(req) ?? "unknown";
  const internalHtml = renderInternalHtml({
    fullName,
    position,
    organization,
    inn,
    email,
    phone,
    topic,
    marketingConsent,
    ip,
  });
  const internalText = renderInternalText({
    fullName,
    position,
    organization,
    inn,
    email,
    phone,
    topic,
    marketingConsent,
    ip,
  });

  const internal = await sendTransactionalEmail({
    to: SUPPORT_INBOX,
    subject: `[Enterprise lead] ${organization} — ${fullName}`,
    html: internalHtml,
    text: internalText,
  });

  if (!internal.ok) {
    // If we can't notify support, the lead is effectively lost — surface an
    // error to the user so they retry, instead of pretending success.
    console.error("[enterprise/request] support notification failed", {
      organization,
      email,
      error: internal.error,
    });
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  // 6. Send confirmation to the lead (best-effort — if it fails the lead is
  // already captured on support@, so we still return ok).
  const confirmationHtml = renderConfirmationHtml({ fullName });
  const confirmationText = renderConfirmationText({ fullName });
  await sendTransactionalEmail({
    to: email,
    subject: "Заявка на демо-обзор Patent-Scan получена",
    html: confirmationHtml,
    text: confirmationText,
  });

  return NextResponse.json({ ok: true });
}

type LeadFields = {
  fullName: string;
  position: string;
  organization: string;
  inn: string;
  email: string;
  phone: string;
  topic: string;
  marketingConsent: boolean;
  ip: string;
};

function renderInternalHtml(f: LeadFields): string {
  const rows: Array<[string, string]> = [
    ["ФИО", f.fullName],
    ["Должность", f.position],
    ["Организация", f.organization],
    ["ИНН", f.inn || "—"],
    ["Email", f.email],
    ["Телефон", f.phone || "—"],
    ["Маркетинг-согласие", f.marketingConsent ? "да" : "нет"],
    ["IP", f.ip],
  ];
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;color:#475569;">${esc(k)}</td><td style="padding:6px 12px;color:#0f172a;font-weight:500;">${esc(v)}</td></tr>`
    )
    .join("");
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;padding:24px;">
    <h2 style="margin-top:0;">Заявка с /enterprise</h2>
    <table style="border-collapse:collapse;margin-bottom:16px;">${rowsHtml}</table>
    <h3 style="margin-bottom:8px;">Тема обзора</h3>
    <div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;color:#1e293b;">${esc(f.topic)}</div>
    <p style="margin-top:24px;color:#64748b;font-size:12px;">SLA: 24 часа на ответ. Reply-To указан на email лида — отвечай прямо в этом письме.</p>
  </body></html>`;
}

function renderInternalText(f: LeadFields): string {
  return [
    "Заявка с /enterprise",
    "",
    `ФИО: ${f.fullName}`,
    `Должность: ${f.position}`,
    `Организация: ${f.organization}`,
    `ИНН: ${f.inn || "—"}`,
    `Email: ${f.email}`,
    `Телефон: ${f.phone || "—"}`,
    `Маркетинг-согласие: ${f.marketingConsent ? "да" : "нет"}`,
    `IP: ${f.ip}`,
    "",
    "Тема обзора:",
    f.topic,
    "",
    "SLA: 24 часа на ответ.",
  ].join("\n");
}

function renderConfirmationHtml({ fullName }: { fullName: string }): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;padding:24px;max-width:600px;">
    <h2 style="margin-top:0;">Заявка получена</h2>
    <p>Здравствуйте, ${esc(fullName)}.</p>
    <p>Спасибо за интерес к Patent-Scan. Мы получили вашу заявку на демо-обзор и свяжемся с вами в течение <strong>24 часов</strong>: уточним детали по теме и согласуем 30-минутный созвон по результатам.</p>
    <p>Если что-то срочно — отвечайте на это письмо или пишите на <a href="mailto:support@patent-scan.com">support@patent-scan.com</a>.</p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">— Команда Patent-Scan</p>
  </body></html>`;
}

function renderConfirmationText({ fullName }: { fullName: string }): string {
  return [
    `Здравствуйте, ${fullName}.`,
    "",
    "Спасибо за интерес к Patent-Scan. Мы получили вашу заявку на демо-обзор и свяжемся с вами в течение 24 часов: уточним детали по теме и согласуем 30-минутный созвон по результатам.",
    "",
    "Если что-то срочно — отвечайте на это письмо или пишите на support@patent-scan.com.",
    "",
    "— Команда Patent-Scan",
  ].join("\n");
}
