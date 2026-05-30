// Reactivation emails (#1 at T+24h, #2 at T+72h). Copy is locked by ap-ba
// (Antepatent/ux-copy/email-reactivation-2026-05-29.md §«Юридические границы»):
// ✅ allowed — «завершите регистрацию», «вот свежая ссылка», техническая
// причина (link expired), antiphishing footer; ❌ forbidden — tariffs, prices,
// feature lists, case studies, marketing CTAs (would qualify as advertising
// under FZ-38 art.18 without a separate opt-in).
//
// Template style intentionally matches literature-review/email.ts so both
// transactional surfaces feel like one product.

import { sendTransactionalEmail } from "@/lib/resend";

function wrap(body: string): string {
  return `<!DOCTYPE html><html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:0">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;padding:32px 16px">
<tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;text-align:left;line-height:1.55">
${body}
</table>
</td></tr>
</table>
</body></html>`;
}

const LEGAL_FOOTER = `<hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0">
<p style="margin:0 0 4px;color:#94a3b8;font-size:12px">ПатентСкан — предварительный скрининг патентной новизны. Не является юридической консультацией и не заменяет патентного поверенного.</p>
<p style="margin:0;color:#94a3b8;font-size:12px">ИП Кобзарь В. Ю. · Это автоматическое письмо, отвечать на него не нужно. · patent-scan.ru</p>`;

export async function sendReactivationEmail1(opts: {
  to: string;
  magicLinkUrl: string;
}) {
  const subject = "Завершите вход в ПатентСкан";
  const text = [
    "ЗАВЕРШИТЕ ВХОД В ПАТЕНТСКАН",
    "",
    "Вы начали регистрацию в ПатентСкан, но не подтвердили вход. Если хотели войти —",
    "вот свежая ссылка. Откройте её в браузере:",
    "",
    opts.magicLinkUrl,
    "",
    "Ссылка действует ограниченное время — откройте её сейчас.",
    "",
    "Если регистрация была случайной — просто проигнорируйте письмо.",
    "",
    "---",
    "ПатентСкан — предварительный скрининг патентной новизны.",
    "Не является юридической консультацией и не заменяет патентного поверенного.",
    "",
    "ИП Кобзарь В. Ю. · Это автоматическое письмо, отвечать на него не нужно.",
    "patent-scan.ru",
  ].join("\n");

  const html = wrap(`
<tr><td>
<h1 style="margin:0 0 16px;font-size:22px;color:#0f172a">Завершите вход в ПатентСкан</h1>
<p style="margin:0 0 16px;color:#475569;font-size:15px">Вы начали регистрацию в ПатентСкан, но не подтвердили вход. Если хотели войти — вот свежая ссылка:</p>
<p style="margin:0 0 24px"><a href="${opts.magicLinkUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px">Войти в ПатентСкан</a></p>
<p style="margin:0 0 12px;color:#475569;font-size:14px">Не открывается кнопка? Скопируйте ссылку в браузер:<br><span style="word-break:break-all;color:#2563eb;font-size:13px">${opts.magicLinkUrl}</span></p>
<p style="margin:16px 0 0;color:#64748b;font-size:13px">Ссылка действует ограниченное время — откройте её сейчас.</p>
<p style="margin:8px 0 0;color:#94a3b8;font-size:13px">Если регистрация была случайной — просто проигнорируйте это письмо.</p>
${LEGAL_FOOTER}
</td></tr>
`);

  return sendTransactionalEmail({ to: opts.to, subject, html, text });
}

export async function sendReactivationEmail2(opts: {
  to: string;
  magicLinkUrl: string;
}) {
  const subject = "Последнее напоминание о входе";
  const text = [
    "ПОСЛЕДНЕЕ НАПОМИНАНИЕ О ВХОДЕ",
    "",
    "Несколько дней назад вы оставили email для входа в ПатентСкан, но не подтвердили",
    "его. Это последнее напоминание — больше писем по этому поводу не будет.",
    "",
    "Если планировали войти — перейдите по ссылке:",
    "",
    opts.magicLinkUrl,
    "",
    "Если регистрация была случайной или вам это больше не нужно — просто",
    "проигнорируйте письмо. Мы больше не напишем.",
    "",
    "---",
    "ПатентСкан — предварительный скрининг патентной новизны.",
    "Не является юридической консультацией и не заменяет патентного поверенного.",
    "",
    "ИП Кобзарь В. Ю. · Это автоматическое письмо, отвечать на него не нужно.",
    "patent-scan.ru",
  ].join("\n");

  const html = wrap(`
<tr><td>
<h1 style="margin:0 0 16px;font-size:22px;color:#0f172a">Последнее напоминание о входе</h1>
<p style="margin:0 0 16px;color:#475569;font-size:15px">Несколько дней назад вы оставили email для входа в ПатентСкан, но не подтвердили его. <strong>Это последнее напоминание</strong> — больше писем по этому поводу не будет.</p>
<p style="margin:0 0 24px"><a href="${opts.magicLinkUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px">Войти в ПатентСкан</a></p>
<p style="margin:0 0 12px;color:#475569;font-size:14px">Не открывается кнопка? Скопируйте ссылку в браузер:<br><span style="word-break:break-all;color:#2563eb;font-size:13px">${opts.magicLinkUrl}</span></p>
<p style="margin:16px 0 0;color:#64748b;font-size:13px">Если регистрация была случайной или вам это больше не нужно — просто проигнорируйте письмо. Мы больше не напишем.</p>
${LEGAL_FOOTER}
</td></tr>
`);

  return sendTransactionalEmail({ to: opts.to, subject, html, text });
}
