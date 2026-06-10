// /blog section layout — public (NO login-guard, unlike /account or /search).
// Adds SiteNav + the .lp wrapper so the v7 nav styles apply. Footer is NOT added
// here — the [locale] root layout already renders <Footer/> on every page (adding
// it here would double it).

import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { SiteNav } from "@/components/SiteNav";
import "../landing.css";

export default async function BlogLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="lp">
      <SiteNav />
      {children}
    </div>
  );
}
