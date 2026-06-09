"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Header } from "@/components/Header";
import { retrieveNoveltyPriorArt } from "@/lib/novelty-retrieval";
import { retrieveNoveltyPriorArt as retrieveNoveltyPriorArtV2 } from "@/lib/novelty-retrieval-v2";
import { RETRIEVAL_V2_ENABLED } from "@/lib/config";
import type { FieldPatentInput } from "@/lib/field-view";
import { QuotaExceededBlock } from "@/components/QuotaExceededBlock";
import { useRotatingText } from "@/hooks/useRotatingText";

type Question = { q: string; placeholder: string };

type Step = "input" | "clarify" | "loading" | "error" | "quota";

type QuotaInfo = { tier: string; limit: number; used: number };

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
  // Rotating phrases for the long search phase (1–2 min) so it doesn't look
  // frozen. `t.raw` is memoized to keep the array reference stable across
  // renders — otherwise useEffect inside useRotatingText would reset every tick.
  const searchPhrases = useMemo(
    () => t.raw("loadingPhrases") as string[],
    [t]
  );
  const [activePhrases, setActivePhrases] = useState<string[] | null>(null);
  const rotatingMsg = useRotatingText(activePhrases, 7000);
  const [errorMsg, setErrorMsg] = useState("");
  const [quotaInfo, setQuotaInfo] = useState<QuotaInfo | null>(null);
  // Экспертный поиск (opt-in из чузера: ?mode=expert) форсит recall-v2 + поле
  // независимо от прод-флага RETRIEVAL_V2_ENABLED (он держит /search-дефолт на v1,
  // Гардрейл A). Читаем из URL один раз на маунте — без useSearchParams (Suspense).
  const [expert] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("mode") === "expert"
  );
  const useV2 = RETRIEVAL_V2_ENABLED || expert;

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

  async function runSearch() {
    setStep("loading");
    setLoadingMsg("");
    setActivePhrases(searchPhrases);
    setLoadingHintMsg(t("loadingHint"));

    try {
      const cleanAnswers = answers.filter((a) => a.trim().length > 0);

      // v2 retrieval (gated by RETRIEVAL_V2_ENABLED) returns the full pool
      // window-first plus diagnostics.ranked (the LLM-ranked window size). Both
      // versions share the same result shape; v2 additionally feeds the Expert
      // Field-View. v1 stays the verdict-only prod path until the recall-v2 hold lifts.
      const { hits, total, diagnostics } = useV2
        ? await retrieveNoveltyPriorArtV2({
            description: description.trim(),
            answers: cleanAnswers,
            depth: "full",
          })
        : await retrieveNoveltyPriorArt({
            description: description.trim(),
            answers: cleanAnswers,
          });

      if (hits.length === 0) {
        sessionStorage.setItem("ps_report", JSON.stringify({ empty: true }));
        router.push("/report");
        return;
      }

      setActivePhrases(null);
      setLoadingMsg(t("loadingAnalyze"));

      const analyzeResp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          answers: cleanAnswers,
          patents: hits,
          engine: useV2 ? "v2" : "v1",
        }),
      });

      if (analyzeResp.status === 402) {
        const q = await analyzeResp.json().catch(() => ({}));
        setQuotaInfo({
          tier: String(q.tier ?? ""),
          limit: Number(q.limit ?? 0),
          used: Number(q.used ?? 0),
        });
        setStep("quota");
        return;
      }

      if (!analyzeResp.ok) {
        const err = await analyzeResp.json().catch(() => ({}));
        throw new Error(err.error || `Analyze failed (${analyzeResp.status})`);
      }

      const report = await analyzeResp.json();
      report.searchTotal = total || hits.length;

      report._input = {
        description: description.trim(),
        answers: cleanAnswers,
        patents: hits.slice(0, 60),
      };

      // Account tier — drives the report's smart Verdict/Field default.
      report._tier = report.tier ?? null;
      // Expert-search runs land on the Field view by default (report reads this).
      report._expert = expert;

      // Expert Field-View payload: the FULL pool (window-first) trimmed to the
      // fields the field view needs (abstracts dropped to keep sessionStorage
      // bounded), plus the ranked-window size that marks "close" patents. Only
      // attached under v2 (flag OR expert) — without it the report stays verdict-only.
      if (useV2 && hits.length > 0) {
        const pool: FieldPatentInput[] = hits.map((h) => ({
          id: h.id,
          title: h.title,
          titleRu: h.titleRu,
          titleEn: h.titleEn,
          year: h.year,
          country: h.country,
          url: h.url,
          ipc: h.ipc,
        }));
        report._field = { pool, ranked: diagnostics?.ranked ?? 0 };
      }

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
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {expert ? t("typeBadgeExpert") : t("typeBadge")}
              </span>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
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
                {rotatingMsg || loadingMsg || t("loading")}
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

          {step === "quota" && quotaInfo && (
            <QuotaExceededBlock
              operation="search"
              tier={quotaInfo.tier}
              limit={quotaInfo.limit}
              used={quotaInfo.used}
              onBack={() => {
                setQuotaInfo(null);
                setStep("input");
              }}
            />
          )}
        </div>
      </main>
    </>
  );
}
