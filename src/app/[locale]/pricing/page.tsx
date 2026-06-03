// Public /pricing — tariffs + one-off reports (CANON + ТЗ). Accessible without
// login (shareable for the WTP/ОС round, SEO, landing CTA). The actual cards,
// prices, copy and CTA logic live in <PricingView /> so the ЛК mirror reuses it.
//
// Pre-launch: CTAs route to the заявка flow, NOT a checkout (BILLING_LIVE=false).
// Premium-track + addons gated by flags in lib/pricing (hidden now).

import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PricingView } from "@/components/PricingView";

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
    <>
      <Header />
      <main className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-6xl px-6 py-16">
          <PricingView locale={locale} />
        </div>
      </main>
      <Footer />
    </>
  );
}
