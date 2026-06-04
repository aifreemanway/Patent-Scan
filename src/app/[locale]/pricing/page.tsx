// Public /pricing — v7 design (PRESERVE из макета v7-pricing.html).
//
// Обёртка: .lp + <SiteNav /> внутри. Footer — рендерит layout (общий), здесь
// НЕ дублируем (исправляет задвоение Footer'а). <Header /> тоже убран.
//
// Цены / тарифы / CTA — всё в <PricingV7> (клиентский компонент).
// PricingView.tsx НЕ тронут — он живёт для ЛК-зеркала (/account/billing).

import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { PricingV7 } from "@/components/PricingV7";
import "../landing.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Pricing" });
  return {
    title: `${t("meta.title")} — Patent-Scan`,
    description: t("meta.description"),
  };
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="lp">
      <SiteNav />
      {/* PricingV7 is a client component — renders the full v7 pricing UI with
          toggle state. It also wraps its content in .lp class sections so the
          nav styles from SiteNav apply correctly. */}
      <PricingV7 />
    </div>
  );
}
