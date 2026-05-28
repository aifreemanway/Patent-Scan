"use client";

import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Header } from "@/components/Header";
import { useSessionJSON } from "@/lib/use-session-json";

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

type ReportData = {
  empty?: boolean;
  uniqueness?: "High" | "Medium" | "Low";
  uniquenessDetail?: string;
  overview?: string;
  patents?: ReportPatent[];
  recommendation?: string;
  searchTotal?: number;
};

const UNIQUENESS_STYLES: Record<string, string> = {
  High: "text-emerald-700",
  Medium: "text-amber-700",
  Low: "text-rose-700",
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
}): string {
  const { data, t, headers, uniquenessLabel, locale, autoPrint } = args;
  const patents = data.patents ?? [];
  const uniqueness = data.uniqueness ?? "Medium";

  const idLink = (id: string, url: string | undefined | null) => {
    const href = safeHref(url);
    return href
      ? `<a class="mono" href="${href}" target="_blank" rel="noopener noreferrer">${esc(id)}</a>`
      : `<span class="mono">${esc(id)}</span>`;
  };

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
${uniquenessHtml}
${overviewHtml}
${patentsHtml}
${sourcesHtml}
${recoHtml}
</div>
${printScript}
</body>
</html>`;
}

export default function ReportPage() {
  const t = useTranslations("Report");
  const locale = useLocale();
  const { data, loaded } = useSessionJSON<ReportData>("ps_report");

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

  const fileBase = `patent-uniqueness-${new Date().toISOString().slice(0, 10)}`;

  const handleExportHtml = () => {
    const html = buildSearchReportHtml({
      data,
      t,
      headers,
      uniquenessLabel,
      locale,
      autoPrint: false,
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

          {/* Uniqueness indicator */}
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-slate-500">
                  {t("uniquenessLabel")}
                </div>
                <div className={`mt-1 text-4xl font-bold ${UNIQUENESS_STYLES[uniqueness] ?? "text-slate-900"}`}>
                  {uniquenessLabel}
                </div>
              </div>
              <p className="max-w-xl text-sm text-slate-600">
                {data.uniquenessDetail ?? ""}
              </p>
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
                      <tr key={p.id} className="hover:bg-slate-50">
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
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Sources */}
          <section className="mt-8">
            <h2 className="text-xl font-semibold text-slate-900">
              {t("sourcesTitle")}
            </h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-3">
              <li className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="font-semibold text-slate-900">{t("sourceRospatent")}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {t("sourceCount", { n: data.searchTotal ?? patents.length })}
                </div>
              </li>
            </ul>
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
