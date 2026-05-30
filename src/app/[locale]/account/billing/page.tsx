// /account/billing — Phase 1 stub.
// Real ЮKassa integration ships in Phase 2 (T-CD-4). For now the page only
// tells the user how to upgrade manually until the self-service path is live.

import { setRequestLocale, getTranslations } from "next-intl/server";

export default async function BillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Account");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("billing.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("billing.subtitle")}</p>
      </header>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-700">{t("billing.stubBody1")}</p>
        <p className="text-sm text-slate-700">{t("billing.stubBody2")}</p>
        <div className="flex flex-wrap gap-3 pt-2">
          <a
            href="mailto:support@patent-scan.com?subject=ПатентСкан%20—%20запрос%20на%20подключение%20платного%20плана"
            className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            {t("billing.contactSupport")}
          </a>
        </div>
      </section>
    </div>
  );
}
