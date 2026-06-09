"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { TrackedLink } from "@/components/TrackedLink";
import type { MetrikaGoal } from "@/lib/metrika";
import {
  PRICE_FREE,
  PRICE_STARTER,
  PRICE_TEAM,
  PRICE_TEAM_PLUS,
  formatRub,
} from "@/lib/pricing";

// Блок подписок на лендинге. Тоггл месяц/год — React-стейт (data-period на
// wrapper'е, CSS прячет неактивный вариант). Цены ₽ берутся ТОЛЬКО из lib/pricing
// (источник правды, анти-дрейф); годовая = ×10 (2 месяца бесплатно), экономия =
// ×2. Вся копия — из i18n (Landing.subs). Карточки/бандлы соответствуют макету v7.

type Period = "month" | "year";

type PaidPlan = {
  id: "starter" | "team" | "teamPlus";
  /** query-параметр plan= для login/enterprise. */
  planParam: string;
  monthly: number;
  featured?: boolean;
  goalMonth?: MetrikaGoal;
};

const PAID_PLANS: PaidPlan[] = [
  { id: "starter", planParam: "starter", monthly: PRICE_STARTER, goalMonth: "sub_starter_click" },
  { id: "team", planParam: "team", monthly: PRICE_TEAM, featured: true, goalMonth: "sub_team_click" },
  { id: "teamPlus", planParam: "teamplus", monthly: PRICE_TEAM_PLUS },
];

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="sub-bullets">
      {items.map((html, i) => (
        <li key={i} dangerouslySetInnerHTML={{ __html: html }} />
      ))}
    </ul>
  );
}

// Value-anchor блок (ba v3.1) — ориентировочная экономия времени специалиста на
// тарифе. Hard-слова (ДО / ориентировочная / рутинного / специалиста) — verbatim
// из i18n, НЕ упрощать. ₽ не показываем (клиент сам считает по своей ставке).
function ValueAnchor({ head, units }: { head: string; units: string }) {
  return (
    <div
      style={{
        borderLeft: "3px solid var(--accent, #2563eb)",
        background: "rgba(37,99,235,0.06)",
        padding: "10px 12px",
        borderRadius: 8,
        margin: "2px 0 14px",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong, #0f172a)", lineHeight: 1.45 }}>
        {head}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--slate, #64748b)", marginTop: 4 }}>{units}</div>
    </div>
  );
}

export function LandingPricing() {
  const t = useTranslations("Landing.subs");
  const locale = useLocale();
  const [period, setPeriod] = useState<Period>("month");

  return (
    <section className="subs" id="pricing">
      <div className="container">
        <div className="section-head">
          <span className="section-eyebrow">{t("eyebrow")}</span>
          <h2 className="section-h2">
            {t("titleA")} <span className="em">{t("titleEm")}</span>
          </h2>
          <p className="section-sub">{t("sub")}</p>
        </div>

        {/* TOGGLE */}
        <div className="pricing-toggle" role="tablist">
          <button
            type="button"
            className={`pt-opt${period === "month" ? " active" : ""}`}
            aria-selected={period === "month"}
            onClick={() => setPeriod("month")}
          >
            {t("toggleMonth")}
          </button>
          <button
            type="button"
            className={`pt-opt${period === "year" ? " active" : ""}`}
            aria-selected={period === "year"}
            onClick={() => setPeriod("year")}
          >
            {t("toggleYear")} <span className="pt-badge">{t("toggleBadge")}</span>
          </button>
        </div>
        <p className="toggle-note">{t("toggleNote")}</p>

        <div className="subs-grid subs-grid-4" data-period={period}>
          {/* FREE */}
          <div className="sub-card">
            <div className="sub-tag">{t("plans.free.tag")}</div>
            <div className="sub-price">
              <span className="sub-amount">{formatRub(PRICE_FREE, locale)}</span>
            </div>
            <div className="sub-for">{t("plans.free.for")}</div>
            <ValueAnchor
              head={t("plans.free.valueAnchor.head")}
              units={t("plans.free.valueAnchor.units")}
            />
            <Bullets items={t.raw("plans.free.bullets") as string[]} />
            <TrackedLink href="/login" goal="login_click" className="sub-cta">
              {t("ctaRegister")}
              <Arrow />
            </TrackedLink>
          </div>

          {/* PAID */}
          {PAID_PLANS.map((p) => {
            const yearly = p.monthly * 10;
            const economy = p.monthly * 2;
            return (
              <div
                key={p.id}
                className={`sub-card${p.featured ? " sub-card-highlight" : ""}`}
              >
                {p.featured && <div className="sub-badge">{t("popular")}</div>}
                <div className="sub-tag">{t(`plans.${p.id}.tag`)}</div>

                <div className="sub-price price-month">
                  <span className="sub-amount">{formatRub(p.monthly, locale)}</span>
                  <span className="sub-per">{t("perMonth")}</span>
                </div>
                <div className="sub-price price-year">
                  <span className="sub-amount">{formatRub(yearly, locale)}</span>
                  <span className="sub-per">{t("perYear")}</span>
                </div>
                <div className="sub-for price-year sub-economy">
                  {t("economyTpl", { amount: formatRub(economy, locale) })}
                </div>
                <div className="sub-for price-month">{t(`plans.${p.id}.for`)}</div>

                <ValueAnchor
                  head={t(`plans.${p.id}.valueAnchor.head`)}
                  units={t(`plans.${p.id}.valueAnchor.units`)}
                />

                <Bullets items={t.raw(`plans.${p.id}.bullets`) as string[]} />

                <TrackedLink
                  href={`/login?plan=${p.planParam}&next=/account/billing`}
                  goal={p.goalMonth}
                  className="sub-cta sub-cta-primary cta-month"
                >
                  {t("ctaConnect")}
                </TrackedLink>
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

        <p className="subs-teaser">
          {t("teaserText")}{" "}
          <TrackedLink href="/enterprise" goal="pricing_view">
            {t("teaserLink")}
          </TrackedLink>
        </p>
        <p
          className="subs-tax-note"
          style={{ textAlign: "center", fontSize: 12, color: "var(--slate)", marginTop: 8 }}
        >
          {t("taxNote")}
        </p>
      </div>
    </section>
  );
}
