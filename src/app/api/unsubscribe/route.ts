// One-click marketing unsubscribe. Embedded in every marketing email as
//   https://patent-scan.ru/api/unsubscribe?token=<jwt>
// Verifies the JWT (signed at marketing-send time with MARKETING_UNSUB_SECRET),
// then nulls profiles.marketing_consent_at and stamps marketing_unsubscribed_at.
// Renders a small HTML confirmation page inline — no client-side JS required,
// works in every email-client preview.

import { type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import { verifyUnsubToken } from "@/lib/unsub-jwt";
import { recordMarketingConsentEvent } from "@/lib/marketing-consent";

export const runtime = "nodejs";

function htmlPage(opts: { ok: boolean; message: string }): Response {
  const accent = opts.ok ? "#047857" : "#be123c";
  const body = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ПатентСкан — Отписка от рассылки</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:32px;line-height:1.5}
.card{max-width:560px;margin:60px auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.04)}
h1{font-size:24px;margin:0 0 12px;color:${accent}}
p{color:#475569;font-size:15px;margin:0 0 16px}
a{color:#2563eb;text-decoration:none;font-weight:600}
a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="card">
<h1>${opts.ok ? "Вы отписаны" : "Не удалось отписаться"}</h1>
<p>${opts.message}</p>
<p><a href="https://patent-scan.ru/">← На главную ПатентСкан</a></p>
</div>
</body>
</html>`;
  return new Response(body, {
    status: opts.ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.MARKETING_UNSUB_SECRET;
  if (!secret) {
    console.error("[unsubscribe] MARKETING_UNSUB_SECRET missing");
    return htmlPage({
      ok: false,
      message:
        "Сервис временно недоступен. Напишите на support@patent-scan.com — отпишем вручную.",
    });
  }

  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return htmlPage({
      ok: false,
      message: "Ссылка для отписки повреждена. Перейдите по ссылке из последнего письма ПатентСкан.",
    });
  }

  let claims;
  try {
    claims = verifyUnsubToken(token, secret);
  } catch {
    return htmlPage({
      ok: false,
      message: "Ссылка для отписки недействительна. Перейдите по ссылке из последнего письма ПатентСкан.",
    });
  }

  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("profiles")
    .update({
      marketing_consent_at: null,
      marketing_unsubscribed_at: new Date().toISOString(),
    })
    .eq("id", claims.sub);

  if (error) {
    console.error("[unsubscribe] update failed", {
      userId: claims.sub,
      message: error.message,
    });
    return htmlPage({
      ok: false,
      message:
        "Не удалось обновить настройки рассылки. Попробуйте позже или напишите на support@patent-scan.com.",
    });
  }

  // Append-only proof of the revoke (spec §3). Best-effort: the flag is already
  // cleared (the legally-binding state), the log is the audit trail.
  await recordMarketingConsentEvent({
    userId: claims.sub,
    granted: false,
    source: "unsubscribe_link",
  });

  return htmlPage({
    ok: true,
    message:
      "Вы отписались от рассылки ПатентСкан. Транзакционные письма (вход в аккаунт, отчёты) продолжат приходить.",
  });
}
