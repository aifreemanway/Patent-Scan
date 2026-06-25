// /account/billing — subscription & payments inside ЛК.
//
// PR-C: the tier cards are now INTERACTIVE (paid CTAs open the checkout modal —
// «по счёту» primary, «картой» gated by the env BILLING_LIVE flag). Above the
// cards: the self-service manager (cancel/resume) for an active subscription and
// a payment history table. A ?plan=…&period=… deep-link (from the public /pricing
// → login → here) auto-opens the matching tier's modal.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/supabase-server";
import { PricingView } from "@/components/PricingView";
import { SubscriptionManager } from "@/components/SubscriptionManager";
import { BILLING_LIVE } from "@/lib/config";
import { formatRub, type SubscriptionTier } from "@/lib/pricing";

// DB tiers → CANON pricing-card ids (team_plus is live in the tier check since 0010).
const DB_TO_CARD: Record<string, SubscriptionTier["id"]> = {
  free: "free",
  starter: "starter",
  team: "team",
  team_plus: "team_plus",
  enterprise: "enterprise",
};

// ?plan param (PricingV7 uses "teamplus") → pricing-card id.
const PLAN_PARAM_TO_TIER: Record<string, SubscriptionTier["id"]> = {
  starter: "starter",
  team: "team",
  teamplus: "team_plus",
  team_plus: "team_plus",
};

const PURPOSE_LABEL: Record<string, string> = {
  subscription_starter: "Подписка Starter",
  subscription_team: "Подписка Team",
  subscription_team_plus: "Подписка Team Plus",
};

const PAY_STATUS_LABEL: Record<string, string> = {
  pending: "Ожидает оплаты",
  waiting_for_capture: "Ожидает подтверждения",
  succeeded: "Оплачено",
  canceled: "Отменён",
};

type PaymentRow = {
  id: string;
  amount: number;
  currency: string;
  purpose: string;
  status: string;
  created_at: string;
};

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Account");

  const { user, supabase } = await requireUser();
  const [{ data: profile }, { data: subscription }, { data: payments }] =
    await Promise.all([
      supabase.from("profiles").select("tier").eq("id", user.id).single(),
      supabase
        .from("subscriptions")
        .select("tier, status, current_period_end, cancel_at_period_end")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("payments")
        .select("id, amount, currency, purpose, status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const currentTier = DB_TO_CARD[(profile?.tier as string) ?? "free"] ?? "free";
  const planParam = typeof sp.plan === "string" ? sp.plan : undefined;
  const autoOpenTier = planParam ? PLAN_PARAM_TO_TIER[planParam] : undefined;
  const autoOpenPeriod = sp.period === "year" ? "year" : "month";
  const showReturnNotice = sp.status === "return";

  const paymentRows = (payments ?? []) as PaymentRow[];
  const hasActiveSub =
    subscription &&
    subscription.tier !== "free" &&
    ["active", "past_due"].includes(subscription.status as string);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("billing.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("billing.subtitle")}</p>
      </header>

      {showReturnNotice && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {t("billing.returnNotice")}
        </div>
      )}

      {hasActiveSub && (
        <SubscriptionManager
          initial={{
            tier: subscription!.tier as string,
            status: subscription!.status as string,
            current_period_end: subscription!.current_period_end as string | null,
            cancel_at_period_end: Boolean(subscription!.cancel_at_period_end),
          }}
        />
      )}

      {paymentRows.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">
            {t("billing.historyTitle")}
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">{t("billing.colDate")}</th>
                  <th className="px-2 py-2">{t("billing.colItem")}</th>
                  <th className="px-2 py-2">{t("billing.colAmount")}</th>
                  <th className="px-2 py-2">{t("billing.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {paymentRows.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-2 text-slate-500">
                      {new Intl.DateTimeFormat("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      }).format(new Date(p.created_at))}
                    </td>
                    <td className="px-2 py-2 text-slate-800">
                      {PURPOSE_LABEL[p.purpose] ?? p.purpose}
                    </td>
                    <td className="px-2 py-2 text-slate-800">
                      {formatRub(Number(p.amount), locale)}
                    </td>
                    <td className="px-2 py-2 text-slate-600">
                      {PAY_STATUS_LABEL[p.status] ?? p.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <PricingView
        locale={locale}
        currentTier={currentTier}
        interactive
        billingLive={BILLING_LIVE}
        autoOpenTier={autoOpenTier}
        autoOpenPeriod={autoOpenPeriod}
      />
    </div>
  );
}
