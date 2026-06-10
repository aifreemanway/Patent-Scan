import { Suspense } from "react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { SiteNav } from "@/components/SiteNav";
import { LoginForm } from "./LoginForm";
import "../landing.css";

// SEO-head v9 (§8, ap-mediabuyer seo-head-v9-brief §4). /login НЕ индексируем
// (noindex) для ОБЕИХ локалей — переопределяем layout (index: locale!=="en").
// follow: true — сохраняем link equity. JSON-LD не нужен. UTM на мета НЕ ставим.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  await params;
  return {
    title: "Вход — ПатентСкан",
    description: "Вход в личный кабинет ПатентСкан по ссылке на email.",
    openGraph: {
      title: "Вход — ПатентСкан",
      description: "Вход в личный кабинет ПатентСкан по ссылке на email.",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
    robots: { index: false, follow: true },
  };
}

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

  return (
    <div className="lp">
      <SiteNav />
      <main className="auth-main">
        <Suspense fallback={null}>
          <LoginForm locale={locale} siteKey={siteKey} />
        </Suspense>
      </main>
    </div>
  );
}
