// /enterprise — landing + форма заявки на демо-обзор для НИИ и проектных
// институтов. Per ap-marketing B5-outreach-templates: «формат тарифа Команда
// 14 900 ₽ за наш счёт, 24ч после получения брифа, 30-мин созвон по выводам».
//
// Форма не привязана к auth (юзер ещё не зарегистрирован) и не пишет в
// search_requests — это маркетинговый лид, который уходит письмом на support@.
// Сохранение в БД (enterprise_leads table) — когда появится sales pipeline.

import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { EnterpriseForm } from "./EnterpriseForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Enterprise" });
  return {
    title: `${t("meta.title")} — Patent-Scan`,
    description: t("meta.description"),
  };
}

export default async function EnterprisePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Enterprise");
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

  const valueItems = t.raw("value.items") as Array<{ title: string; body: string }>;
  const howItems = t.raw("how.items") as Array<{ title: string; body: string }>;

  return (
    <>
      <Header />
      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="bg-gradient-to-b from-slate-50 to-white">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-6 py-16 text-center sm:py-24">
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              {t("hero.badge")}
            </span>
            <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              {t("hero.title")}
            </h1>
            <p className="max-w-2xl text-lg text-slate-600">
              {t("hero.subtitle")}
            </p>
          </div>
        </section>

        {/* Value */}
        <section className="border-t border-slate-100 bg-white">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {t("value.title")}
            </h2>
            <ul className="mt-10 grid gap-6 sm:grid-cols-2">
              {valueItems.map((item) => (
                <li
                  key={item.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <h3 className="text-lg font-semibold text-slate-900">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How */}
        <section className="border-t border-slate-100 bg-slate-50">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {t("how.title")}
            </h2>
            <ol className="mt-10 grid gap-6 sm:grid-cols-3">
              {howItems.map((item, idx) => (
                <li
                  key={item.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="text-sm font-semibold text-slate-400">
                    {String(idx + 1).padStart(2, "0")}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {item.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Form */}
        <section id="form" className="border-t border-slate-100 bg-white">
          <div className="mx-auto max-w-2xl px-6 py-16">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {t("form.title")}
            </h2>
            <p className="mt-2 text-sm text-slate-600">{t("form.subtitle")}</p>
            <div className="mt-8">
              <EnterpriseForm locale={locale} siteKey={siteKey} />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
