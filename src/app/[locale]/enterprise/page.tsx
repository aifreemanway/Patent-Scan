// /enterprise — v7 design. Converted from v7-enterprise.html mockup
// (2026-06-04). Established pattern: .lp wrapper + SiteNav + landing.css.
// EnterpriseForm logic is PRESERVED unchanged (POST /api/enterprise/request,
// Turnstile, all fields). Only the surrounding container is restyled.
// Footer: layout.tsx renders it — NOT duplicated here.

import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { FaqItem } from "@/components/FaqItem";
import { TrackedLink } from "@/components/TrackedLink";
import { EnterpriseForm } from "./EnterpriseForm";
import "../landing.css";

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

  // v7 typed arrays
  type FormatItem = {
    title: string;
    badge: string | null;
    tag: string;
    bullets: string[];
    turnaround: string;
  };
  type AudienceItem = { title: string; body: string };
  type TrustItem = {
    num: string;
    numAccent: boolean;
    numSuffix: string;
    accentSuffix?: boolean;
    body: string;
  };
  type FaqItemData = { q: string; a: string };

  const formatItems = t.raw("formats.items") as FormatItem[];
  const audienceItems = t.raw("audience.items") as AudienceItem[];
  const trustItems = t.raw("trust.items") as TrustItem[];
  const faqItems = t.raw("faq.items") as FaqItemData[];

  return (
    <div className="lp">
      <SiteNav />

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="ent-hero">
        <div className="container">
          <div className="ent-hero-inner">
            {/* Left column */}
            <div>
              <span className="eyebrow">
                <span className="live" />
                {t("hero.eyebrow")}
              </span>
              <h1 className="hero-h1">
                {t("hero.titlePart1")}{" "}
                <span className="em">{t("hero.titleAccent")}</span>
              </h1>
              <p className="hero-sub">{t("hero.sub")}</p>
              <p className="ent-hero-promise">
                {/* Строка содержит <em>…</em> → рендерим через t.rich с обработчиком
                    тега (next-intl парсит теги при форматировании; обычный t()
                    бросает FORMATTING_ERROR). .em = синий акцент v7. */}
                {t.rich("hero.promise", {
                  em: (chunks) => <span className="em">{chunks}</span>,
                })}
              </p>
              <div className="ent-cta-row">
                <TrackedLink
                  href="/enterprise#form"
                  goal="b2b_click"
                  className="btn-primary"
                >
                  {t("hero.ctaPrimary")}
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path
                      d="M3 8h10M9 4l4 4-4 4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </TrackedLink>
                <TrackedLink
                  href="/pricing"
                  goal="pricing_view"
                  className="btn-ghost"
                >
                  {t("hero.ctaSecondary")}
                </TrackedLink>
              </div>
            </div>

            {/* Right column — deliverable preview card */}
            <div className="deliverable-card">
              <div className="dc-head">
                <span className="dc-label">{t("hero.deliverableCardLabel")}</span>
                <span className="dc-tag">{t("hero.deliverableCardTag")}</span>
              </div>
              <div className="dc-row">
                <span className="dc-row-label">{t("hero.labelFormats")}</span>
                <span className="dc-row-value">{t("hero.deliverableFormats")}</span>
              </div>
              <div className="dc-row">
                <span className="dc-row-label">{t("hero.labelJurisdictions")}</span>
                <span className="dc-row-value">{t("hero.deliverableJurisdictions")}</span>
              </div>
              <div className="dc-row">
                <span className="dc-row-label">{t("hero.labelDepth")}</span>
                <span className="dc-row-value">{t("hero.deliverableSampleSize")}</span>
              </div>
              <div className="dc-row">
                <span className="dc-row-label">{t("hero.labelTurnaround")}</span>
                <span className="dc-row-value">{t("hero.deliverableTurnaround")}</span>
              </div>
              <div className="dc-row">
                <span className="dc-row-label">{t("hero.labelSources")}</span>
                <span className="dc-row-value">{t("hero.deliverableSources")}</span>
              </div>
              <div className="dc-footer">{t("hero.deliverableFootnote")}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── ЧЕТЫРЕ ФОРМАТА (deliverables) ─────────────────────────── */}
      <section className="ent-section">
        <div className="container">
          <div className="ent-section-eyebrow">{t("formats.eyebrow")}</div>
          <h2 className="ent-section-h2">
            {t("formats.title")}{" "}
            <span className="em">{t("formats.titleAccent")}</span>
          </h2>
          <p className="ent-section-sub">{t("formats.sub")}</p>

          <div className="delv-grid">
            {formatItems.map((item) => (
              <div key={item.title} className="delv-card">
                <div className="delv-h">
                  {item.title}
                  {item.badge && (
                    <span className="delv-badge">{item.badge}</span>
                  )}
                </div>
                <div className="delv-tag">{item.tag}</div>
                <ul className="delv-bullets">
                  {item.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
                <div className="delv-meta">
                  <span>
                    <strong>{t("formats.turnaroundLabel")}</strong>{" "}
                    {item.turnaround}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── КОМУ ПОЛЕЗНО ──────────────────────────────────────────── */}
      <section className="ent-section">
        <div className="container">
          <div className="ent-section-eyebrow">{t("audience.eyebrow")}</div>
          <h2 className="ent-section-h2">{t("audience.title")}</h2>
          <p className="ent-section-sub">{t("audience.sub")}</p>

          <div className="audience-grid">
            {audienceItems.map((item) => (
              <div key={item.title} className="aud-cell">
                <div className="aud-cell-h">{item.title}</div>
                <div className="aud-cell-p">{item.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TRUST STRIP ───────────────────────────────────────────── */}
      <div className="trust-i-strip">
        <div className="container">
          <div className="trust-i-grid">
            {trustItems.map((item, i) => (
              <div key={i} className="trust-i-cell">
                <div className="trust-i-num">
                  {item.numAccent ? (
                    <>
                      <span className="accent">{item.num}</span>
                      {item.numSuffix}
                    </>
                  ) : (
                    <>
                      {item.num}
                      <span className="accent">{item.numSuffix}</span>
                    </>
                  )}
                </div>
                <div className="trust-i-lbl">{item.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── ФОРМА (preserved EnterpriseForm logic) ────────────────── */}
      <section className="ent-section" id="form">
        <div className="container">
          <div className="ent-form-wrap">
            <h2 className="ent-form-wrap-title">{t("formSection.title")}</h2>
            <p className="ent-form-wrap-sub">{t("formSection.sub")}</p>
            <div className="ent-form-card">
              <EnterpriseForm locale={locale} siteKey={siteKey} />
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────── */}
      <section className="ent-section">
        <div className="container">
          <div className="ent-section-eyebrow">{t("faq.eyebrow")}</div>
          <h2 className="ent-section-h2">
            {t("faq.title")}{" "}
            <span className="em">{t("faq.titleAccent")}</span>
          </h2>

          <div className="faq-list">
            {faqItems.map((item) => (
              <FaqItem key={item.q} question={item.q} answerHtml={item.a} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
