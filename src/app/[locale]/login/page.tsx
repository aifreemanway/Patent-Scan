import { setRequestLocale } from "next-intl/server";
import { Header } from "@/components/Header";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

  return (
    <>
      <Header />
      <main className="flex flex-1 items-start justify-center px-6 py-16 sm:py-24">
        <LoginForm locale={locale} siteKey={siteKey} />
      </main>
    </>
  );
}
