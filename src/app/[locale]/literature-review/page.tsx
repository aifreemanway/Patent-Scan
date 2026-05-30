// /literature-review — intake page. Server component for locale + header,
// embeds the client IntakeForm. Auth-gating is done by the API on submit
// (returns 401) rather than blocking the page — letting unauth visitors at
// least see what they'd be buying lowers friction for the cold-outreach link.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { Header } from "@/components/Header";
import { IntakeForm } from "./IntakeForm";

export default async function LiteratureReviewIntakePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("LiteratureReview.intake");

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
          <IntakeForm locale={locale} />
        </div>
      </main>
    </>
  );
}
