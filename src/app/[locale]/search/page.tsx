"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Header } from "@/components/Header";

type Question = { q: string; placeholder: string };

type Step = "input" | "clarify" | "loading" | "error";

type PatentHit = {
  id: string;
  title?: string;
  titleRu?: string;
  titleEn?: string;
  year?: string;
  country?: string;
  ipc?: string[];
  url?: string;
  abstract?: string;
};

// Full IPC group, e.g. "C21C5/46" (no space).
const IPC_GROUP_RE = /^[A-H]\d{2}[A-Z]\d{1,4}\/\d{1,6}$/;

async function searchLandscape(
  qn: string,
  datasets: string[],
  ipcGroups?: string[]
): Promise<{ hits: PatentHit[]; total: number }> {
  try {
    const r = await fetch("/api/landscape/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qn,
        datasets,
        limit: 30,
        ...(ipcGroups && ipcGroups.length ? { ipcGroups } : {}),
      }),
    });
    if (!r.ok) return { hits: [], total: 0 };
    const j = (await r.json()) as { hits?: PatentHit[]; total?: number };
    return { hits: j.hits ?? [], total: j.total ?? 0 };
  } catch {
    return { hits: [], total: 0 };
  }
}

// Interleave per-task result lists so the merged prefix stays balanced.
function roundRobinMerge(results: { hits: PatentHit[] }[]): PatentHit[] {
  const lists = results.map((r) => r.hits ?? []);
  const out: PatentHit[] = [];
  const seen = new Set<string>();
  const maxLen = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const l of lists) {
      const h = l[i];
      if (h && h.id && !seen.has(h.id)) {
        seen.add(h.id);
        out.push(h);
      }
    }
  }
  return out;
}

export default function SearchPage() {
  const t = useTranslations("Search");
  const router = useRouter();

  const questions = t.raw("questions") as Question[];

  const [step, setStep] = useState<Step>("input");
  const [description, setDescription] = useState("");
  const [answers, setAnswers] = useState<string[]>(() =>
    questions.map(() => "")
  );
  const [loadingMsg, setLoadingMsg] = useState("");
  const [loadingHintMsg, setLoadingHintMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const canContinue = description.trim().length >= 80;

  async function handleNext() {
    if (!canContinue) return;

    setStep("loading");
    setLoadingMsg(t("loadingGate"));
    setLoadingHintMsg(t("loadingGateHint"));

    try {
      const resp = await fetch("/api/search/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      });

      if (!resp.ok) {
        setStep("clarify");
        return;
      }

      const data = (await resp.json()) as {
        sufficient?: boolean;
        reason?: string;
      };

      if (data.sufficient === true) {
        const reason = data.reason ?? "";
        setLoadingMsg(t("gateReason", { reason }));
        setLoadingHintMsg(t("loadingHint"));
        await new Promise((r) => setTimeout(r, 1100));
        await runSearch();
        return;
      }

      setStep("clarify");
    } catch {
      setStep("clarify");
    }
  }

  async function handleSubmit() {
    await runSearch();
  }

  // Single-query fallback used when multi-aspect planning is unavailable.
  async function legacySearch(): Promise<{ hits: PatentHit[]; total: number }> {
    const resp = await fetch("/api/search-rospatent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: description.trim(), limit: 20 }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Search failed (${resp.status})`);
    }
    const data = await resp.json();
    return { hits: data.hits ?? [], total: data.total ?? (data.hits?.length ?? 0) };
  }

  async function runSearch() {
    setStep("loading");
    setLoadingMsg(t("loadingSearch"));
    setLoadingHintMsg(t("loadingHint"));

    try {
      const cleanAnswers = answers.filter((a) => a.trim().length > 0);

      // Prior-art recall is a two-stage problem. PatSearch ranks a doc highly
      // only for a query that paraphrases it, so a single description query
      // misses analogs worded differently. We therefore (1) cast a wide
      // semantic net with aspect-diverse queries, then (2) run an examiner-style
      // class-sweep: derive the IPC groups where the neighbours cluster and
      // re-search each group with the pure-function query — the group filter
      // shrinks competition so functionally-equivalent prior-art floats up.
      let hits: PatentHit[] = [];
      let total = 0;

      const topic = [description.trim(), ...cleanAnswers].join("\n");
      const planResp = await fetch("/api/landscape/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });

      if (planResp.ok) {
        const plan = (await planResp.json()) as {
          queries?: string[];
          queriesEn?: string[];
          functionQuery?: string;
          functionQueryEn?: string;
        };
        const ruQueries = plan.queries ?? [];
        const enQueries = plan.queriesEn ?? [];
        // Per-region buckets: CN crowds out US/EP/JP when datasets are queried
        // together, so each English query is run against [us,ep], [jp], [cn]
        // separately; Russian queries hit RU/CIS.
        const regionBuckets: { datasets: string[]; lang: "ru" | "en" }[] = [
          { datasets: ["ru_since_1994", "ru_till_1994", "cis"], lang: "ru" },
          { datasets: ["us", "ep"], lang: "en" },
          { datasets: ["jp"], lang: "en" },
          { datasets: ["cn"], lang: "en" },
        ];

        // Stage 1 — semantic multi-query (recall breadth).
        const semanticTasks: { qn: string; datasets: string[] }[] = [];
        for (const b of regionBuckets) {
          for (const qn of b.lang === "ru" ? ruQueries : enQueries) {
            semanticTasks.push({ qn, datasets: b.datasets });
          }
        }
        const semanticResults = semanticTasks.length
          ? await Promise.all(
              semanticTasks.map((t) => searchLandscape(t.qn, t.datasets))
            )
          : [];
        total += semanticResults.reduce((acc, r) => acc + r.total, 0);
        const poolSemantic = roundRobinMerge(semanticResults);

        // Stage 2 — prior-art class-sweep over the IPC groups where neighbours
        // cluster, probed with the de-anchored pure-function query.
        const groupFreq = new Map<string, number>();
        for (const h of poolSemantic) {
          for (const g of h.ipc ?? []) {
            if (IPC_GROUP_RE.test(g)) {
              groupFreq.set(g, (groupFreq.get(g) ?? 0) + 1);
            }
          }
        }
        const topGroups = [...groupFreq.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([g]) => g);
        // Probe each group with BOTH a function query and a structure query —
        // the invention spans aspects (e.g. injection function vs cooled
        // structure) and a doc surfaces only for the query that paraphrases it.
        const uniq = (xs: string[]) =>
          [...new Set(xs.filter((x) => x && x.length >= 3))];
        const ruSweepQs = uniq([plan.functionQuery ?? "", ruQueries[0] ?? ""]);
        const enSweepQs = uniq([plan.functionQueryEn ?? "", enQueries[0] ?? ""]);
        const sweepTasks: {
          qn: string;
          datasets: string[];
          ipcGroups: string[];
        }[] = [];
        for (const g of topGroups) {
          for (const b of regionBuckets) {
            for (const qn of b.lang === "ru" ? ruSweepQs : enSweepQs) {
              sweepTasks.push({ qn, datasets: b.datasets, ipcGroups: [g] });
            }
          }
        }
        const sweepResults = sweepTasks.length
          ? await Promise.all(
              sweepTasks.map((t) =>
                searchLandscape(t.qn, t.datasets, t.ipcGroups)
              )
            )
          : [];
        const poolSweep = roundRobinMerge(sweepResults);

        // In-class sweep first (high precision), then the broad semantic pool,
        // so the precise analogs land inside the analyze window.
        const seen = new Set<string>();
        for (const h of [...poolSweep, ...poolSemantic]) {
          if (h.id && !seen.has(h.id)) {
            seen.add(h.id);
            hits.push(h);
          }
        }
      }

      // Fallback to the single-query search if planning yielded nothing.
      if (hits.length === 0) {
        const legacy = await legacySearch();
        hits = legacy.hits;
        total = legacy.total;
      }

      if (hits.length === 0) {
        sessionStorage.setItem("ps_report", JSON.stringify({ empty: true }));
        router.push("/report");
        return;
      }

      // LLM relevance filter: pick the analogs that match by technical meaning
      // from the whole pool, so the analyze window holds real prior-art rather
      // than just the top retrieval hits. Falls back to retrieval order on error.
      try {
        const rankResp = await fetch("/api/prior-art-rank", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: description.trim(),
            // Cap the pool the ranker reads — the sweep-prioritised prefix
            // already holds the in-class analogs, and an oversized list times
            // the model out.
            candidates: hits.slice(0, 400).map((h) => ({
              id: h.id,
              title: h.title || h.titleEn || h.titleRu,
              year: h.year,
              country: h.country,
            })),
            limit: 60,
          }),
        });
        if (rankResp.ok) {
          const { ids } = (await rankResp.json()) as { ids?: string[] };
          if (ids && ids.length > 0) {
            const byId = new Map(hits.map((h) => [h.id, h]));
            const ranked = ids
              .map((id) => byId.get(id))
              .filter((h): h is PatentHit => Boolean(h));
            const rankedIds = new Set(ids);
            hits = [...ranked, ...hits.filter((h) => !rankedIds.has(h.id))];
          }
        }
      } catch {
        // keep retrieval order
      }

      setLoadingMsg(t("loadingAnalyze"));

      const analyzeResp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          answers: cleanAnswers,
          patents: hits,
        }),
      });

      if (!analyzeResp.ok) {
        const err = await analyzeResp.json().catch(() => ({}));
        throw new Error(err.error || `Analyze failed (${analyzeResp.status})`);
      }

      const report = await analyzeResp.json();
      report.searchTotal = total || hits.length;

      sessionStorage.setItem("ps_report", JSON.stringify(report));
      router.push("/report");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }

  return (
    <>
      <Header />
      <main className="flex flex-1 flex-col bg-slate-50">
        <div className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
          {step === "input" && (
            <section>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                {t("title")}
              </h1>
              <p className="mt-3 text-slate-600">{t("subtitle")}</p>
              <div className="mt-8">
                <label
                  htmlFor="desc"
                  className="block text-sm font-medium text-slate-700"
                >
                  {t("textareaLabel")}
                </label>
                <textarea
                  id="desc"
                  rows={10}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("textareaPlaceholder")}
                  className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>{t("minHint")}</span>
                  <span>
                    {t("charCount", { n: description.trim().length })}
                  </span>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!canContinue}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {t("submit")}
                </button>
              </div>
            </section>
          )}

          {step === "clarify" && (
            <section>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                {t("clarifyTitle")}
              </h1>
              <p className="mt-3 text-slate-600">{t("clarifySubtitle")}</p>
              <ul className="mt-8 space-y-5">
                {questions.map((item, i) => (
                  <li
                    key={i}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <label
                      htmlFor={`q-${i}`}
                      className="block text-sm font-semibold text-slate-900"
                    >
                      {item.q}
                    </label>
                    <input
                      id={`q-${i}`}
                      type="text"
                      value={answers[i]}
                      onChange={(e) => {
                        const next = [...answers];
                        next[i] = e.target.value;
                        setAnswers(next);
                      }}
                      placeholder={item.placeholder}
                      className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    />
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep("input")}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {t("back")}
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800"
                >
                  {t("submit")}
                </button>
              </div>
            </section>
          )}

          {step === "loading" && (
            <section className="flex flex-col items-center py-24 text-center">
              <div
                className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900"
                aria-hidden
              />
              <p className="mt-6 text-lg font-semibold text-slate-900">
                {loadingMsg || t("loading")}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {loadingHintMsg || t("loadingHint")}
              </p>
            </section>
          )}

          {step === "error" && (
            <section className="flex flex-col items-center py-24 text-center">
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-8 py-6">
                <h2 className="text-lg font-semibold text-rose-900">
                  {t("errorTitle")}
                </h2>
                <p className="mt-2 text-sm text-rose-700">{errorMsg}</p>
                <button
                  type="button"
                  onClick={() => setStep("clarify")}
                  className="mt-4 inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                >
                  {t("errorRetry")}
                </button>
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
