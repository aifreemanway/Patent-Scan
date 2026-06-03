// Shared pricing view rendered by BOTH the public /pricing page and the ЛК
// mirror (/account/billing). Server component — reads config from lib/pricing
// and copy from the Pricing.* i18n namespace. No markup-level prices/quotas.
//
// Pre-launch (BILLING_LIVE=false): every paid CTA opens the заявка flow
// (/enterprise#form) — NEVER a broken checkout. Free → /search. Enterprise →
// /enterprise. A "предварительные тарифы" banner is always present.
//
// Premium-track + addons are gated by flags in lib/pricing and are NOT rendered
// while off (anti-fab — no product, no price shown).

import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  SUBSCRIPTION_TIERS,
  ONE_OFF_PRODUCTS,
  VISIBLE_ADDONS,
  CREDIT_PACKS,
  BILLING_LIVE,
  formatRub,
  oneOffPrice,
  type CtaKind,
  type SubscriptionTier,
  type OneOffProduct,
} from "@/lib/pricing";

/** Where a CTA points in PRE-LAUNCH (billing not live). Paid plans/reports route
 *  to the existing заявка flow; nothing leads to a checkout that does not exist. */
const REQUEST_HREF = "/enterprise#form";
const FREE_HREF = "/search";
const CONTACT_HREF = "/enterprise#form";

function ctaHref(kind: CtaKind): string {
  // BILLING_LIVE branch reserved for when ЮKassa checkout ships; until then all
  // paid CTAs are заявка-based by design.
  if (BILLING_LIVE) return kind === "free" ? FREE_HREF : "/account/billing";
  switch (kind) {
    case "free":
      return FREE_HREF;
    case "contact":
      return CONTACT_HREF;
    case "request":
    default:
      return REQUEST_HREF;
  }
}

export async function PricingView({
  locale,
  currentTier,
}: {
  locale: string;
  /** When rendered inside ЛК, the user's active tier — highlighted. */
  currentTier?: SubscriptionTier["id"];
}) {
  const t = await getTranslations("Pricing");

  return (
    <div className="space-y-16">
      {/* Preliminary-pricing banner — REQUIRED (ТЗ §5) */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {t("preliminaryBanner")}
      </div>

      {/* Hero / positioning (honest pivot B — no "замена института/поверенного") */}
      <header className="space-y-3 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {t("hero.title")}
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-slate-600">
          {t("hero.subtitle")}
        </p>
      </header>

      {/* ── Subscription ──────────────────────────────────────────────── */}
      <section>
        <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
          {t("subscription.title")}
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-slate-600">
          {t("subscription.subtitle")}
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {SUBSCRIPTION_TIERS.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              locale={locale}
              current={currentTier === tier.id}
              t={t}
            />
          ))}
        </div>
      </section>

      {/* ── Search-is-free explainer (ТЗ §3.5) ─────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-6 text-center">
        <p className="mx-auto max-w-3xl text-sm text-slate-700">
          {t("searchFree")}
        </p>
      </section>

      {/* ── One-off reports ────────────────────────────────────────────── */}
      <section>
        <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
          {t("oneOff.title")}
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-slate-600">
          {t("oneOff.subtitle")}
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {ONE_OFF_PRODUCTS.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} t={t} />
          ))}
        </div>

        {/* Institutional credit packs (contact line) */}
        <p className="mt-8 text-center text-sm text-slate-600">
          {t("oneOff.packs", {
            screening10: formatRub(CREDIT_PACKS.screening10, locale),
            deep20: formatRub(CREDIT_PACKS.deep20, locale),
          })}{" "}
          <Link
            href={CONTACT_HREF}
            className="font-medium text-blue-600 hover:text-blue-700"
          >
            {t("oneOff.packsCta")} →
          </Link>
        </p>
      </section>

      {/* ── Reserved addons (rendered ONLY when ADDONS_ENABLED + per-addon on;
            empty array now → nothing renders. Anti-fab.) ─────────────── */}
      {VISIBLE_ADDONS.length > 0 && (
        <section>
          <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
            {t("addons.title")}
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {VISIBLE_ADDONS.map((a) => (
              <div
                key={a.id}
                className="rounded-2xl border border-slate-200 bg-white p-6"
              >
                <h3 className="text-lg font-semibold text-slate-900">
                  {t(`addons.${a.id}.title`)}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  {t(`addons.${a.id}.body`)}
                </p>
                {a.price !== null && (
                  <p className="mt-3 text-base font-semibold text-slate-900">
                    {formatRub(a.price, locale)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── FAQ ────────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
          {t("faq.title")}
        </h2>
        <dl className="mx-auto mt-8 max-w-3xl space-y-6">
          {(t.raw("faq.items") as Array<{ q: string; a: string }>).map((it, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-6">
              <dt className="font-semibold text-slate-900">{it.q}</dt>
              <dd className="mt-2 text-sm leading-6 text-slate-600">{it.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── Feedback hook for the WTP/ОС round (ТЗ §3.8) ───────────────────
          Telegram button intentionally OMITTED: handle not confirmed (ТЗ:
          без подтверждённой ссылки кнопку не публиковать). Feedback routes to
          the verified support email instead. */}
      <section className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900">
          {t("feedback.title")}
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-600">
          {t("feedback.body")}
        </p>
        <a
          href="mailto:support@patent-scan.com?subject=ПатентСкан%20—%20мнение%20о%20тарифах"
          className="mt-5 inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          {t("feedback.cta")}
        </a>
      </section>
    </div>
  );
}

function ctaLabel(
  cta: CtaKind,
  t: Awaited<ReturnType<typeof getTranslations<"Pricing">>>,
): string {
  switch (cta) {
    case "free":
      return t("cta.free");
    case "contact":
      return t("cta.contact");
    case "request":
    default:
      return t("cta.request");
  }
}

function TierCard({
  tier,
  locale,
  current,
  t,
}: {
  tier: SubscriptionTier;
  locale: string;
  current: boolean;
  t: Awaited<ReturnType<typeof getTranslations<"Pricing">>>;
}) {
  const priceLabel =
    tier.priceMonthly === null
      ? t("custom")
      : tier.priceMonthly === 0
        ? t("priceFree")
        : `${formatRub(tier.priceMonthly, locale)}${t("perMonth")}`;

  return (
    <div
      className={`flex flex-col rounded-2xl border bg-white p-6 ${
        tier.featured
          ? "border-blue-500 shadow-md ring-1 ring-blue-500"
          : "border-slate-200"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-slate-900">
          {t(`tiers.${tier.id}.name`)}
        </h3>
        {tier.featured && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
            {t("popular")}
          </span>
        )}
        {current && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            {t("currentPlan")}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-600">{t(`tiers.${tier.id}.desc`)}</p>
      <p className="mt-4 text-2xl font-bold text-slate-900">{priceLabel}</p>

      <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
        {tier.quotaKeys.map((k) => (
          <li key={k} className="flex gap-2">
            <span className="text-blue-600">•</span>
            <span>{t(k)}</span>
          </li>
        ))}
        {tier.featureKeys.map((k) => (
          <li key={k} className="flex gap-2 text-slate-500">
            <span className="text-slate-400">+</span>
            <span>{t(k)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 pt-2">
        {current ? (
          <span className="inline-flex w-full justify-center rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800">
            {t("yourPlan")}
          </span>
        ) : (
          <Link
            href={ctaHref(tier.cta)}
            className={`inline-flex w-full justify-center rounded-md px-4 py-2 text-sm font-semibold transition ${
              tier.featured
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            {ctaLabel(tier.cta, t)}
          </Link>
        )}
      </div>
    </div>
  );
}

function ProductCard({
  product,
  locale,
  t,
}: {
  product: OneOffProduct;
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations<"Pricing">>>;
}) {
  return (
    <div
      className={`flex flex-col rounded-2xl border bg-white p-6 ${
        product.featured
          ? "border-blue-500 shadow-md ring-1 ring-blue-500"
          : "border-slate-200"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-slate-900">
          {t(`products.${product.id}.name`)}
        </h3>
        {product.featured && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
            {t("flagship")}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {t(`products.${product.id}.desc`)}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        {t(`products.${product.id}.time`)}
      </p>
      <p className="mt-4 text-2xl font-bold text-slate-900">
        {formatRub(oneOffPrice(product), locale)}
      </p>
      <div className="mt-6 pt-2">
        <Link
          href={ctaHref(product.cta)}
          className={`inline-flex w-full justify-center rounded-md px-4 py-2 text-sm font-semibold transition ${
            product.featured
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-slate-900 text-white hover:bg-slate-800"
          }`}
        >
          {ctaLabel(product.cta, t)}
        </Link>
      </div>
    </div>
  );
}
