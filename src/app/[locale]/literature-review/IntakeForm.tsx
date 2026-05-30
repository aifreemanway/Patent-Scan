"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

type Industry =
  | "metallurgy"
  | "chemistry"
  | "mechanical"
  | "energy"
  | "biotech"
  | "electronics"
  | "agriculture"
  | "other";

type Region =
  | "RU"
  | "CIS"
  | "CN"
  | "US"
  | "EU"
  | "UK"
  | "JP_KR"
  | "AU_NZ"
  | "LATAM"
  | "ME"
  | "AF"
  | "WORLD";

const INDUSTRIES: Industry[] = [
  "metallurgy",
  "chemistry",
  "mechanical",
  "energy",
  "biotech",
  "electronics",
  "agriculture",
  "other",
];

const REGIONS: Region[] = [
  "RU",
  "CIS",
  "CN",
  "US",
  "EU",
  "UK",
  "JP_KR",
  "AU_NZ",
  "LATAM",
  "ME",
  "AF",
  "WORLD",
];

const TOPIC_MIN = 50;
const TOPIC_MAX = 500;
const HYPOTHESES_MAX = 1000;
const CURRENT_YEAR = new Date().getUTCFullYear();

type Status = "idle" | "submitting" | "error";

export function IntakeForm({ locale }: { locale: string }) {
  const t = useTranslations("LiteratureReview.intake");
  const tInd = useTranslations("LiteratureReview.industries");
  const tReg = useTranslations("LiteratureReview.regions");
  const router = useRouter();

  const [topic, setTopic] = useState("");
  const [industry, setIndustry] = useState<Industry | "">("");
  const [regions, setRegions] = useState<Set<Region>>(new Set());
  const [periodFrom, setPeriodFrom] = useState(2010);
  const [periodTo, setPeriodTo] = useState(CURRENT_YEAR);
  const [hypotheses, setHypotheses] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const topicCounter = `${topic.length} / ${TOPIC_MAX}`;
  const hypCounter = `${hypotheses.length} / ${HYPOTHESES_MAX}`;
  const topicColor =
    topic.length < TOPIC_MIN
      ? "text-slate-400"
      : topic.length > TOPIC_MAX
      ? "text-rose-600"
      : "text-blue-600";

  const valid = useMemo(() => {
    if (topic.length < TOPIC_MIN || topic.length > TOPIC_MAX) return false;
    if (!industry) return false;
    if (regions.size === 0) return false;
    if (!Number.isInteger(periodFrom) || !Number.isInteger(periodTo)) return false;
    if (periodFrom > periodTo) return false;
    if (periodTo > CURRENT_YEAR) return false;
    if (hypotheses.length > HYPOTHESES_MAX) return false;
    return true;
  }, [topic, industry, regions, periodFrom, periodTo, hypotheses]);

  function toggleRegion(r: Region) {
    setRegions((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || status === "submitting") return;

    setStatus("submitting");
    setErrorCode(null);

    try {
      const resp = await fetch("/api/literature-review/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          industry,
          regions: Array.from(regions),
          periodFrom,
          periodTo,
          hypotheses: hypotheses.trim() || undefined,
        }),
      });

      if (resp.ok) {
        const data = (await resp.json()) as { id: string };
        router.push(`/literature-review/processing?id=${data.id}`);
        return;
      }

      const data = (await resp.json().catch(() => null)) as { error?: string } | null;
      setErrorCode(data?.error ?? "generic");
      setStatus("error");
    } catch {
      setErrorCode("network");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* Topic */}
      <div>
        <label htmlFor="topic" className="block text-sm font-semibold text-slate-900">
          {t("topicLabel")}
        </label>
        <textarea
          id="topic"
          rows={4}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={t("topicPlaceholder")}
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        />
        <div className="mt-1 flex justify-between text-xs">
          <p className="text-slate-500">{t("topicHelper")}</p>
          <p className={topicColor}>{topicCounter}</p>
        </div>
      </div>

      {/* Industry */}
      <div>
        <label htmlFor="industry" className="block text-sm font-semibold text-slate-900">
          {t("industryLabel")}
        </label>
        <select
          id="industry"
          value={industry}
          onChange={(e) => setIndustry(e.target.value as Industry)}
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        >
          <option value="">{t("industryPlaceholder")}</option>
          {INDUSTRIES.map((i) => (
            <option key={i} value={i}>
              {tInd(i)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">{t("industryHelper")}</p>
      </div>

      {/* Regions */}
      <div>
        <label className="block text-sm font-semibold text-slate-900">
          {t("regionsLabel")}
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {REGIONS.map((r) => {
            const active = regions.has(r);
            return (
              <button
                type="button"
                key={r}
                onClick={() => toggleRegion(r)}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                {tReg(r)}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">{t("regionsHelper")}</p>
      </div>

      {/* Period */}
      <div>
        <label className="block text-sm font-semibold text-slate-900">
          {t("periodLabel")}
        </label>
        <div className="mt-1 flex gap-3">
          <input
            type="number"
            value={periodFrom}
            min={1990}
            max={CURRENT_YEAR}
            onChange={(e) => setPeriodFrom(parseInt(e.target.value || "0", 10))}
            className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
          <span className="self-center text-slate-500">–</span>
          <input
            type="number"
            value={periodTo}
            min={1990}
            max={CURRENT_YEAR}
            onChange={(e) => setPeriodTo(parseInt(e.target.value || "0", 10))}
            className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">{t("periodHelper")}</p>
      </div>

      {/* Hypotheses */}
      <div>
        <label htmlFor="hypotheses" className="block text-sm font-semibold text-slate-900">
          {t("hypothesesLabel")}
        </label>
        <textarea
          id="hypotheses"
          rows={3}
          value={hypotheses}
          onChange={(e) => setHypotheses(e.target.value)}
          placeholder={t("hypothesesPlaceholder")}
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        />
        <div className="mt-1 flex justify-between text-xs">
          <p className="text-slate-500">{t("hypothesesHelper")}</p>
          <p className="text-slate-400">{hypCounter}</p>
        </div>
      </div>

      {errorCode && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {t(`errors.${errorCode}` as Parameters<typeof t>[0])}
        </div>
      )}

      <button
        type="submit"
        disabled={!valid || status === "submitting"}
        className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {status === "submitting" ? t("submitting") : t("submit")}
      </button>
      <p className="text-center text-xs text-slate-500">
        {t.rich("submitDisclaimer", {
          terms: (chunks) => (
            <a href="/terms" className="underline">
              {chunks}
            </a>
          ),
          privacy: (chunks) => (
            <a href="/privacy" className="underline">
              {chunks}
            </a>
          ),
        })}
      </p>
    </form>
  );
}
