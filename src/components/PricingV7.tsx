"use client";

// PricingV7 — публичная страница /pricing в дизайне v7.
//
// ⚠ PRICING/MONEY-CRITICAL:
//   • Цены ТОЛЬКО из lib/pricing (константы + formatRub + oneOffPrice).
//   • PricingView.tsx НЕ трогаем — он живёт для ЛК-зеркала.
//   • BILLING_LIVE=false → все платные CTA → заявка /enterprise#form.
//   • PREMIUM_TRACK_ENABLED=false → one-off цены через oneOffPrice() = today-track.
//   • ADDONS_ENABLED=false → VISIBLE_ADDONS=[] → раздел аддонов НЕ рендерится.
//   • Баннер «предварительные тарифы» ОБЯЗАТЕЛЕН (ТЗ §5).

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { TrackedLink } from "@/components/TrackedLink";
import { FaqItem } from "@/components/FaqItem";
import {
  SUBSCRIPTION_TIERS,
  ONE_OFF_PRODUCTS,
  VISIBLE_ADDONS,
  CREDIT_PACKS,
  BILLING_LIVE,
  PRICE_FREE,
  PRICE_STARTER,
  PRICE_TEAM,
  PRICE_TEAM_PLUS,
  formatRub,
  oneOffPrice,
  type CtaKind,
} from "@/lib/pricing";

// ─── CTA routing (mirrors PricingView.ctaHref) ─────────────────────────────
const REQUEST_HREF = "/enterprise#form";
const FREE_HREF = "/search";
const CONTACT_HREF = "/enterprise#form";

function ctaHref(kind: CtaKind): string {
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

// ─── Toggle period ──────────────────────────────────────────────────────────
type Period = "month" | "year";

// ─── Arrow SVG ──────────────────────────────────────────────────────────────
function Arrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Subscription bullet list ───────────────────────────────────────────────
function SubBullets({ items }: { items: string[] }) {
  return (
    <ul className="sub-bullets">
      {items.map((html, i) => (
        <li key={i} dangerouslySetInnerHTML={{ __html: html }} />
      ))}
    </ul>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────
export function PricingV7() {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const [period, setPeriod] = useState<Period>("month");

  // Paid tiers with their plan params (same as LandingPricing)
  const paidPlans = [
    { id: "starter" as const, planParam: "starter", monthly: PRICE_STARTER },
    { id: "team" as const, planParam: "team", monthly: PRICE_TEAM, featured: true },
    { id: "teamPlus" as const, planParam: "teamplus", monthly: PRICE_TEAM_PLUS },
  ];

  const faqItemsV7 = t.raw("faqV7.items") as Array<{ q: string; a: string }>;

  return (
    <>
      {/* NAV rendered by page.tsx (SiteNav) outside this component */}

      {/* ── Preliminary-pricing banner — REQUIRED (ТЗ §5) ────────────── */}
      <div className="container">
        <div className="pricing-prelim-banner" style={{ marginTop: 24 }}>
          {t("preliminaryBanner")}
        </div>
      </div>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <div className="pricing-hero">
        <div className="container">
          <span className="eyebrow-pill">{t("heroV7.eyebrow")}</span>
          <h1>
            {t("heroV7.title")}{" "}
            <span className="em">{t("heroV7.titleEm")}</span>
            {" или "}
            <span className="em">{t("heroV7.titleEm2")}</span>
          </h1>
          <p className="hero-sub">{t("heroV7.sub")}</p>
        </div>
      </div>

      {/* ── Toggle ──────────────────────────────────────────────────── */}
      <div className="container">
        <div className="pricing-toggle-wrap">
          <div className="pricing-toggle" role="tablist">
            <button
              type="button"
              className={`pt-opt${period === "month" ? " active" : ""}`}
              aria-selected={period === "month"}
              onClick={() => setPeriod("month")}
            >
              {t("toggleMonthV7")}
            </button>
            <button
              type="button"
              className={`pt-opt${period === "year" ? " active" : ""}`}
              aria-selected={period === "year"}
              onClick={() => setPeriod("year")}
            >
              {t("toggleYearV7")}{" "}
              <span className="pt-badge">{t("toggleBadgeV7")}</span>
            </button>
          </div>
          {period === "year" && (
            <p className="toggle-b2b-note">{t("toggleB2bNote")}</p>
          )}
        </div>

        {/* ── Plans grid ──────────────────────────────────────────── */}
        <div className="plans-grid" data-period={period}>

          {/* FREE */}
          <div className="sub-card">
            <div className="sub-tag">{t("tiers.free.name")}</div>
            <div className="sub-price">
              <span className="sub-amount">{formatRub(PRICE_FREE, locale)}</span>
            </div>
            <div className="sub-for">{t("tiers.free.desc")}</div>
            <SubBullets
              items={[
                ...SUBSCRIPTION_TIERS.find((x) => x.id === "free")!.quotaKeys.map((k) => t(k)),
                ...SUBSCRIPTION_TIERS.find((x) => x.id === "free")!.featureKeys.map((k) => t(k)),
              ]}
            />
            <TrackedLink
              href={ctaHref("free")}
              goal="pricing_free_click"
              className="sub-cta"
            >
              {t("ctaRegister")}
              <Arrow />
            </TrackedLink>
            <p className="sub-free-note">{t("freeNote")}</p>
          </div>

          {/* PAID */}
          {paidPlans.map((p) => {
            const yearly = p.monthly * 10;
            const economy = p.monthly * 2;
            const tier = SUBSCRIPTION_TIERS.find((x) => x.id === p.id || (p.id === "teamPlus" && x.id === "team_plus"))!;
            const tierKey = p.id === "teamPlus" ? "team_plus" : p.id;
            const bullets = [
              ...tier.quotaKeys.map((k) => t(k)),
              ...tier.featureKeys.map((k) => t(k)),
            ];
            return (
              <div
                key={p.id}
                className={`sub-card${p.featured ? " sub-card-highlight" : ""}`}
              >
                {p.featured && (
                  <div className="sub-badge">{t("popular")}</div>
                )}
                <div className="sub-tag">{t(`tiers.${tierKey}.name`)}</div>

                {/* Monthly price */}
                <div className="sub-price price-month">
                  <span className="sub-amount">{formatRub(p.monthly, locale)}</span>
                  <span className="sub-per">{t("perMonth")}</span>
                </div>
                {/* Yearly price */}
                <div className="sub-price price-year">
                  <span className="sub-amount">{formatRub(yearly, locale)}</span>
                  <span className="sub-per">{t("perYear")}</span>
                </div>
                {/* Economy line (year only) */}
                <div className="sub-economy year-only">
                  {t("economyTpl", { amount: formatRub(economy, locale) })}
                </div>

                <div className="sub-for month-only">{t(`tiers.${tierKey}.desc`)}</div>
                <div className="sub-for year-only">{t("forYearNote")}</div>

                <SubBullets items={bullets} />

                {/* Month CTA */}
                <TrackedLink
                  href={`/login?plan=${p.planParam}&next=/account/billing`}
                  className="sub-cta sub-cta-primary cta-month"
                >
                  {t("ctaConnect")}
                </TrackedLink>
                {/* Year CTA */}
                <TrackedLink
                  href={`/enterprise?plan=${p.planParam}&period=year#form`}
                  className="sub-cta sub-cta-primary cta-year"
                >
                  {t("ctaInvoice")}
                </TrackedLink>
              </div>
            );
          })}
        </div>

        {/* ── Quotas note ─────────────────────────────────────────── */}
        <div className="quotas-note">
          <div className="qn-icon">i</div>
          <div>
            <strong>{t("quotasNoteStrong")}</strong>
            {" — "}
            {t("quotasNoteBody")}
          </div>
        </div>

        {/* ── Enterprise card ──────────────────────────────────────── */}
        <div className="enterprise-card">
          <div className="ent-content">
            <h3>{t("enterprise.title")}</h3>
            <p>{t("enterprise.body")}</p>
            <div className="ent-pills">
              {(t.raw("enterprise.pills") as string[]).map((pill) => (
                <span key={pill} className="ent-pill">
                  {pill}
                </span>
              ))}
            </div>
          </div>
          <TrackedLink
            href="/enterprise#form"
            goal="pricing_enterprise_click"
            className="ent-cta"
          >
            {t("enterprise.cta")}
          </TrackedLink>
        </div>
      </div>

      {/* ── Search-is-free explainer (ТЗ §3.5) ─────────────────────── */}
      <div className="container">
        <p className="search-free-note">{t("searchFree")}</p>
      </div>

      {/* ── One-off reports ────────────────────────────────────────── */}
      {/* Only render if at least one product exists (anti-fab) */}
      {ONE_OFF_PRODUCTS.length > 0 && (
        <div className="container">
          <div className="pricing-section-head">
            <h2 className="pricing-h2">{t("oneOff.title")}</h2>
            <p className="pricing-section-sub">{t("oneOff.subtitle")}</p>
          </div>
          <div className="oneoff-grid">
            {ONE_OFF_PRODUCTS.map((product) => (
              <div
                key={product.id}
                className={`sub-card${product.featured ? " sub-card-highlight" : ""}`}
              >
                <div className="sub-tag">
                  {t(`products.${product.id}.name`)}
                  {product.featured && (
                    <span
                      style={{
                        marginLeft: 8,
                        background: "var(--accent-soft)",
                        color: "var(--accent-hover)",
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                      }}
                    >
                      {t("flagship")}
                    </span>
                  )}
                </div>
                <div className="sub-price">
                  <span className="sub-amount">
                    {formatRub(oneOffPrice(product), locale)}
                  </span>
                </div>
                <div className="sub-for" style={{ marginBottom: 4 }}>
                  {t(`products.${product.id}.desc`)}
                </div>
                <div
                  className="sub-for"
                  style={{ fontSize: 12, color: "var(--slate-soft)", marginBottom: 20 }}
                >
                  {t(`products.${product.id}.time`)}
                </div>
                <TrackedLink
                  href={ctaHref(product.cta)}
                  goal="pricing_oneoff_click"
                  className={`sub-cta${product.featured ? " sub-cta-primary" : ""}`}
                >
                  {t("cta.request")}
                  <Arrow />
                </TrackedLink>
              </div>
            ))}
          </div>

          {/* Credit packs line */}
          <p className="packs-line">
            {t("oneOff.packs", {
              screening10: formatRub(CREDIT_PACKS.screening10, locale),
              deep20: formatRub(CREDIT_PACKS.deep20, locale),
            })}{" "}
            <TrackedLink href="/enterprise#form" goal="pricing_enterprise_click">
              {t("oneOff.packsCta")} →
            </TrackedLink>
          </p>
        </div>
      )}

      {/* ── Addons (empty now — anti-fab) ─────────────────────────── */}
      {VISIBLE_ADDONS.length > 0 && (
        <div className="container">
          {/* addons render when ADDONS_ENABLED flipped on */}
        </div>
      )}

      {/* ── FAQ ──────────────────────────────────────────────────── */}
      <div className="pricing-faq-section">
        <div className="container">
          <span className="section-eyebrow">{t("faq.title")}</span>
          <h2 className="section-h2">
            {t("faqV7.title").split(" — ")[0]} —{" "}
            <span className="em">{t("faqV7.titleEm")}</span>
          </h2>
          <div className="faq-list">
            {faqItemsV7.map((item, i) => (
              <FaqItem key={i} question={item.q} answerHtml={item.a} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Feedback hook (ТЗ §3.8) ──────────────────────────────── */}
      <div className="container">
        <div
          style={{
            background: "var(--surf)",
            border: "1px solid var(--line)",
            borderRadius: 16,
            padding: "40px 32px",
            textAlign: "center",
            marginBottom: 40,
          }}
        >
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "var(--text-strong)",
              marginBottom: 10,
            }}
          >
            {t("feedback.title")}
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "var(--text-mute)",
              maxWidth: 560,
              margin: "0 auto 20px",
              lineHeight: 1.55,
            }}
          >
            {t("feedback.body")}
          </p>
          <a
            href="mailto:support@patent-scan.com?subject=ПатентСкан%20—%20мнение%20о%20тарифах"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 20px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg)",
              color: "var(--text-strong)",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
              transition: "all 150ms",
            }}
          >
            {t("feedback.cta")}
          </a>
        </div>

        {/* Refund / tax note */}
        <p className="refund-strip">
          {t("refundNote")}{" "}
          <TrackedLink href="/terms">{t("termsLink")}</TrackedLink>
        </p>
      </div>
    </>
  );
}
