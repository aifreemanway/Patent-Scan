// Three transactional templates: «received», «ready», «error». Copy is
// paste-able from ap-ba's ux-copy/literature-review-emails-2026-05-30.md but
// kept inline here so the worker doesn't depend on Obsidian-style sources.

import { sendTransactionalEmail } from "@/lib/resend";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru";

function buildHtml(body: string): string {
  // Plain layout, no external assets. Email clients vary wildly — keep it boring.
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

function shortId(id: string): string {
  return id.slice(0, 8);
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// ── #1 received ──────────────────────────────────────────────
export async function sendReceivedEmail(opts: {
  to: string;
  requestId: string;
  topic: string;
}) {
  const subject = `Запрос на литературный обзор принят`;
  const trackingUrl = `${BASE_URL}/literature-review/processing?id=${opts.requestId}`;
  const accountUrl = `${BASE_URL}/account/history`;

  const text = [
    `Здравствуйте!`,
    ``,
    `Мы получили запрос на литературный обзор по теме:`,
    `«${opts.topic}»`,
    ``,
    `Запрос #${shortId(opts.requestId)} принят в обработку. Ожидаемое время готовности — 1-3 рабочих дня.`,
    ``,
    `Когда обзор будет готов, мы пришлём отдельное письмо со ссылкой на скачивание. Готовый отчёт также появится в вашем личном кабинете.`,
    ``,
    `Отслеживать статус: ${trackingUrl}`,
    `Личный кабинет: ${accountUrl}`,
    ``,
    `Если запрос отправлен по ошибке или нужно его отменить — ответьте на это письмо или напишите на support@patent-scan.com со ссылкой на запрос.`,
    ``,
    `—`,
    `ПатентСкан`,
    `Литературные обзоры на основе открытых научных, патентных и отраслевых источников.`,
  ].join("\n");

  const html = buildHtml(`
<tr><td>
<h1 style="margin:0 0 16px;font-size:22px;color:#0f172a">Запрос на литературный обзор принят</h1>
<p style="margin:0 0 12px;color:#475569;font-size:15px">Тема:</p>
<p style="margin:0 0 16px;color:#0f172a;font-size:16px;font-weight:600">«${escapeHtml(opts.topic)}»</p>
<p style="margin:0 0 16px;color:#475569;font-size:15px">Запрос <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">#${shortId(opts.requestId)}</code> принят в обработку. Ожидаемое время готовности — 1-3 рабочих дня.</p>
<p style="margin:0 0 24px;color:#475569;font-size:15px">Когда обзор будет готов, мы пришлём отдельное письмо со ссылкой на скачивание. Готовый отчёт также появится в вашем личном кабинете.</p>
<p style="margin:0 0 12px"><a href="${trackingUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:15px">Отслеживать статус</a></p>
<p style="margin:24px 0 0;color:#64748b;font-size:13px;line-height:1.5">Если запрос отправлен по ошибке — напишите на support@patent-scan.com со ссылкой на этот запрос.</p>
<hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0">
<p style="margin:0;color:#94a3b8;font-size:12px">ПатентСкан · support@patent-scan.com</p>
</td></tr>
`);

  return sendTransactionalEmail({ to: opts.to, subject, html, text });
}

// ── #2 ready ─────────────────────────────────────────────────
export async function sendReadyEmail(opts: {
  to: string;
  requestId: string;
  topic: string;
  periodFrom: number;
  periodTo: number;
  reportUrl: string; // signed Supabase Storage URL (.md for PR-3, .pdf for PR-3.5)
  cabinetUrl?: string;
}) {
  const cabinetUrl = opts.cabinetUrl ?? `${BASE_URL}/account/history`;
  const newReviewUrl = `${BASE_URL}/literature-review`;
  const subject = `Литературный обзор по теме «${clip(opts.topic, 60)}» готов`;

  const text = [
    `Здравствуйте!`,
    ``,
    `Литературный обзор по запросу #${shortId(opts.requestId)} готов.`,
    ``,
    `Тема: «${opts.topic}»`,
    `Период: ${opts.periodFrom}-${opts.periodTo}`,
    ``,
    `Скачать отчёт: ${opts.reportUrl}`,
    `Открыть в личном кабинете: ${cabinetUrl}`,
    ``,
    `Ссылка действует 30 дней. После — отчёт доступен из личного кабинета.`,
    ``,
    `Если нужно уточнение, расширение или повторный запрос с правками — это можно сделать одной кнопкой из истории запросов.`,
    ``,
    `Создать новый обзор: ${newReviewUrl}`,
    ``,
    `—`,
    `ПатентСкан · support@patent-scan.com`,
  ].join("\n");

  const html = buildHtml(`
<tr><td>
<h1 style="margin:0 0 16px;font-size:22px;color:#0f172a">Литературный обзор готов</h1>
<p style="margin:0 0 16px;color:#0f172a;font-size:16px;font-weight:600">«${escapeHtml(opts.topic)}»</p>
<p style="margin:0 0 16px;color:#475569;font-size:14px">Запрос <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">#${shortId(opts.requestId)}</code> · период ${opts.periodFrom}-${opts.periodTo}</p>
<p style="margin:0 0 20px"><a href="${opts.reportUrl}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px">Скачать отчёт</a></p>
<p style="margin:0 0 12px;color:#475569;font-size:14px">Или откройте в личном кабинете:</p>
<p style="margin:0 0 24px"><a href="${cabinetUrl}" style="color:#2563eb;font-weight:600;text-decoration:none">${cabinetUrl}</a></p>
<p style="margin:0 0 12px;color:#475569;font-size:14px">Ссылка действует 30 дней. После — отчёт доступен из личного кабинета.</p>
<hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0">
<p style="margin:0;color:#64748b;font-size:13px">Нужно уточнение или повторный запрос с правками? <a href="${newReviewUrl}" style="color:#2563eb">Создать новый обзор</a>.</p>
<p style="margin:16px 0 0;color:#94a3b8;font-size:12px">ПатентСкан · support@patent-scan.com</p>
</td></tr>
`);

  return sendTransactionalEmail({ to: opts.to, subject, html, text });
}

// ── #3 error ─────────────────────────────────────────────────
export async function sendErrorEmail(opts: {
  to: string;
  requestId: string;
  topic: string;
}) {
  const retryUrl = `${BASE_URL}/account/history?from=${opts.requestId}`;
  const subject = `Ошибка при подготовке обзора #${shortId(opts.requestId)}`;

  const text = [
    `Здравствуйте!`,
    ``,
    `К сожалению, при подготовке литературного обзора по запросу #${shortId(opts.requestId)} произошла ошибка, и автоматические перезапуски не помогли.`,
    ``,
    `Тема: «${clip(opts.topic, 120)}»`,
    ``,
    `Деньги и квота не списаны — запрос отмечен как несостоявшийся.`,
    ``,
    `Что можно сделать:`,
    `1. Перезапустить запрос из личного кабинета: ${retryUrl}`,
    `2. Если ошибка повторится — ответьте на это письмо. Мы посмотрим и вернёмся в течение одного рабочего дня.`,
    ``,
    `—`,
    `ПатентСкан · support@patent-scan.com`,
  ].join("\n");

  const html = buildHtml(`
<tr><td>
<h1 style="margin:0 0 16px;font-size:22px;color:#be123c">Не удалось подготовить обзор</h1>
<p style="margin:0 0 12px;color:#475569;font-size:15px">К сожалению, при подготовке литературного обзора по запросу <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">#${shortId(opts.requestId)}</code> произошла ошибка, и автоматические перезапуски не помогли.</p>
<p style="margin:0 0 16px;color:#0f172a;font-size:15px">Тема: «${escapeHtml(clip(opts.topic, 120))}»</p>
<p style="margin:0 0 16px;color:#475569;font-size:14px"><strong>Деньги и квота не списаны</strong> — запрос отмечен как несостоявшийся.</p>
<p style="margin:0 0 16px"><a href="${retryUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:15px">Перезапустить запрос</a></p>
<p style="margin:24px 0 0;color:#64748b;font-size:13px">Если ошибка повторится — ответьте на это письмо. Мы посмотрим и вернёмся в течение одного рабочего дня.</p>
<hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0">
<p style="margin:0;color:#94a3b8;font-size:12px">ПатентСкан · support@patent-scan.com</p>
</td></tr>
`);

  return sendTransactionalEmail({ to: opts.to, subject, html, text });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
