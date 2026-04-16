"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Header } from "@/components/Header";

type Step = "input" | "loading" | "error";

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

type PlanResponse = {
  topic: string;
  queries: string[];
  ipcSubclasses: string[];
  overviewSeed: string;
};

type SearchResponse = {
  qn: string;
  hits: LandscapeHit[];
  total: number;
};

type SynthesisResponse = {
  topic: string;
  patentsUsed: number;
  overview: string;
  categories: { name: string; description: string; patentIds: string[] }[];
  trends: { title: string; body: string; patentIds: string[] }[];
};

export default function LandscapePage() {
  const t = useTranslations("Landscape");
  const router = useRouter();

  const [step, setStep] = useState<Step>("input");
  const [topic, setTopic] = useState("");
  const [loadingMsg, setLoadingMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const canSubmit = topic.trim().length >= 80;

  async function handleSubmit() {
    setStep("loading");
    setErrorMsg("");

    try {
      setLoadingMsg(t("loadingPlan"));
      const planResp = await fetch("/api/landscape/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() }),
      });
      if (!planResp.ok) {
        const err = await planResp.json().catch(() => ({}));
        throw new Error(err.error || `Plan failed (${planResp.status})`);
      }
      const plan = (await planResp.json()) as PlanResponse;

      if (!plan.queries || plan.queries.length === 0) {
        throw new Error("Plan returned no queries");
      }

      setLoadingMsg(t("loadingSearch", { n: plan.queries.length }));
      const searchPromises = plan.queries.map((qn) =>
        fetch("/api/landscape/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            qn,
            ipcSubclasses: plan.ipcSubclasses,
            limit: 30,
          }),
        }).then(async (r) => {
          if (!r.ok) return { qn, hits: [], total: 0 } as SearchResponse;
          return (await r.json()) as SearchResponse;
        })
      );
      const searchResults = await Promise.all(searchPromises);

      const seen = new Set<string>();
      const hits: LandscapeHit[] = [];
      for (const sr of searchResults) {
        for (const h of sr.hits ?? []) {
          if (!h.id || seen.has(h.id)) continue;
          seen.add(h.id);
          hits.push(h);
        }
      }

      if (hits.length === 0) {
        sessionStorage.setItem(
          "ps_landscape",
          JSON.stringify({ empty: true, topic: topic.trim() })
        );
        router.push("/landscape/report");
        return;
      }

      const totalAcrossQueries = searchResults.reduce(
        (acc, sr) => acc + (sr.total ?? 0),
        0
      );

      setLoadingMsg(t("loadingSynthesize", { n: hits.length }));
      const synthResp = await fetch("/api/landscape/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          patents: hits.slice(0, 200),
        }),
      });
      if (!synthResp.ok) {
        const err = await synthResp.json().catch(() => ({}));
        throw new Error(err.error || `Synthesize failed (${synthResp.status})`);
      }
      const synthesis = (await synthResp.json()) as SynthesisResponse;

      sessionStorage.setItem(
        "ps_landscape",
        JSON.stringify({
          topic: topic.trim(),
          plan: {
            queries: plan.queries,
            ipcSubclasses: plan.ipcSubclasses,
            overviewSeed: plan.overviewSeed,
          },
          hits,
          totalAcrossQueries,
          synthesis,
        })
      );
      router.push("/landscape/report");
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
                  htmlFor="topic"
                  className="block text-sm font-medium text-slate-700"
                >
                  {t("textareaLabel")}
                </label>
                <textarea
                  id="topic"
                  rows={8}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={t("textareaPlaceholder")}
                  className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>{t("minHint")}</span>
                  <span>{t("charCount", { n: topic.trim().length })}</span>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
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
              <p className="mt-2 text-sm text-slate-500">{t("loadingHint")}</p>
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
                  onClick={() => setStep("input")}
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
