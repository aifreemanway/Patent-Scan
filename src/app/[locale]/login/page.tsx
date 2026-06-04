import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { SiteNav } from "@/components/SiteNav";
import { LoginForm } from "./LoginForm";
import "../landing.css";

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
