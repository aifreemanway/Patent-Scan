// /account/billing — mirror of the public /pricing inside ЛК (ТЗ §2: заменяет
// заглушку «Подписка и платежи»). Reuses <PricingView /> so prices/copy stay in
// one place; the user's active tier is highlighted.
//
// CTAs are заявка-based (BILLING_LIVE=false) — self-service ЮKassa ships later.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/supabase-server";
import { PricingView } from "@/components/PricingView";
import type { SubscriptionTier } from "@/lib/pricing";

// DB tiers (free|starter|team|enterprise) → CANON pricing-card ids. team_plus
// has no DB tier yet, so it is never "current" until the billing migration adds it.
const DB_TO_CARD: Record<string, SubscriptionTier["id"]> = {
  free: "free",
  starter: "starter",
  team: "team",
  enterprise: "enterprise",
};

export default async function BillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Account");

  const { user, supabase } = await requireUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tier")
    .eq("id", user.id)
    .single();

  const currentTier = DB_TO_CARD[(profile?.tier as string) ?? "free"] ?? "free";

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("billing.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("billing.subtitle")}</p>
      </header>

      <PricingView locale={locale} currentTier={currentTier} />
    </div>
  );
}
