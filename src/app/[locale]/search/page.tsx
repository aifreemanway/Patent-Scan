"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Header } from "@/components/Header";

type Question = { q: string; placeholder: string };

type Step = "input" | "clarify" | "loading" | "error";

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
  const [errorMsg, setErrorMsg] = useState("");

  const canContinue = description.trim().length >= 80;

  function handleNext() {
    if (!canContinue) return;
    setStep("clarify");
  }

  async function handleSubmit() {
    setStep("loading");
    setLoadingMsg(t("loadingSearch"));

    try {
      const searchResp = await fetch("/api/search-rospatent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: description.trim(), limit: 20 }),
      });

      if (!searchResp.ok) {
        const err = await searchResp.json().catch(() => ({}));
        throw new Error(err.error || `Search failed (${searchResp.status})`);
      }

      const searchData = await searchResp.json();
      const patents = searchData.hits ?? [];

      if (patents.length === 0) {
        sessionStorage.setItem("ps_report", JSON.stringify({ empty: true }));
        router.push("/report");
        return;
      }

      setLoadingMsg(t("loadingAnalyze"));

      const analyzeResp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          answers: answers.filter((a) => a.trim().length > 0),
          patents,
        }),
      });

      if (!analyzeResp.ok) {
        const err = await analyzeResp.json().catch(() => ({}));
        throw new Error(err.error || `Analyze failed (${analyzeResp.status})`);
      }

      const report = await analyzeResp.json();
      report.searchTotal = searchData.total ?? patents.length;

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
