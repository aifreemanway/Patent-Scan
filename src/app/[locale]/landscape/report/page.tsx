"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Header } from "@/components/Header";
import { useSessionJSON } from "@/lib/use-session-json";
import { useReopenRow } from "@/hooks/useReopenRow";
import type { LegalStatus, LegalStatusState } from "@/lib/patent-legal-status";

type LandscapeHit = {
  id: string;
  title: string;
  titleRu?: string;
  titleEn?: string;
  year: string;
  country: string;
  ipc: string[];
  url: string;
  abstract: string;
};

type Category = { name: string; description: string; patentIds: string[] };
type Trend = { title: string; body: string; patentIds: string[] };

type LandscapeData = {
  empty?: boolean;
  topic?: string;
  plan?: {
    queries: string[];
    ipcSubclasses: string[];
    overviewSeed: string;
  };
  hits?: LandscapeHit[];
  totalAcrossQueries?: number;
  synthesis?: {
    overview: string;
    categories: Category[];
    trends: Trend[];
  };
};

const COUNTRY_GROUPS: { key: string; codes: string[] }[] = [
  { key: "RU", codes: ["RU"] },
  { key: "SU", codes: ["SU"] },
  { key: "US", codes: ["US"] },
  { key: "EP", codes: ["EP"] },
  { key: "CN", codes: ["CN"] },
  { key: "JP", codes: ["JP"] },
  { key: "CIS", codes: ["EA", "KZ", "BY", "UZ", "AM", "AZ", "KG", "MD", "TJ", "TM"] },
];

const PERIODS: { label: string; from: number; to: number }[] = [
  { label: "1930–1969", from: 1930, to: 1969 },
  { label: "1970–1989", from: 1970, to: 1989 },
  { label: "1990–1999", from: 1990, to: 1999 },
  { label: "2000–2009", from: 2000, to: 2009 },
  { label: "2010–2019", from: 2010, to: 2019 },
  { label: "2020+", from: 2020, to: 9999 },
];

function groupByCountry(hits: LandscapeHit[]): Record<string, LandscapeHit[]> {
  const groups: Record<string, LandscapeHit[]> = {};
  for (const g of COUNTRY_GROUPS) groups[g.key] = [];
  groups.OTHER = [];
  for (const h of hits) {
    const g = COUNTRY_GROUPS.find((x) => x.codes.includes(h.country));
    if (g) groups[g.key].push(h);
    else groups.OTHER.push(h);
  }
  return groups;
}

function buildMatrix(hits: LandscapeHit[]) {
  const matrix: Record<string, Record<string, number>> = {};
  const groupKeys = [...COUNTRY_GROUPS.map((g) => g.key), "OTHER"];
  for (const p of PERIODS) {
    matrix[p.label] = {};
    for (const k of groupKeys) matrix[p.label][k] = 0;
  }
  for (const h of hits) {
    const year = parseInt(h.year, 10);
    if (!Number.isFinite(year)) continue;
    const period = PERIODS.find((p) => year >= p.from && year <= p.to);
    if (!period) continue;
    const g = COUNTRY_GROUPS.find((x) => x.codes.includes(h.country));
    const key = g ? g.key : "OTHER";
    matrix[period.label][key] += 1;
  }
  return matrix;
}

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
.wrap{max-width:1000px;margin:0 auto}
h1{font-size:28px;font-weight:700;margin:0 0 4px}
h2{font-size:20px;font-weight:600;margin:32px 0 12px}
h3{font-size:16px;font-weight:600;margin:0}
.topic{color:#475569;font-size:14px;margin:0 0 8px}
.counters{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}
.counter{border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;min-width:150px}
.counter .label{font-size:13px;color:#64748b}
.counter .value{font-size:28px;font-weight:700}
.card{border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:12px 0}
.card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top}
th{background:#f8fafc;font-weight:600}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
a{color:#2563eb}
.chips{margin-top:8px}
.chip{display:inline-block;border:1px solid #e2e8f0;border-radius:6px;padding:1px 6px;margin:2px 2px 0 0;font-family:ui-monospace,monospace;font-size:12px;text-decoration:none;color:#334155}
.muted{color:#64748b}
.cat{border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:8px 0}
.trend{border-left:4px solid #0f172a;background:#f8fafc;padding:12px 16px;margin:8px 0}
.num{text-align:right;font-variant-numeric:tabular-nums}
.zero{color:#cbd5e1}
ul{margin:8px 0;padding-left:20px}
.appendix li{margin:2px 0}
@media print{body{padding:0}.card,.counter,.cat,.trend{break-inside:avoid}a{text-decoration:underline}}
`;

type ReportT = (key: string, values?: Record<string, string | number>) => string;

function buildReportHtml(args: {
  data: LandscapeData;
  hits: LandscapeHit[];
  grouped: Record<string, LandscapeHit[]>;
  matrix: Record<string, Record<string, number>>;
  counters: { total: number; ru: number; cn: number; jp: number; epus: number };
  hitById: Map<string, LandscapeHit>;
  legalCounts: Record<LegalStatusState, number> | null;
  t: ReportT;
  locale: string;
  autoPrint: boolean;
}): string {
  const { data, hits, grouped, matrix, counters, hitById, legalCounts, t, locale, autoPrint } =
    args;
  const synthesis = data.synthesis;
  const overviewParas = synthesis?.overview.split(/\n\n+/).filter(Boolean) ?? [];
  const groupKeys = [...COUNTRY_GROUPS.map((g) => g.key), "OTHER"];

  const idLink = (id: string, url: string | undefined | null) => {
    const href = safeHref(url);
    return href
      ? `<a class="mono" href="${href}" target="_blank" rel="noopener noreferrer">${esc(id)}</a>`
      : `<span class="mono">${esc(id)}</span>`;
  };

  const chip = (id: string) => {
    const href = safeHref(hitById.get(id)?.url);
    return href
      ? `<a class="chip" href="${href}" target="_blank" rel="noopener noreferrer">${esc(id)}</a>`
      : `<span class="chip">${esc(id)}</span>`;
  };

  const countersHtml = `<div class="counters">${[
    { label: t("counterTotal"), value: counters.total },
    { label: t("counterRu"), value: counters.ru },
    { label: t("counterCn"), value: counters.cn },
    { label: t("counterJp"), value: counters.jp },
    { label: t("counterEpUs"), value: counters.epus },
  ]
    .map(
      (c) =>
        `<div class="counter"><div class="label">${esc(c.label)}</div><div class="value">${c.value}</div></div>`,
    )
    .join("")}</div>`;

  const legalStatusHtml = legalCounts
    ? `<section class="card"><h3>${esc(t("legalStatusTitle"))}</h3><p style="font-weight:600;margin:4px 0 0">${esc(
        t("legalStatusLine", {
          active: legalCounts["действует"],
          inactive: legalCounts["не действует"],
          restorable: legalCounts["восстановим"],
          expired: legalCounts["истёк"],
          unknown: legalCounts["не определён"],
        }),
      )}</p><p class="muted" style="margin-top:6px">${esc(t("legalStatusCaveat"))}</p></section>`
    : "";

  const overviewHtml = overviewParas.length
    ? `<section class="card"><h2>${esc(t("overviewTitle"))}</h2>${overviewParas
        .map((p) => `<p>${esc(p)}</p>`)
        .join("")}</section>`
    : "";

  const planHtml = data.plan
    ? `<section class="card"><h2>${esc(t("planTitle"))}</h2>` +
      `<div><strong>${esc(t("planQueries"))}:</strong><ul>${data.plan.queries
        .map((q) => `<li>${esc(q)}</li>`)
        .join("")}</ul></div>` +
      (data.plan.ipcSubclasses.length
        ? `<div><strong>${esc(t("planIpc"))}:</strong> <span class="mono">${esc(
            data.plan.ipcSubclasses.join(", "),
          )}</span></div>`
        : "") +
      `</section>`
    : "";

  const byCountryHtml = `<h2>${esc(t("byCountryTitle"))}</h2>${groupKeys
    .filter((k) => grouped[k] && grouped[k].length > 0)
    .map((key) => {
      const rows = grouped[key]
        .map(
          (h) =>
            `<tr><td>${idLink(h.id, h.url)}</td><td>${esc(
              h.title || h.titleEn || h.titleRu,
            )}</td><td>${esc(h.year)}</td><td class="mono">${esc(
              h.ipc.slice(0, 3).join(", "),
            )}</td></tr>`,
        )
        .join("");
      return `<section class="card"><div class="card-head"><h3>${
        key === "OTHER" ? esc(t("countryOther")) : esc(key)
      }</h3><span class="muted">${esc(
        t("countryCount", { n: grouped[key].length }),
      )}</span></div><table><thead><tr><th>${esc(t("colId"))}</th><th>${esc(
        t("colTitle"),
      )}</th><th>${esc(t("colYear"))}</th><th>${esc(
        t("colIpc"),
      )}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    })
    .join("")}`;

  const categoriesHtml =
    synthesis && synthesis.categories.length
      ? `<section class="card"><h2>${esc(t("categoriesTitle"))}</h2>${synthesis.categories
          .map(
            (c) =>
              `<div class="cat"><h3>${esc(c.name)}</h3><p class="muted">${esc(
                c.description,
              )}</p><div class="chips">${c.patentIds.map(chip).join("")}</div></div>`,
          )
          .join("")}</section>`
      : "";

  const matrixHtml = `<section class="card"><h2>${esc(t("matrixTitle"))}</h2><table><thead><tr><th>${esc(
    t("matrixPeriod"),
  )}</th>${groupKeys
    .map((k) => `<th class="num">${k === "OTHER" ? esc(t("countryOther")) : esc(k)}</th>`)
    .join("")}</tr></thead><tbody>${PERIODS.map((p) => {
    const cells = groupKeys
      .map((k) => {
        const v = matrix[p.label][k];
        return `<td class="num${v > 0 ? "" : " zero"}">${v}</td>`;
      })
      .join("");
    return `<tr><td><strong>${esc(p.label)}</strong></td>${cells}</tr>`;
  }).join("")}</tbody></table></section>`;

  const trendsHtml =
    synthesis && synthesis.trends.length
      ? `<section class="card"><h2>${esc(t("trendsTitle"))}</h2>${synthesis.trends
          .map(
            (tr) =>
              `<div class="trend"><h3>${esc(tr.title)}</h3><p>${esc(tr.body)}</p>${
                tr.patentIds.length
                  ? `<div class="chips">${tr.patentIds.map(chip).join("")}</div>`
                  : ""
              }</div>`,
          )
          .join("")}</section>`
      : "";

  const appendixHtml = `<section class="card"><h2>${esc(t("appendixTitle"))}</h2><p class="muted">${esc(
    t("appendixCount", { n: hits.length }),
  )}</p><ul class="appendix">${hits
    .map(
      (h) =>
        `<li>${idLink(h.id, h.url)} <span class="muted">· ${esc(h.year)} ·</span> ${esc(
          h.title,
        )}</li>`,
    )
    .join("")}</ul></section>`;

  const printScript = autoPrint
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});</script>`
    : "";

  return `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t("title"))}${data.topic ? " — " + esc(data.topic) : ""}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
<h1>${esc(t("title"))}</h1>
<p class="subtitle" style="color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin:8px 0 16px;font-size:14px">${esc(t("caveatNotice"))}</p>
${data.topic ? `<p class="topic"><strong>${esc(t("topicLabel"))}:</strong> ${esc(data.topic)}</p>` : ""}
${countersHtml}
${legalStatusHtml}
${overviewHtml}
${planHtml}
${byCountryHtml}
${categoriesHtml}
${matrixHtml}
${trendsHtml}
${appendixHtml}
<section class="card" style="border-color:#fcd34d;background:#fffbeb;margin-top:24px"><strong style="color:#92400e">${esc(t("caveatTitle"))}</strong><p style="color:#92400e;margin:4px 0 0">${esc(t("caveatBody"))}</p></section>
</div>
${printScript}
</body>
</html>`;
}

function LandscapeReportInner() {
  const t = useTranslations("LandscapeReport");
  const locale = useLocale();
  const { data: sessionData, loaded } = useSessionJSON<LandscapeData>("ps_landscape");

  // Re-open from /account/history: rebuild from the persisted row when the
  // sessionStorage fast path is empty but the URL carries ?id=. The synthesis
  // (overview/categories/trends) always restores; the patent breakdown restores
  // only if `hits` were persisted with the run (newer runs) — older rows show
  // the synthesis with empty country/appendix tables rather than "Нет данных".
  const reopen = useReopenRow(loaded && !sessionData);
  const data = useMemo<LandscapeData | null>(() => {
    if (sessionData) return sessionData;
    if (reopen.state === "done" && reopen.row?.result) {
      const r = reopen.row.result as {
        topic?: string;
        overview?: string;
        categories?: Category[];
        trends?: Trend[];
        hits?: LandscapeHit[];
      };
      return {
        topic: r.topic,
        hits: r.hits ?? [],
        synthesis: {
          overview: r.overview ?? "",
          categories: r.categories ?? [],
          trends: r.trends ?? [],
        },
      };
    }
    return null;
  }, [sessionData, reopen.state, reopen.row]);

  // Stable reference so the useMemo deps below don't invalidate on every
  // render (was flagged by react-hooks/exhaustive-deps).
  const hits = useMemo(() => data?.hits ?? [], [data]);
  const grouped = useMemo(() => groupByCountry(hits), [hits]);
  const matrix = useMemo(() => buildMatrix(hits), [hits]);
  const counters = useMemo(() => {
    const total = hits.length;
    const ru = hits.filter((h) => h.country === "RU" || h.country === "SU").length;
    const cn = hits.filter((h) => h.country === "CN").length;
    const jp = hits.filter((h) => h.country === "JP").length;
    const epus = hits.filter((h) => h.country === "EP" || h.country === "US").length;
    return { total, ru, cn, jp, epus };
  }, [hits]);
  const hitById = useMemo(() => {
    const m = new Map<string, LandscapeHit>();
    for (const h of hits) m.set(h.id, h);
    return m;
  }, [hits]);

  // RU legal-status counter (Этап 1). Computed by batching the RU hits' numbers
  // to /api/legal-status. Lazy — fetched after first render so a 400-patent
  // landscape doesn't block the page; a spinner shows while in flight.
  const ruNumbers = useMemo(
    () =>
      Array.from(
        new Set(
          hits
            .filter((h) => h.country === "RU" || h.country === "SU")
            // Full id (with kind) so the resolver picks RUPM vs RUPAT; also the
            // statuses-map lookup key below (QA#2).
            .map((h) => h.id.trim())
            .filter((id) => Boolean(id) && /\d/.test(id))
        )
      ),
    [hits]
  );
  const [legalLoading, setLegalLoading] = useState(false);
  const [legalCounts, setLegalCounts] = useState<Record<LegalStatusState, number> | null>(
    null
  );

  useEffect(() => {
    if (ruNumbers.length === 0) {
      setLegalCounts(null);
      return;
    }
    let cancelled = false;
    setLegalLoading(true);
    void (async () => {
      try {
        const resp = await fetch("/api/legal-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ numbers: ruNumbers }),
        });
        if (!resp.ok) return; // anti-fab: no counts rather than guessed ones
        const json = (await resp.json()) as {
          statuses?: Record<string, LegalStatus>;
        };
        if (cancelled || !json.statuses) return;
        const counts: Record<LegalStatusState, number> = {
          действует: 0,
          "не действует": 0,
          восстановим: 0,
          истёк: 0,
          "не определён": 0,
        };
        for (const num of ruNumbers) {
          const st = json.statuses[num];
          // A RU number with no returned status is counted as "не определён"
          // (anti-fab fallback — never silently dropped).
          counts[st?.state ?? "не определён"] += 1;
        }
        setLegalCounts(counts);
      } catch {
        // network error — leave counts null (no fabrication)
      } finally {
        if (!cancelled) setLegalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ruNumbers]);

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

  // Re-open in progress: fetching the persisted row from history.
  if (!data && reopen.id && (reopen.state === "idle" || reopen.state === "loading")) {
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
    const isError = reopen.id != null && reopen.state === "error";
    const isProcessing = reopen.id != null && reopen.state === "processing";
    const title = isError
      ? t("reopenErrorTitle")
      : isProcessing
        ? t("reopenProcessingTitle")
        : t("missingTitle");
    const body = isError
      ? reopen.row?.error_message || t("reopenErrorBody")
      : isProcessing
        ? t("reopenProcessingBody")
        : t("missingBody");
    const reopenContext = isError || isProcessing;
    return (
      <>
        <Header />
        <main className="flex flex-1 flex-col bg-slate-50">
          <div className="mx-auto w-full max-w-3xl px-6 py-24 text-center">
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
            <p className="mt-3 text-slate-600">{body}</p>
            <Link
              href={reopenContext ? "/account/history" : "/landscape"}
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              {reopenContext ? t("reopenBackToHistory") : t("ctaPrimary")}
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
            <h1 className="text-2xl font-bold text-slate-900">{t("emptyTitle")}</h1>
            <p className="mt-3 text-slate-600">{t("emptyBody")}</p>
            <Link
              href="/landscape"
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              {t("emptyCta")}
            </Link>
          </div>
        </main>
      </>
    );
  }

  const synthesis = data.synthesis;
  const overviewParas = synthesis?.overview.split(/\n\n+/).filter(Boolean) ?? [];

  const fileBase = `patent-landscape-${new Date().toISOString().slice(0, 10)}`;

  const handleExportHtml = () => {
    const html = buildReportHtml({
      data,
      hits,
      grouped,
      matrix,
      counters,
      hitById,
      legalCounts,
      t,
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
    const html = buildReportHtml({
      data,
      hits,
      grouped,
      matrix,
      counters,
      hitById,
      legalCounts,
      t,
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
        <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-16">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("title")}
          </h1>
          {/* Trust caveat — ГОСТ Р 15.011-2024 disclaimer (mandatory before any demo) */}
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t("caveatNotice")}
          </p>
          {data.topic && (
            <p className="mt-3 max-w-4xl text-sm text-slate-600">
              <span className="font-semibold text-slate-700">{t("topicLabel")}:</span>{" "}
              {data.topic}
            </p>
          )}

          {/* 5 counters */}
          <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: t("counterTotal"), value: counters.total },
              { label: t("counterRu"), value: counters.ru },
              { label: t("counterCn"), value: counters.cn },
              { label: t("counterJp"), value: counters.jp },
              { label: t("counterEpUs"), value: counters.epus },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="text-sm font-medium text-slate-500">{c.label}</div>
                <div className="mt-1 text-3xl font-bold text-slate-900">
                  {c.value}
                </div>
              </div>
            ))}
          </section>

          {/* RU legal-status counter (Этап 1) — lazy-fetched from ФИПС. */}
          {ruNumbers.length > 0 && (
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-medium text-slate-500">
                {t("legalStatusTitle")}
              </div>
              {legalCounts ? (
                <>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {t("legalStatusLine", {
                      active: legalCounts["действует"],
                      inactive: legalCounts["не действует"],
                      restorable: legalCounts["восстановим"],
                      expired: legalCounts["истёк"],
                      unknown: legalCounts["не определён"],
                    })}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {t("legalStatusCaveat")}
                  </p>
                </>
              ) : (
                <div className="mt-2 flex items-center gap-2 text-sm text-slate-400">
                  {legalLoading && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-400" />
                  )}
                  <span>{t("legalStatusLoading")}</span>
                </div>
              )}
            </section>
          )}

          {/* Overview */}
          {overviewParas.length > 0 && (
            <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">
                {t("overviewTitle")}
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700">
                {overviewParas.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </section>
          )}

          {/* Plan info */}
          {data.plan && (
            <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">
                {t("planTitle")}
              </h2>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <div>
                  <div className="font-medium text-slate-900">{t("planQueries")}:</div>
                  <ul className="mt-1 list-disc pl-5 text-slate-600">
                    {data.plan.queries.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
                {data.plan.ipcSubclasses.length > 0 && (
                  <div>
                    <span className="font-medium text-slate-900">{t("planIpc")}:</span>{" "}
                    <span className="font-mono text-xs text-slate-600">
                      {data.plan.ipcSubclasses.join(", ")}
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Patents by country */}
          <section className="mt-8">
            <h2 className="text-xl font-semibold text-slate-900">
              {t("byCountryTitle")}
            </h2>
            <div className="mt-4 space-y-6">
              {[...COUNTRY_GROUPS.map((g) => g.key), "OTHER"]
                .filter((k) => grouped[k] && grouped[k].length > 0)
                .map((key) => (
                  <div
                    key={key}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="flex items-center justify-between bg-slate-50 px-6 py-4">
                      <h3 className="text-lg font-semibold text-slate-900">
                        {key === "OTHER" ? t("countryOther") : key}
                      </h3>
                      <span className="text-sm text-slate-500">
                        {t("countryCount", { n: grouped[key].length })}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-white">
                          <tr>
                            <th className="px-6 py-3 text-left font-semibold text-slate-700">
                              {t("colId")}
                            </th>
                            <th className="px-6 py-3 text-left font-semibold text-slate-700">
                              {t("colTitle")}
                            </th>
                            <th className="px-6 py-3 text-left font-semibold text-slate-700">
                              {t("colYear")}
                            </th>
                            <th className="px-6 py-3 text-left font-semibold text-slate-700">
                              {t("colIpc")}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {grouped[key].map((h) => (
                            <tr key={h.id} className="hover:bg-slate-50">
                              <td className="px-6 py-3 font-mono text-xs text-slate-900">
                                {h.url ? (
                                  <a
                                    href={h.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline decoration-slate-300 hover:decoration-slate-900"
                                  >
                                    {h.id}
                                  </a>
                                ) : (
                                  h.id
                                )}
                              </td>
                              <td className="px-6 py-3 text-slate-700">
                                {h.title || h.titleEn || h.titleRu}
                              </td>
                              <td className="px-6 py-3 text-slate-600">{h.year}</td>
                              <td className="px-6 py-3 font-mono text-xs text-slate-500">
                                {h.ipc.slice(0, 3).join(", ")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
            </div>
          </section>

          {/* Categories */}
          {synthesis && synthesis.categories.length > 0 && (
            <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">
                {t("categoriesTitle")}
              </h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {synthesis.categories.map((c, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-5"
                  >
                    <div className="text-base font-semibold text-slate-900">
                      {c.name}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{c.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {c.patentIds.map((id) => {
                        const h = hitById.get(id);
                        return (
                          <a
                            key={id}
                            href={h?.url || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-md bg-white px-2 py-0.5 font-mono text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                          >
                            {id}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Geography × time matrix */}
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">
              {t("matrixTitle")}
            </h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">
                      {t("matrixPeriod")}
                    </th>
                    {[...COUNTRY_GROUPS.map((g) => g.key), "OTHER"].map((k) => (
                      <th
                        key={k}
                        className="px-3 py-2 text-right font-semibold text-slate-700"
                      >
                        {k === "OTHER" ? t("countryOther") : k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {PERIODS.map((p) => (
                    <tr key={p.label}>
                      <td className="px-3 py-2 font-medium text-slate-700">
                        {p.label}
                      </td>
                      {[...COUNTRY_GROUPS.map((g) => g.key), "OTHER"].map((k) => {
                        const v = matrix[p.label][k];
                        return (
                          <td
                            key={k}
                            className={`px-3 py-2 text-right tabular-nums ${
                              v > 0 ? "text-slate-900" : "text-slate-300"
                            }`}
                          >
                            {v}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Trends */}
          {synthesis && synthesis.trends.length > 0 && (
            <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">
                {t("trendsTitle")}
              </h2>
              <div className="mt-4 space-y-4">
                {synthesis.trends.map((tr, i) => (
                  <div
                    key={i}
                    className="rounded-xl border-l-4 border-slate-900 bg-slate-50 px-5 py-4"
                  >
                    <div className="text-base font-semibold text-slate-900">
                      {tr.title}
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{tr.body}</p>
                    {tr.patentIds.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {tr.patentIds.map((id) => {
                          const h = hitById.get(id);
                          return (
                            <a
                              key={id}
                              href={h?.url || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-md bg-white px-2 py-0.5 font-mono text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                            >
                              {id}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Full list appendix */}
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">
              {t("appendixTitle")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {t("appendixCount", { n: hits.length })}
            </p>
            <ul className="mt-4 space-y-1 text-sm">
              {hits.map((h) => (
                <li key={h.id} className="flex gap-2">
                  {h.url ? (
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                    >
                      {h.id}
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-slate-900">{h.id}</span>
                  )}
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">{h.year}</span>
                  <span className="text-slate-400">·</span>
                  <span className="flex-1 text-slate-700">{h.title}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Trust caveat — ГОСТ Р 15.011-2024 disclaimer (mandatory before any demo) */}
          <section className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5">
            <strong className="text-amber-900">{t("caveatTitle")}</strong>
            <p className="mt-1 text-sm leading-6 text-amber-900">{t("caveatBody")}</p>
          </section>

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
              href="/landscape"
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

// useSearchParams (via useReopenRow) requires a Suspense boundary on a
// statically-prerendered page — otherwise `next build` bails on CSR.
export default function LandscapeReportPage() {
  return (
    <Suspense
      fallback={
        <>
          <Header />
          <main className="flex flex-1 flex-col items-center justify-center bg-slate-50 py-24">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
          </main>
        </>
      }
    >
      <LandscapeReportInner />
    </Suspense>
  );
}
