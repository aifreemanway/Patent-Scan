// Public /pricing — v9 design (PRESERVE из макета v9 v7-pricing.html).
//
// Обёртка: .lp + <SiteNav /> внутри. Footer — рендерит layout (общий), здесь
// НЕ дублируем. Цены / тарифы / CTA — всё в <PricingV7> (клиентский компонент),
// источник правды цен — lib/pricing (константы + formatRub + oneOffPrice).
// PricingView.tsx НЕ тронут — он живёт для ЛК-зеркала (/account/billing).
//
// SEO-head v9 (§8, ap-mediabuyer seo-head-v9-brief §2): generateMetadata +
// Product/Offer JSON-LD (4 тарифа, цены из lib/pricing) + FAQPage JSON-LD
// (из faqV7, parity со страницей). Organization/WebSite/Service — в layout.tsx
// (НЕ дублируем). 94,9 млн = verified. UTM на мета НЕ ставим.

import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { PricingV7 } from "@/components/PricingV7";
import {
  PRICE_FREE,
  PRICE_STARTER,
  PRICE_TEAM,
  PRICE_TEAM_PLUS,
} from "@/lib/pricing";
import "../landing.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  await params;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru";
  return {
    title: "Тарифы ПатентСкан — патентный поиск, анализ, ландшафт",
    description:
      "Бесплатное знакомство, подписки Starter / Team / TeamPlus и разовые отчёты: глубокий анализ, патентный ландшафт, скрининг. Цены и квоты — прозрачно.",
    alternates: { canonical: `${site}/pricing` },
    openGraph: {
      type: "website",
      title: "Тарифы ПатентСкан",
      description:
        "От бесплатной проверки идеи до подписок для команд и институтов. Разовые отчёты без подписки.",
      url: `${site}/pricing`,
      locale: "ru_RU",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Pricing" });

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru";

  // Product + Offer JSON-LD — цены ТОЛЬКО из lib/pricing (anti-fab: ни одного
  // хардкоженого числа). 4 тарифа, как в SEO-брифе §2. price → строка (schema.org).
  const offer = (name: string, price: number) => ({
    "@type": "Offer",
    name,
    price: String(price),
    priceCurrency: "RUB",
    availability: "https://schema.org/InStock",
    url: `${site}/pricing`,
  });
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "ПатентСкан — подписки",
    description:
      "Сервис патентного поиска по 94,9 млн патентам в 6 юрисдикциях. Тарифы Free / Starter / Team / TeamPlus.",
    brand: { "@id": `${site}/#org` },
    url: `${site}/pricing`,
    offers: [
      offer("Free", PRICE_FREE),
      offer("Starter", PRICE_STARTER),
      offer("Team", PRICE_TEAM),
      offer("TeamPlus", PRICE_TEAM_PLUS),
    ],
  };

  // FAQPage JSON-LD — из ТЕХ ЖЕ faqV7-айтемов, что рендерит PricingV7 (parity:
  // Google/Yandex требуют schema↔page). HTML из ответов вычищаем для plain-text.
  const stripHtml = (s: string) =>
    s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const faqItems = t.raw("faqV7.items") as Array<{ q: string; a: string }>;
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${site}/pricing#faq`,
    mainEntity: faqItems.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: stripHtml(f.a) },
    })),
  };

  return (
    <div className="lp">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <SiteNav />
      {/* PricingV7 — клиентский компонент (toggle-стейт). Цены из lib/pricing. */}
      <PricingV7 />
    </div>
  );
}
