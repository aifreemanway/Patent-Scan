// /literature-review — intake page. Server component for locale + header,
// embeds the client IntakeForm. Page itself is unauth-friendly (cold-outreach
// CTAs deep-link here), but we DO fetch tier server-side when the visitor is
// authed — that lets IntakeForm render a tier-locked upsell card instead of
// letting a free/starter user fill the form just to hit 402 on submit
// (per ap-cofounder UX-fix handoff 2026-05-30).

import { setRequestLocale, getTranslations } from "next-intl/server";
import { Header } from "@/components/Header";
import { createSupabaseServer } from "@/lib/supabase-server";
import { IntakeForm } from "./IntakeForm";

export default async function LiteratureReviewIntakePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("LiteratureReview.intake");

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let tier: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("tier")
      .eq("id", user.id)
      .single();
    tier = typeof profile?.tier === "string" ? profile.tier : null;
  }

  return (
    <>
      <Header />
      <main className="flex-1 px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <header className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              {t("h1")}
            </h1>
            <p className="mt-3 text-slate-600">{t("lead")}</p>
            <p className="mt-2 text-sm text-slate-500">{t("explainer")}</p>
            <p className="mt-4 text-xs text-slate-500">{t("trust")}</p>
          </header>
          <IntakeForm locale={locale} tier={tier} />
        </div>
      </main>
    </>
  );
}
