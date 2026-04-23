"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  FEEDBACK_Q1_OPTIONS,
  FEEDBACK_Q2_OPTIONS,
  FEEDBACK_Q3_OPTIONS,
  FEEDBACK_FREE_TEXT_MAX,
  type FeedbackOperation,
} from "@/lib/feedback-schema";

type Mode = "intro" | "form" | "submitting" | "success" | "already_granted";

type Props = {
  operation: FeedbackOperation;
  limit: number;
  used: number;
  tier: string;
  onRetry?: () => void;
};

export function QuotaExceededBlock({
  operation,
  limit,
  used,
  tier,
  onRetry,
}: Props) {
  const t = useTranslations("Auth.quota");
  const tf = useTranslations("Auth.feedback");

  const [mode, setMode] = useState<Mode>("intro");
  const [q1, setQ1] = useState<string>("");
  const [q2, setQ2] = useState<string>("");
  const [q3, setQ3] = useState<string>("");
  const [q3Custom, setQ3Custom] = useState("");
  const [freeText, setFreeText] = useState("");
  const [errorCode, setErrorCode] = useState<
    "generic" | "already_granted" | "missing_q3_custom" | null
  >(null);

  const operationLabel = t(`operationLabel.${operation}`);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorCode(null);

    if (!q1 || !q2 || !q3) return; // button disabled anyway
    if (q3 === "custom" && !q3Custom.trim()) {
      setErrorCode("missing_q3_custom");
      return;
    }

    setMode("submitting");
    try {
      const resp = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation,
          q1,
          q2,
          q3,
          ...(q3 === "custom" ? { q3_custom: q3Custom.trim() } : {}),
          ...(freeText.trim() ? { free_text: freeText.trim() } : {}),
        }),
      });

      if (resp.ok) {
        setMode("success");
        return;
      }

      if (resp.status === 409) {
        setMode("already_granted");
        setErrorCode("already_granted");
        return;
      }

      const data = (await resp.json().catch(() => null)) as
        | { error?: string }
        | null;
      setErrorCode(
        data?.error === "already_granted" ? "already_granted" : "generic"
      );
      setMode("form");
    } catch {
      setErrorCode("generic");
      setMode("form");
    }
  }

  // ── Success state ──────────────────────────────────────────
  if (mode === "success") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
        <h3 className="text-xl font-bold tracking-tight text-emerald-900">
          {tf("successTitle")}
        </h3>
        <p className="mt-2 text-emerald-800">
          {tf("successBody", { operation: operationLabel })}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            {tf("tryAgain")}
          </button>
        )}
      </div>
    );
  }

  // ── Already granted (user hit quota again after bonus was used) ──
  if (mode === "already_granted") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 sm:p-8">
        <h3 className="text-xl font-bold tracking-tight text-amber-900">
          {t("alreadyGrantedBanner.title")}
        </h3>
        <p className="mt-2 text-amber-800">
          {t("alreadyGrantedBanner.body", { operation: operationLabel })}
        </p>
      </div>
    );
  }

  // ── Intro: quota info + CTA ────────────────────────────────
  if (mode === "intro") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h3 className="text-xl font-bold tracking-tight text-slate-900">
          {t("title")}
        </h3>
        <p className="mt-2 text-slate-600">
          {t("body", { used, limit, operation: operationLabel, tier })}
        </p>

        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">
            {t("proComingTitle")}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {t("proComingBody", { operation: operationLabel })}
          </p>
          <button
            type="button"
            onClick={() => setMode("form")}
            className="mt-3 inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            {t("startFeedback")}
          </button>
        </div>
      </div>
    );
  }

  // ── Feedback form (mode === "form" or "submitting") ────────
  const submitting = mode === "submitting";
  const canSubmit =
    q1 !== "" &&
    q2 !== "" &&
    q3 !== "" &&
    (q3 !== "custom" || q3Custom.trim().length > 0) &&
    !submitting;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h3 className="text-xl font-bold tracking-tight text-slate-900">
        {tf("title")}
      </h3>
      <p className="mt-1 text-sm text-slate-600">{tf("subtitle")}</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        {/* Q1 */}
        <fieldset>
          <legend className="text-sm font-medium text-slate-900">
            {tf("q1.label")}
          </legend>
          <div className="mt-2 space-y-2">
            {FEEDBACK_Q1_OPTIONS.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
              >
                <input
                  type="radio"
                  name="q1"
                  value={opt}
                  checked={q1 === opt}
                  onChange={() => setQ1(opt)}
                  className="h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                {tf(`q1.options.${opt}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Q2 */}
        <fieldset>
          <legend className="text-sm font-medium text-slate-900">
            {tf("q2.label")}
          </legend>
          <div className="mt-2 space-y-2">
            {FEEDBACK_Q2_OPTIONS.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
              >
                <input
                  type="radio"
                  name="q2"
                  value={opt}
                  checked={q2 === opt}
                  onChange={() => setQ2(opt)}
                  className="h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                {tf(`q2.options.${opt}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Q3 */}
        <fieldset>
          <legend className="text-sm font-medium text-slate-900">
            {tf("q3.label")}
          </legend>
          <div className="mt-2 space-y-2">
            {FEEDBACK_Q3_OPTIONS.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
              >
                <input
                  type="radio"
                  name="q3"
                  value={opt}
                  checked={q3 === opt}
                  onChange={() => setQ3(opt)}
                  className="h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                {tf(`q3.options.${opt}`)}
              </label>
            ))}
          </div>
          {q3 === "custom" && (
            <input
              type="text"
              value={q3Custom}
              onChange={(e) => setQ3Custom(e.target.value)}
              placeholder={tf("q3.customPlaceholder")}
              maxLength={100}
              className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          )}
        </fieldset>

        {/* Free text */}
        <div>
          <label
            htmlFor="free_text"
            className="block text-sm font-medium text-slate-900"
          >
            {tf("freeText.label")}
          </label>
          <textarea
            id="free_text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder={tf("freeText.placeholder")}
            maxLength={FEEDBACK_FREE_TEXT_MAX}
            rows={3}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
          <p className="mt-1 text-xs text-slate-500">
            {freeText.length} / {FEEDBACK_FREE_TEXT_MAX}
          </p>
        </div>

        {errorCode && (
          <p className="text-sm text-red-600">{tf(`errors.${errorCode}`)}</p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {submitting ? tf("submitting") : tf("submit")}
        </button>
      </form>
    </div>
  );
}
