"use client";

import { Fragment, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Header } from "@/components/Header";
import { useSessionJSON } from "@/lib/use-session-json";
import { useRotatingText } from "@/hooks/useRotatingText";
import { IndustrialUsageRow } from "./IndustrialUsageRow";

type ReportPatent = {
  id: string;
  title: string;
  year: string;
  country: string;
  similarity: "High" | "Medium" | "Low";
  match?: string;
  diff?: string;
  url?: string;
};

type DeepFeature = {
  feature: string;
  status: "known" | "partially_known" | "novel";
  analogIds: string[];
  note?: string;
};

type DeepResult = {
  uniqueness?: "High" | "Medium" | "Low";
  uniquenessDetail?: string;
  overview?: string;
  features?: DeepFeature[];
  patents?: ReportPatent[];
  recommendation?: string;
  deep?: boolean;
};

type ReportData = {
  empty?: boolean;
  uniqueness?: "High" | "Medium" | "Low";
  uniquenessDetail?: string;
  overview?: string;
  patents?: ReportPatent[];
  recommendation?: string;
  searchTotal?: number;
  _input?: {
    description: string;
    answers: string[];
    patents: unknown[];
  };
};

type DeepStatus = "idle" | "loading" | "done" | "used" | "error";

// Subtle per-level accent only (a small dot) — never a big green "all clear",
// which reads as automation-bias permission to skip a real attorney review.
const UNIQUENESS_DOT: Record<string, string> = {
  High: "bg-emerald-500",
  Medium: "bg-amber-500",
  Low: "bg-rose-500",
};

const SIMILARITY_STYLES: Record<string, string> = {
  High: "bg-rose-100 text-rose-800",
  Medium: "bg-amber-100 text-amber-800",
  Low: "bg-emerald-100 text-emerald-800",
};

function esc(s: string | undefined | null): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Only emit href for real http(s) links — keeps the standalone file free of
// javascript:/data: URLs while preserving every working patent link.
function safeHref(url: string | undefined | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? esc(url) : null;
}

// Trim a long invention description to a header-friendly length (keeps the
// "what was checked" line from swallowing the top of the report/export).
function truncate(s: string, max = 280): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

// Short, descriptive filename slug from the invention description, so a saved
// report is identifiable later (Cyrillic is kept — RU filenames are fine).
function fileSlug(s: string | undefined | null): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .split("-")
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
    .slice(0, 60);
}

const REPORT_CSS = `
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0f172a;background:#fff;margin:0;padding:32px;line-height:1.5}
.wrap{max-width:900px;margin:0 auto}
h1{font-size:28px;font-weight:700;margin:0 0 4px}
.subtitle{color:#475569;font-size:14px;margin:0 0 8px}
h2{font-size:20px;font-weight:600;margin:0 0 12px}
.card{border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:16px 0}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top}
th{background:#f8fafc;font-weight:600}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
a{color:#2563eb}
.muted{color:#64748b;font-size:13px}
.uniqueness{font-size:36px;font-weight:700;margin-top:4px}
.u-High{color:#047857}.u-Medium{color:#b45309}.u-Low{color:#be123c}
.badge{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;white-space:nowrap}
.s-High{background:#ffe4e6;color:#9f1239}
.s-Medium{background:#fef3c7;color:#92400e}
.s-Low{background:#d1fae5;color:#065f46}
.sub{margin-top:4px;font-size:12px;color:#64748b}
.matchline{color:#e11d48;font-weight:600}
.diffline{color:#059669;font-weight:600}
.reco{background:#0f172a;color:#fff;border-radius:12px;padding:20px;margin:16px 0}
.reco h2{color:#fff}
@media print{body{padding:0}.card,.reco{break-inside:avoid}a{text-decoration:underline}}
`;

type ReportT = (key: string, values?: Record<string, string | number>) => string;

function buildSearchReportHtml(args: {
  data: ReportData;
  t: ReportT;
  headers: Record<string, string>;
  uniquenessLabel: string;
  locale: string;
  autoPrint: boolean;
  deep?: DeepResult | null;
}): string {
  const { data, t, headers, uniquenessLabel, locale, autoPrint, deep } = args;
  const patents = data.patents ?? [];
  const uniqueness = data.uniqueness ?? "Medium";

  const idLink = (id: string, url: string | undefined | null) => {
    const href = safeHref(url);
    return href
      ? `<a class="mono" href="${href}" target="_blank" rel="noopener noreferrer">${esc(id)}</a>`
      : `<span class="mono">${esc(id)}</span>`;
  };

  const queryHtml = data._input?.description
    ? `<section class="card"><div class="muted">${esc(
        t("queryLabel"),
      )}</div><p style="margin:4px 0 0">${esc(
        truncate(data._input.description),
      )}</p></section>`
    : "";

  const uniquenessHtml = `<section class="card"><div class="muted">${esc(
    t("uniquenessLabel"),
  )}</div><div class="uniqueness u-${esc(uniqueness)}">${esc(uniquenessLabel)}</div>${
    data.uniquenessDetail ? `<p>${esc(data.uniquenessDetail)}</p>` : ""
  }</section>`;

  const overviewHtml = data.overview
    ? `<section class="card"><h2>${esc(t("overviewTitle"))}</h2><p>${esc(
        data.overview,
      )}</p></section>`
    : "";

  const patentsHtml = patents.length
    ? `<section class="card"><h2>${esc(
        t("patentsTitle"),
      )}</h2><table><thead><tr><th>${esc(headers.id)}</th><th>${esc(
        headers.title,
      )}</th><th>${esc(headers.year)}</th><th>${esc(headers.country)}</th><th>${esc(
        headers.similarity,
      )}</th></tr></thead><tbody>${patents
        .map((p) => {
          const sub =
            p.match || p.diff
              ? `<div class="sub">${
                  p.match
                    ? `<div><span class="matchline">${esc(
                        headers.match,
                      )}:</span> ${esc(p.match)}</div>`
                    : ""
                }${
                  p.diff
                    ? `<div><span class="diffline">${esc(
                        headers.diff,
                      )}:</span> ${esc(p.diff)}</div>`
                    : ""
                }</div>`
              : "";
          return `<tr><td>${idLink(p.id, p.url)}</td><td>${esc(
            p.title,
          )}${sub}</td><td>${esc(p.year)}</td><td>${esc(
            p.country,
          )}</td><td><span class="badge s-${esc(p.similarity)}">${esc(
            t(`similarity${p.similarity}`),
          )}</span></td></tr>`;
        })
        .join("")}</tbody></table></section>`
    : "";

  const sourcesHtml = `<section class="card"><h2>${esc(
    t("sourcesTitle"),
  )}</h2><div><strong>${esc(t("sourceRospatent"))}</strong> <span class="muted">${esc(
    t("sourceCount", { n: data.searchTotal ?? patents.length }),
  )}</span></div></section>`;

  const recoHtml = data.recommendation
    ? `<section class="reco"><h2>${esc(t("recommendationTitle"))}</h2><p>${esc(
        data.recommendation,
      )}</p></section>`
    : "";

  const deepHtml = (() => {
    if (!deep || !deep.uniqueness) return "";
    const uLabel = (u: string) =>
      t(`uniqueness${u}` as "uniquenessHigh" | "uniquenessMedium" | "uniquenessLow");
    const statusLabel = (s?: string) =>
      s === "novel"
        ? t("deepStatusNovel")
        : s === "partially_known"
          ? t("deepStatusPartial")
          : t("deepStatusKnown");
    const crossHtml =
      deep.uniqueness !== uniqueness
        ? `<section class="card" style="border-color:#fcd34d;background:#fffbeb"><strong style="color:#92400e">${esc(
            t("crossCheckTitle"),
          )}</strong><p style="color:#92400e;margin:4px 0 0">${esc(
            t("crossCheckBody", { fast: uLabel(uniqueness), deep: uLabel(deep.uniqueness) }),
          )}</p></section>`
        : "";
    const featuresHtml = (deep.features ?? []).length
      ? `<h3>${esc(t("deepFeaturesTitle"))}</h3>${(deep.features ?? [])
          .map((f) => {
            const analogs = (f.analogIds ?? [])
              .map((id) => idLink(id, deep.patents?.find((p) => p.id === id)?.url))
              .join(", ");
            return `<div style="margin:8px 0"><strong>${esc(f.feature)}</strong> <span class="badge s-${
              f.status === "novel" ? "Low" : "Medium"
            }">${esc(statusLabel(f.status))}</span>${
              f.note ? `<div class="sub">${esc(f.note)}</div>` : ""
            }${analogs ? `<div class="sub">${esc(t("deepFeatureAnalogs"))} ${analogs}</div>` : ""}</div>`;
          })
          .join("")}`
      : "";
    return `${crossHtml}<section class="card"><h2>${esc(t("deepResultTitle"))}</h2>${
      deep.overview ? `<p>${esc(deep.overview)}</p>` : ""
    }${deep.uniquenessDetail ? `<p>${esc(deep.uniquenessDetail)}</p>` : ""}${featuresHtml}${
      deep.recommendation
        ? `<p style="margin-top:12px"><strong>${esc(
            t("recommendationTitle"),
          )}:</strong> ${esc(deep.recommendation)}</p>`
        : ""
    }</section>`;
  })();

  const printScript = autoPrint
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});</script>`
    : "";

  return `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t("title"))}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
<h1>${esc(t("title"))}</h1>
<p class="subtitle">${esc(t("subtitle"))}</p>
${queryHtml}
${uniquenessHtml}
${overviewHtml}
${patentsHtml}
${sourcesHtml}
${recoHtml}
${deepHtml}
</div>
${printScript}
</body>
</html>`;
}

export default function ReportPage() {
  const t = useTranslations("Report");
  const locale = useLocale();
  const { data, loaded } = useSessionJSON<ReportData>("ps_report");

  const [deepStatus, setDeepStatus] = useState<DeepStatus>("idle");
  const [deepResult, setDeepResult] = useState<DeepResult | null>(null);

  // Rotating progress text for the Deep Analysis loader (1–2 min Sonnet call).
  // Stays null when idle/done so the hook doesn't spin a timer for nothing.
  const deepPhrases = useMemo(
    () => t.raw("deepLoadingPhrases") as string[],
    [t]
  );
  const deepRotating = useRotatingText(
    deepStatus === "loading" ? deepPhrases : null,
    7000
  );

  const deepInput = data?._input;

  // Async Deep Analysis (вариант B): submit → poll. Submit returns fast (no
  // LLM call), so mobile NAT can't kill the request mid-verdict (ap-qa bug).
  // The pm2 worker runs Sonnet; we poll status every few seconds. If the tab
  // is closed mid-poll, the worker still finishes and the result lands in
  // /account/history — durable, free credit never lost on a dropped connection.
  const runDeepAnalysis = async () => {
    if (!deepInput) return;
    setDeepStatus("loading");
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const POLL_INTERVAL_MS = 3000;
    const POLL_MAX_ATTEMPTS = 80; // ~4 min ceiling (verdict usually <2 min)
    try {
      const resp = await fetch("/api/deep-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: deepInput.description,
          answers: deepInput.answers,
          patents: deepInput.patents,
        }),
      });

      if (resp.status === 402) {
        setDeepStatus("used");
        return;
      }
      if (!resp.ok) {
        setDeepStatus("error");
        return;
      }

      const { id } = (await resp.json()) as { id?: string };
      if (!id) {
        setDeepStatus("error");
        return;
      }

      // Poll for the verdict.
      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        await delay(POLL_INTERVAL_MS);
        let row: { status?: string; result?: DeepResult } | null = null;
        try {
          const sResp = await fetch(`/api/deep-analysis/${id}/status`);
          if (!sResp.ok) continue; // transient 5xx/network — keep polling
          row = (await sResp.json()) as { status?: string; result?: DeepResult };
        } catch {
          continue; // network blip — keep polling
        }
        if (row?.status === "completed" && row.result) {
          setDeepResult(row.result);
          setDeepStatus("done");
          return;
        }
        if (row?.status === "error") {
          setDeepStatus("error");
          return;
        }
        // pending / in_progress → keep polling
      }
      // Poll ceiling hit — worker may still finish; result will appear in
      // /account/history. Soft error so the user isn't stuck on the spinner.
      setDeepStatus("error");
    } catch {
      setDeepStatus("error");
    }
  };

  if (!loaded) {
    return (
      <>
        <Header />
        <main className="flex flex-1 flex-col items-center justify-center bg-slate-50 py-24">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
        </main>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <Header />
        <main className="flex flex-1 flex-col bg-slate-50">
          <div className="mx-auto w-full max-w-3xl px-6 py-24 text-center">
            <h1 className="text-2xl font-bold text-slate-900">{t("missingTitle")}</h1>
            <p className="mt-3 text-slate-600">{t("missingBody")}</p>
            <Link
              href="/search"
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              {t("ctaPrimary")}
            </Link>
          </div>
        </main>
      </>
    );
  }

  if (data.empty) {
    return (
      <>
        <Header />
        <main className="flex flex-1 flex-col bg-slate-50">
          <div className="mx-auto w-full max-w-3xl px-6 py-24 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
              <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <h1 className="mt-6 text-2xl font-bold text-slate-900">{t("emptyTitle")}</h1>
            <p className="mt-3 text-slate-600">{t("emptyBody")}</p>
            <Link
              href="/search"
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              {t("emptyCta")}
            </Link>
          </div>
        </main>
      </>
    );
  }

  const patents = data.patents ?? [];
  const uniqueness = data.uniqueness ?? "Medium";
  const uniquenessLabel = t(`uniqueness${uniqueness}` as "uniquenessHigh" | "uniquenessMedium" | "uniquenessLow");
  const headers = t.raw("patentsHeaders") as Record<string, string>;
  const verdictCaption = t(
    `verdictCaption${uniqueness}` as
      | "verdictCaptionHigh"
      | "verdictCaptionMedium"
      | "verdictCaptionLow"
  );
  const notCheckedItems = t("notCheckedItems")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const coverageBases = t("coverageBases")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = fileSlug(data._input?.description);
  const fileBase = slug
    ? `patent-${slug}-${dateStr}`
    : `patent-uniqueness-${dateStr}`;

  const handleExportHtml = () => {
    const html = buildSearchReportHtml({
      data,
      t,
      headers,
      uniquenessLabel,
      locale,
      autoPrint: false,
      deep: deepResult,
    });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBase}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const handleExportPdf = () => {
    const html = buildSearchReportHtml({
      data,
      t,
      headers,
      uniquenessLabel,
      locale,
      autoPrint: true,
      deep: deepResult,
    });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return (
    <>
      <Header />
      <main className="flex flex-1 flex-col bg-slate-50">
        <div className="mx-auto w-full max-w-5xl px-6 py-12 sm:py-16">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-3xl text-slate-600">{t("subtitle")}</p>

          {data._input?.description ? (
            <p className="mt-4 max-w-3xl rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <span className="font-semibold text-slate-800">{t("queryLabel")}:</span>{" "}
              {truncate(data._input.description)}
            </p>
          ) : null}

          {/* Uniqueness indicator — neutral label + small accent dot (no big
              green "all clear"), always shown next to its calibration caption
              and the explicit limits of what we did NOT check. */}
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-medium text-slate-500">
                  {t("uniquenessLabel")}
                </div>
                <div className="mt-1 flex items-center gap-2.5">
                  <span
                    className={`inline-block h-3 w-3 shrink-0 rounded-full ${UNIQUENESS_DOT[uniqueness] ?? "bg-slate-400"}`}
                    aria-hidden
                  />
                  <span className="text-4xl font-bold text-slate-900">
                    {uniquenessLabel}
                  </span>
                </div>
              </div>
              {data.uniquenessDetail && (
                <p className="max-w-xl text-sm text-slate-600">
                  {data.uniquenessDetail}
                </p>
              )}
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-600">
              {verdictCaption}
            </p>

            <div className="mt-5 rounded-xl bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-800">
                {t("notCheckedTitle")}
              </div>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
                {notCheckedItems.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-slate-400" aria-hidden>
                      —
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Disclaimer — prominent card (not petit subtitle), accent but not
              panic-red. Honesty of limits is part of the verdict. */}
          <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex gap-3">
              <svg
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
                />
              </svg>
              <div>
                <div className="font-semibold text-amber-900">
                  {t("disclaimerTitle")}
                </div>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  {t("disclaimerBody")}
                </p>
              </div>
            </div>
          </section>

          {/* Overview */}
          {data.overview && (
            <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">
                {t("overviewTitle")}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-700">
                {data.overview}
              </p>
            </section>
          )}

          {/* Patents table */}
          {patents.length > 0 && (
            <section className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="px-6 py-5">
                <h2 className="text-xl font-semibold text-slate-900">
                  {t("patentsTitle")}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left font-semibold text-slate-700">
                        {headers.id}
                      </th>
                      <th className="px-6 py-3 text-left font-semibold text-slate-700">
                        {headers.title}
                      </th>
                      <th className="px-6 py-3 text-left font-semibold text-slate-700">
                        {headers.year}
                      </th>
                      <th className="px-6 py-3 text-left font-semibold text-slate-700">
                        {headers.country}
                      </th>
                      <th className="px-6 py-3 text-left font-semibold text-slate-700">
                        {headers.similarity}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {patents.map((p) => (
                      <Fragment key={p.id}>
                        <tr className="hover:bg-slate-50">
                          <td className="px-6 py-3 font-mono text-xs text-slate-900">
                            {p.url ? (
                              <a
                                href={p.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline decoration-slate-300 hover:decoration-slate-900"
                              >
                                {p.id}
                              </a>
                            ) : (
                              p.id
                            )}
                          </td>
                          <td className="px-6 py-3 text-slate-700">
                            <div>{p.title}</div>
                            {(p.match || p.diff) && (
                              <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                                {p.match && <div><span className="font-medium text-rose-600">{headers.match}:</span> {p.match}</div>}
                                {p.diff && <div><span className="font-medium text-emerald-600">{headers.diff}:</span> {p.diff}</div>}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-3 text-slate-600">{p.year}</td>
                          <td className="px-6 py-3 text-slate-600">{p.country}</td>
                          <td className="px-6 py-3">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                SIMILARITY_STYLES[p.similarity] ??
                                "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {t(`similarity${p.similarity}` as "similarityHigh" | "similarityMedium" | "similarityLow")}
                            </span>
                          </td>
                        </tr>
                        {/* Industrial Usage — lazy-loaded on click. Free/Starter
                            users get a lock + upsell from the endpoint (403). */}
                        <IndustrialUsageRow
                          patentId={p.id}
                          patentTitle={p.title}
                          colSpan={5}
                        />
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Coverage — make the breadth of bases searched visible (the
              "coverage" axis of the honest-verdict positioning). Bases are a
              static fact of what the engine queried, not a per-country hit
              count — 0 hits in a country still means "searched here". */}
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">
              {t("coverageTitle")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{t("coverageSubtitle")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {coverageBases.map((base, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                >
                  {base}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">{t("coverageNote")}</p>
            <p className="mt-1 text-xs text-slate-500">
              {t("coverageScanned", { n: data.searchTotal ?? patents.length })}
            </p>
          </section>

          {/* Recommendation */}
          {data.recommendation && (
            <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-900 p-6 text-white shadow-sm">
              <h2 className="text-xl font-semibold">
                {t("recommendationTitle")}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-200">
                {data.recommendation}
              </p>
            </section>
          )}

          {/* Deep Analysis CTA — calm, honest, no buy button, no urgency. */}
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">
              {t("deepTitle")}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {t("deepBody")}
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              <li className="flex gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
                <span>{t("deepBullet1")}</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
                <span>{t("deepBullet2")}</span>
              </li>
            </ul>
            {deepInput ? (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={runDeepAnalysis}
                  disabled={deepStatus === "loading"}
                  className="inline-flex items-center justify-center gap-3 rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-700 disabled:hover:bg-slate-700"
                >
                  {deepStatus === "loading" ? (
                    <>
                      <span
                        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white"
                        aria-hidden
                      />
                      <span>{deepRotating ?? deepPhrases[0]}</span>
                    </>
                  ) : (
                    t("deepButtonFree")
                  )}
                </button>
                <p className="mt-2 text-xs text-slate-500">
                  {deepStatus === "loading"
                    ? t("deepLoadingHint")
                    : t("deepFreeHint")}
                </p>
              </div>
            ) : (
              <p className="mt-6 text-xs text-slate-500">{t("deepFreeHint")}</p>
            )}
          </section>

          {/* Deep Analysis result / states */}
          {deepStatus === "used" && (
            <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="font-semibold text-amber-900">{t("deepUsedTitle")}</div>
              <p className="mt-1 text-sm leading-6 text-amber-800">{t("deepUsedBody")}</p>
            </section>
          )}

          {deepStatus === "error" && (
            <section className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5">
              <p className="text-sm leading-6 text-rose-800">{t("deepErrorMsg")}</p>
            </section>
          )}

          {deepStatus === "done" && deepResult && (
            <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">
                {t("deepResultTitle")}
              </h2>

              {/* cross-check #4: when the deep (Sonnet) verdict differs from the
                  fast (Gemini) report verdict, surface it honestly as a
                  "needs a human" signal — framed as the deep pass refining the
                  initial read, not as the engines conflicting. */}
              {(() => {
                const fast = data.uniqueness;
                const deep = deepResult.uniqueness;
                if (!fast || !deep || fast === deep) return null;
                const label = (u: "High" | "Medium" | "Low") =>
                  t(
                    `uniqueness${u}` as
                      | "uniquenessHigh"
                      | "uniquenessMedium"
                      | "uniquenessLow"
                  );
                return (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900">
                      {t("crossCheckTitle")}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-amber-800">
                      {t("crossCheckBody", { fast: label(fast), deep: label(deep) })}
                    </p>
                  </div>
                );
              })()}

              {deepResult.overview && (
                <p className="mt-3 text-sm leading-6 text-slate-700">
                  {deepResult.overview}
                </p>
              )}
              {deepResult.uniquenessDetail && (
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {deepResult.uniquenessDetail}
                </p>
              )}

              {deepResult.features && deepResult.features.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-base font-semibold text-slate-900">
                    {t("deepFeaturesTitle")}
                  </h3>
                  <ul className="mt-3 space-y-4">
                    {deepResult.features.map((f, i) => {
                      const chip =
                        f.status === "novel"
                          ? { cls: "bg-emerald-100 text-emerald-800", label: t("deepStatusNovel") }
                          : f.status === "partially_known"
                            ? { cls: "bg-amber-50 text-amber-700", label: t("deepStatusPartial") }
                            : { cls: "bg-amber-100 text-amber-800", label: t("deepStatusKnown") };
                      return (
                        <li
                          key={i}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <p className="text-sm font-medium text-slate-900">
                              {f.feature}
                            </p>
                            <span
                              className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${chip.cls}`}
                            >
                              {chip.label}
                            </span>
                          </div>
                          {f.note && (
                            <p className="mt-2 text-sm leading-6 text-slate-600">
                              {f.note}
                            </p>
                          )}
                          {f.analogIds && f.analogIds.length > 0 && (
                            <div className="mt-2 text-xs text-slate-500">
                              <span className="font-medium text-slate-600">
                                {t("deepFeatureAnalogs")}
                              </span>{" "}
                              {f.analogIds.map((id, j) => {
                                const match = deepResult.patents?.find(
                                  (p) => p.id === id
                                );
                                const href = match?.url;
                                return (
                                  <span key={id}>
                                    {j > 0 && ", "}
                                    {href && /^https?:\/\//i.test(href) ? (
                                      <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-mono underline decoration-slate-300 hover:decoration-slate-900"
                                      >
                                        {id}
                                      </a>
                                    ) : (
                                      <span className="font-mono">{id}</span>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {deepResult.recommendation && (
                <div className="mt-6 rounded-xl bg-slate-900 p-5 text-white">
                  <h3 className="text-base font-semibold">
                    {t("recommendationTitle")}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-200">
                    {deepResult.recommendation}
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Actions */}
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleExportHtml}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              {t("exportHtml")}
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              {t("exportPdf")}
            </button>
            <Link
              href="/search"
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              {t("ctaPrimary")}
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
