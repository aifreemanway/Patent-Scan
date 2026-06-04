import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";
import { routing } from "@/i18n/routing";
import { Footer } from "@/components/Footer";
import { YandexMetrika } from "@/components/YandexMetrika";
import "../globals.css";

// Gilroy — основной (display + body) шрифт лендинга v7. Self-host через
// next/font/local (no layout shift, без запросов к стороннему CDN). 5 весов
// — те, что реально используются в макете (400/500/600/700/800), без италиков
// (макет полагается на синтез браузером для 3 мелких декоративных мест).
const gilroy = localFont({
  variable: "--font-display",
  display: "swap",
  src: [
    { path: "../../../public/fonts/Gilroy-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../../public/fonts/Gilroy-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../../public/fonts/Gilroy-Semibold.ttf", weight: "600", style: "normal" },
    { path: "../../../public/fonts/Gilroy-Bold.ttf", weight: "700", style: "normal" },
    { path: "../../../public/fonts/Gilroy-Extrabold.ttf", weight: "800", style: "normal" },
  ],
});

// Моно — для бейджей/кода/мелких лейблов (макет: var(--font-mono)).
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru"),
    alternates: {
      canonical: `/${locale}`,
      languages: { ru: "/ru", en: "/en" },
    },
    openGraph: {
      title,
      description,
      siteName: "Patent-Scan",
      locale: locale === "ru" ? "ru_RU" : "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${gilroy.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-slate-900">
        <YandexMetrika />
        <NextIntlClientProvider>
          {children}
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
