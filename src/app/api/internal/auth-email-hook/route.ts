// GoTrue "Send Email Hook" → Unisender GO HTTP API.
//
// WHY: the VPS (ap-prod-msk, Timeweb) blocks ALL outbound SMTP ports
// (25/465/587/2525 → all time out), so self-hosted GoTrue cannot send magic-link
// mail over SMTP. Port 443 IS open, and Unisender GO exposes an HTTPS send API.
// GoTrue's Send Email Hook lets us intercept every outbound auth email and
// deliver it ourselves via that API — bypassing the SMTP block entirely and
// giving better deliverability than raw VPS SMTP.
//
// GoTrue POSTs here (over the docker host-gateway, internal) signed with the
// Standard Webhooks scheme. We verify the signature, build the verify URL, render
// a branded RU magic-link email, and hand it to Unisender GO.
//
// SECURITY: the hook secret + Unisender key are env-only (never logged). We
// reject unsigned/mis-signed requests. This route is internal (called by GoTrue);
// it does not trust the body until the signature checks out.

import { NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

const HOOK_SECRET = process.env.AUTH_EMAIL_HOOK_SECRET ?? ""; // "v1,whsec_<base64>" or "whsec_<base64>"
const UNISENDER_GO_API_KEY = process.env.UNISENDER_GO_API_KEY ?? "";
const UNISENDER_GO_URL =
  process.env.UNISENDER_GO_URL ??
  "https://goapi.unisender.ru/ru/transactional/api/v1/email/send.json";
const FROM_EMAIL = process.env.AUTH_EMAIL_FROM ?? "noreply@patent-scan.ru";
const FROM_NAME = process.env.AUTH_EMAIL_FROM_NAME ?? "ПатентСкан";
// GoTrue's external API base (with the /auth/v1 prefix nginx routes), used to
// build the verify link so it resolves through our gateway to GoTrue.
const AUTH_API_BASE =
  process.env.PUBLIC_AUTH_API_BASE ?? "https://auth.patent-scan.ru/auth/v1";

type EmailActionType =
  | "signup"
  | "magiclink"
  | "recovery"
  | "invite"
  | "email_change"
  | "email";

type HookPayload = {
  user?: { email?: string };
  email_data?: {
    /** Plain 6-digit OTP. GoTrue has always sent it alongside token_hash; we
     *  discarded it until 2026-08-25. It is what makes a login survive a mail
     *  provider that prefetches links — see renderHtml. */
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: EmailActionType;
    site_url?: string;
  };
};

// Standard Webhooks signature check (the scheme GoTrue's hooks use).
// Header `webhook-signature` is a space-separated list of `v1,<base64sig>`.
// signed content = `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 with the raw
// secret (the part after the optional "v1," prefix and the "whsec_" tag, base64).
function verifySignature(
  rawBody: string,
  headers: Headers
): boolean {
  if (!HOOK_SECRET) return false;
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !ts || !sigHeader) return false;

  // Reject stale timestamps (>5 min skew) to blunt replay.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
    return false;
  }

  const secretB64 = HOOK_SECRET.replace(/^v1,/, "").replace(/^whsec_/, "");
  let key: Buffer;
  try {
    key = Buffer.from(secretB64, "base64");
  } catch {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${ts}.${rawBody}`)
    .digest("base64");

  // The header may carry several space-separated versioned signatures.
  for (const part of sigHeader.split(" ")) {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    if (
      sig &&
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return true;
    }
  }
  return false;
}

const SUBJECTS: Record<string, string> = {
  magiclink: "Вход в ПатентСкан",
  signup: "Подтвердите вход в ПатентСкан",
  recovery: "Вход в ПатентСкан",
  invite: "Приглашение в ПатентСкан",
  email_change: "Подтверждение смены e-mail — ПатентСкан",
  email: "Вход в ПатентСкан",
};

function renderHtml(verifyUrl: string, code?: string): string {
  // Clean, inline-CSS RU email: code first, button second. Branding only; no
  // fabricated data — the code is the one GoTrue generated for this request.
  //
  // The code leads because the button does not survive every inbox: a mail
  // provider that prefetches links spends the one-time token before the human
  // clicks it, and they get "link expired" (prod, 2026-08-15 08:47:21 → a
  // foreign IP consumed the token 28s later; that user never signed in and
  // re-registered elsewhere 2.5 minutes on). A typed code cannot be spent by a
  // scanner's GET. The button stays for everyone it already works for.
  const codeBlock = code
    ? `<tr><td style="padding-bottom:24px;">
<div style="font-size:12px;color:#64748b;padding-bottom:8px;">Код для входа</div>
<div style="font-size:30px;font-weight:700;letter-spacing:7px;color:#0f172a;background:#f1f5f9;border-radius:10px;padding:16px 0;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${code}</div>
</td></tr>`
    : "";
  return `<!doctype html><html lang="ru"><body style="margin:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:32px 0;"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:36px 40px;max-width:480px;">
<tr><td style="font-size:20px;font-weight:700;color:#2563EB;padding-bottom:8px;">ПатентСкан</td></tr>
<tr><td style="font-size:16px;font-weight:600;padding:8px 0 4px;">Вход в ПатентСкан</td></tr>
<tr><td style="font-size:14px;line-height:22px;color:#475569;padding-bottom:20px;">Введите код на странице входа — или нажмите кнопку. Код и ссылка действуют ограниченное время и срабатывают один раз. Если вы не запрашивали вход — просто проигнорируйте это письмо.</td></tr>
${codeBlock}
<tr><td style="padding-bottom:24px;"><a href="${verifyUrl}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:8px;">Войти в ПатентСкан</a></td></tr>
<tr><td style="font-size:12px;line-height:18px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;">Если кнопка не работает, скопируйте ссылку в браузер:<br><span style="color:#64748b;word-break:break-all;">${verifyUrl}</span></td></tr>
</table>
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;"><tr><td style="font-size:11px;color:#94a3b8;padding:16px 40px 0;text-align:center;">ПатентСкан · patent-scan.ru</td></tr></table>
</td></tr></table></body></html>`;
}

export async function POST(req: Request) {
  if (!HOOK_SECRET || !UNISENDER_GO_API_KEY) {
    console.error("[auth-email-hook] not configured (missing secret or api key)");
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody) as HookPayload;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const email = payload.user?.email;
  const ed = payload.email_data;
  if (!email || !ed?.token_hash) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const actionType = ed.email_action_type ?? "magiclink";
  const redirectTo = ed.redirect_to ?? "https://patent-scan.ru/account";
  const verifyUrl =
    `${AUTH_API_BASE}/verify?token=${encodeURIComponent(ed.token_hash)}` +
    `&type=${encodeURIComponent(actionType)}` +
    `&redirect_to=${encodeURIComponent(redirectTo)}`;

  const body = {
    message: {
      recipients: [{ email }],
      subject: SUBJECTS[actionType] ?? SUBJECTS.magiclink,
      from_email: FROM_EMAIL,
      from_name: FROM_NAME,
      body: { html: renderHtml(verifyUrl, ed.token) },
    },
  };

  try {
    const resp = await fetch(UNISENDER_GO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": UNISENDER_GO_API_KEY,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.error("[auth-email-hook] unisender non-ok", {
        status: resp.status,
        // log a short, key-free preview only
        detail: detail.slice(0, 200),
        actionType,
      });
      return NextResponse.json({ error: "send_failed" }, { status: 502 });
    }
  } catch (e) {
    console.error("[auth-email-hook] send error", {
      message: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "send_error" }, { status: 502 });
  }

  // GoTrue treats a 2xx as "email handled" and will NOT also try SMTP.
  return NextResponse.json({ ok: true });
}
