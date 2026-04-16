import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

type Step = { n: string; title: string; body: string };
type Item = { title: string; body: string };
type Source = { name: string; meta: string };

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Landing");
  const tc = await getTranslations("Common");

  const steps = t.raw("how.steps") as Step[];
  const items = t.raw("get.items") as Item[];
  const sources = t.raw("sources.items") as Source[];

  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 py-24 text-center sm:py-32">
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            {t("hero.badge")}
          </span>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
            {t("hero.title")}
          </h1>
          <p className="max-w-2xl text-lg text-slate-600">
            {t("hero.subtitle")}
          </p>
          <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/search"
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
            >
              {tc("cta")}
            </Link>
            <Link
              href="/landscape"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
            >
              {tc("ctaLandscape")}
            </Link>
          </div>
          <p className="max-w-xl text-xs text-slate-500">
            {t("hero.disclaimer")}
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-slate-100 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("how.title")}
          </h2>
          <ol className="mt-12 grid gap-6 sm:grid-cols-3">
            {steps.map((s) => (
              <li
                key={s.n}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="text-sm font-semibold text-slate-400">
                  {s.n}
                </div>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* What you get */}
      <section className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("get.title")}
          </h2>
          <ul className="mt-12 grid gap-6 sm:grid-cols-2">
            {items.map((it) => (
              <li
                key={it.title}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-slate-900">
                  {it.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {it.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Sources */}
      <section className="border-t border-slate-100 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("sources.title")}
          </h2>
          <p className="mt-3 text-center text-sm text-slate-600">
            {t("sources.subtitle")}
          </p>
          <ul className="mt-10 grid gap-4 sm:grid-cols-3">
            {sources.map((s) => (
              <li
                key={s.name}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="font-semibold text-slate-900">{s.name}</div>
                <div className="mt-1 text-xs text-slate-500">{s.meta}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-100 bg-slate-900">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-6 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t("ctaBlock.title")}
          </h2>
          <p className="max-w-2xl text-slate-300">{t("ctaBlock.subtitle")}</p>
          <Link
            href="/search"
            className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-base font-semibold text-slate-900 shadow-sm transition hover:bg-slate-100"
          >
            {tc("ctaSecondary")}
          </Link>
        </div>
      </section>
    </main>
  );
}
