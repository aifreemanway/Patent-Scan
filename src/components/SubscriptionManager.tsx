"use client";

// Self-service subscription management (PR-C §5, Vsevolod hard-req): shows the
// active plan and lets the user cancel (access kept until period end) or resume.
// Money-safe — it only toggles cancel_at_period_end via /api/billing/subscription.

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";

type Sub = {
  tier: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

const TIER_NAME: Record<string, string> = {
  starter: "Starter",
  team: "Team",
  team_plus: "Team Plus",
  enterprise: "Enterprise",
};

export function SubscriptionManager({ initial }: { initial: Sub }) {
  const t = useTranslations("Checkout.manage");
  const locale = useLocale();
  const [sub, setSub] = useState<Sub>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const periodEnd = sub.current_period_end
    ? new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }).format(new Date(sub.current_period_end))
    : null;

  async function act(action: "cancel" | "resume") {
    if (busy) return;
    if (action === "cancel" && !window.confirm(t("confirmCancel"))) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/billing/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = (await resp.json().catch(() => null)) as
        | { subscription?: Sub; error?: string }
        | null;
      if (resp.ok && d?.subscription) {
        setSub(d.subscription);
        return;
      }
      setError(d?.error ?? "generic");
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  const active = sub.status === "active";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {t("currentPlan", { tier: TIER_NAME[sub.tier] ?? sub.tier })}
            {periodEnd
              ? sub.cancel_at_period_end
                ? ` · ${t("endsOn", { date: periodEnd })}`
                : ` · ${t("renewsOn", { date: periodEnd })}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {active && !sub.cancel_at_period_end && (
            <button
              type="button"
              onClick={() => act("cancel")}
              disabled={busy}
              className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              {busy ? "…" : t("cancel")}
            </button>
          )}
          {active && sub.cancel_at_period_end && (
            <button
              type="button"
              onClick={() => act("resume")}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "…" : t("resume")}
            </button>
          )}
        </div>
      </div>
      {sub.cancel_at_period_end && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t("cancelNotice")}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-rose-600">{t(`err.${error}` as never)}</p>}
    </div>
  );
}
