"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Props = {
  operation: "search" | "landscape";
  tier: string;
  limit: number;
  used: number;
  onBack?: () => void;
};

export function QuotaExceededBlock({
  operation,
  tier,
  limit,
  used,
  onBack,
}: Props) {
  const t = useTranslations("Quota");

  const body =
    operation === "landscape"
      ? t("bodyLandscape", { used, limit, tier })
      : t("bodySearch", { used, limit, tier });

  return (
    <section className="mx-auto w-full max-w-xl">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("title")}
        </h2>
        <p className="mt-3 text-slate-600">{body}</p>

        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-sm">
          <div className="bg-white px-4 py-3">
            <dt className="text-slate-500">{t("usageLabel")}</dt>
            <dd className="mt-1 font-semibold text-slate-900">
              {used} / {limit}
            </dd>
          </div>
          <div className="bg-white px-4 py-3">
            <dt className="text-slate-500">{t("tierLabel")}</dt>
            <dd className="mt-1 font-semibold text-slate-900">{tier}</dd>
          </div>
        </dl>

        <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
          {t("resetNote")}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              {t("newSearch")}
            </button>
          ) : null}
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {t("backToStart")}
          </Link>
        </div>
      </div>
    </section>
  );
}
