"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Header } from "@/components/Header";
import { useSessionJSON } from "@/lib/use-session-json";

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

export default function LandscapeReportPage() {
  const t = useTranslations("LandscapeReport");
  const { data, loaded } = useSessionJSON<LandscapeData>("ps_landscape");

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
              href="/landscape"
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

  return (
    <>
      <Header />
      <main className="flex flex-1 flex-col bg-slate-50">
        <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-16">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("title")}
          </h1>
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
                  <a
                    href={h.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                  >
                    {h.id}
                  </a>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">{h.year}</span>
                  <span className="text-slate-400">·</span>
                  <span className="flex-1 text-slate-700">{h.title}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Actions */}
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-end">
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
