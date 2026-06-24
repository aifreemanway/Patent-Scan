import { Fragment } from "react";
import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { TrackedLink } from "@/components/TrackedLink";
import { SiteNav } from "@/components/SiteNav";
import { FaqItem } from "@/components/FaqItem";
import { LandingPricing } from "@/components/LandingPricing";
import "./landing.css";

// Лендинг v7 (PRESERVE из макета v7-index-C). Разметка/стили один-в-один,
// «живыми» сделаны: ссылки (реальные роуты), цели Метрики (reachGoal на 13 CTA),
// блок подписок (цены из lib/pricing). Стили скоуплены под .lp (landing.css).
// Footer рендерит layout (общий) — здесь не дублируем.

type Step = { n: string; title: string; body: string };
type Tile = { tag?: string; h3: string; tagline: string; desc: string; extra?: string; bullets: string[]; who: string; when: string; cta: string };
type Cell = { num: string; h4: string; p: string };
type MatrixRow = { section?: string; task: string; cells: { t: string; k: "yes" | "no" | "partial" }[] };
type Faq = { q: string; a: string };
type HeroRow = { label: string; value: string };
type ProtoItem = { num: string; title: string; meta: string; verdict: string; verdictKind: "direct" | "partial"; common: string; diff: string };
type RoiRow = { label: string; value: string; note?: string };

const ARROW = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TILES: { key: "search" | "landscape" | "screening"; free?: boolean; href: string; goal: "tile_search_cta" | "tile_landscape_click" | "tile_screening_click" }[] = [
  { key: "search", free: true, href: "/search", goal: "tile_search_cta" },
  { key: "landscape", href: "/login?intent=landscape", goal: "tile_landscape_click" },
  { key: "screening", href: "/login?intent=screening", goal: "tile_screening_click" },
];

// SEO-head v9 (§8) — page-specific meta + OG, override layout's generic Meta.
// Контент из ap-mediabuyer seo-head-v9-brief (v2-final). 94,9 млн = verified
// (прод 94 917 078, округление вниз). UTM на мета НЕ ставим.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru";
  return {
    title: "ПатентСкан — проверка изобретения по 94,9 млн патентов",
    description:
      "Проверьте уникальность изобретения по 94,9 млн патентов в 6 юрисдикциях. ИИ-анализ со ссылкой на каждый источник — за минуты, до похода к поверенному.",
    alternates: { canonical: `${site}/${locale}` },
    openGraph: {
      type: "website",
      title: "ПатентСкан — патентный поиск по 94,9 млн патентов",
      description:
        "ИИ находит ближайшие аналоги вашей идеи и объясняет отличия — каждый вывод со ссылкой на источник.",
      url: `${site}/`,
      locale: "ru_RU",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Landing");

  const steps = t.raw("how.steps") as Step[];
  const tiles = t.raw("tiles.items") as Record<string, Tile>;
  const cells = t.raw("trust.cells") as Cell[];
  const rows = t.raw("matrix.rows") as MatrixRow[];
  const faqs = t.raw("faq.items") as Faq[];
  const heroRows = t.raw("hero.card.rows") as HeroRow[];
  const pills = t.raw("hero.pills") as string[];
  const protoItems = t.raw("proto.items") as ProtoItem[];
  const roiAgencyRows = t.raw("roi.agencyRows") as RoiRow[];
  const roiOursRows = t.raw("roi.oursRows") as RoiRow[];

  // FAQPage JSON-LD — built from the SAME `faqs` rendered below, so the
  // structured data always matches the visible accordion (Google/Yandex require
  // schema↔page parity). Strip HTML tags from answers for the plain-text schema.
  // Per ap-mediabuyer SEO package — enables FAQ rich-snippets + AI-citation
  // (Яндекс GenSearch / Perplexity / ChatGPT).
  const stripHtml = (s: string) =>
    s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru";
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${siteUrl}/#faq`,
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: stripHtml(f.a) },
    })),
  };
  // SoftwareApplication JSON-LD (§8, per SEO brief). Organization/WebSite/Service
  // уже в layout.tsx — здесь НЕ дублируем (только page-specific schema поверх).
  const swJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${siteUrl}/#app`,
    name: "ПатентСкан",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: `${siteUrl}/`,
    description:
      "ИИ-сервис патентного поиска и анализа патентной чистоты по 94,9 млн патентам России, СНГ, США, Европы, Китая и Японии.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "RUB", name: "Free" },
    provider: { "@id": `${siteUrl}/#org` },
  };

  return (
    <div className="lp">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(swJsonLd) }}
      />
      {/* NAV */}
      <SiteNav />

      {/* HERO */}
      <section className="hero">
        <div className="container">
          <div className="hero-inner">
            <div>
              <span className="eyebrow">
                <span className="live"></span>
                {t("hero.eyebrow")}
              </span>
              <h1 className="hero-h1">
                {t("hero.titleA")} <span className="em">{t("hero.titleEm")}</span>
              </h1>
              <p className="hero-sub">{t("hero.sub")}</p>
              <p className="hero-promise">
                {t("hero.promiseA")} <span className="em">{t("hero.promiseEm")}</span>{t("hero.promiseB")}
              </p>
              <TrackedLink href="/new-search" goal="search_start" className="btn-primary">
                {t("hero.cta")}
                {ARROW}
              </TrackedLink>
              <div className="pills">
                {pills.map((p) => (
                  <span key={p} className="pill">
                    {p}
                  </span>
                ))}
              </div>
            </div>

            <div className="hero-right">
              <div className="hero-card">
                <div className="hc-head">
                  <span className="hc-label">{t("hero.card.label")}</span>
                  <span className="hc-tag">{t("hero.card.tag")}</span>
                </div>
                <div className="hc-verdict">
                  <div className="hc-verdict-label">{t("hero.card.verdictLabel")}</div>
                  <div className="hc-verdict-value">{t("hero.card.verdictValue")}</div>
                </div>
                {heroRows.map((r, i) => (
                  <div className="hc-row" key={i}>
                    <span className="hc-row-label">{r.label}</span>
                    <span className="hc-row-value">{r.value}</span>
                  </div>
                ))}
                <div className="hc-foot">{t("hero.card.foot")}</div>
              </div>

              <TrackedLink href="/enterprise#form" goal="b2b_click" className="b2b-card">
                <div className="b2b-card-head">
                  <span className="b2b-tag">{t("hero.b2b.tag")}</span>
                  <span className="b2b-arrow">→</span>
                </div>
                <div className="b2b-card-title">{t("hero.b2b.title")}</div>
                <div className="b2b-card-sub">{t("hero.b2b.sub")}</div>
                <span className="b2b-card-cta">
                  {t("hero.b2b.cta")} <span className="arr">→</span>
                </span>
              </TrackedLink>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="how">
        <div className="container">
          <div className="section-head">
            <span className="section-eyebrow">{t("how.eyebrow")}</span>
            <h2 className="section-h2">
              {t("how.titleA")} <span className="em">{t("how.titleEm")}</span>
            </h2>
            <p className="section-sub">{t("how.sub")}</p>
          </div>
          <div className="steps">
            {steps.map((s) => (
              <div className="step" key={s.n}>
                <span className="step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRODUCT TILES */}
      <section>
        <div className="container">
          <div className="section-head">
            <span className="section-eyebrow">{t("tiles.eyebrow")}</span>
            <h2 className="section-h2">
              {t("tiles.titleA")} <span className="em">{t("tiles.titleEm")}</span>
            </h2>
            <p className="section-sub">{t("tiles.sub")}</p>
          </div>
          <div className="tiles">
            {TILES.map(({ key, free, href, goal }) => {
              const tile = tiles[key];
              return (
                <div className="tile" key={key}>
                  {tile.tag ? (
                    <span className={`tile-tag${free ? " free" : ""}`}>{tile.tag}</span>
                  ) : null}
                  <div className="tile-h3">{tile.h3}</div>
                  <div className="tile-tagline">{tile.tagline}</div>
                  <p className="tile-desc">{tile.desc}</p>
                  {tile.extra ? (
                    <p className="tile-extra" dangerouslySetInnerHTML={{ __html: tile.extra }} />
                  ) : null}
                  <ul className="tile-bullets">
                    {tile.bullets.map((b, i) => (
                      <li key={i} dangerouslySetInnerHTML={{ __html: b }} />
                    ))}
                  </ul>
                  <div className="tile-meta">
                    <div className="tile-meta-row">
                      <span className="tile-meta-label">{t("tiles.whoLabel")}</span>
                      <strong>{tile.who}</strong>
                    </div>
                    <div className="tile-meta-row">
                      <span className="tile-meta-label">{t("tiles.whenLabel")}</span>
                      <strong>{tile.when}</strong>
                    </div>
                  </div>
                  <TrackedLink href={href} goal={goal} className={`tile-cta${free ? " free" : ""}`}>
                    {tile.cta}
                    {ARROW}
                  </TrackedLink>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* PROTO DEMO — что отличает Глубокий анализ */}
      <section className="proto-demo">
        <div className="container">
          <div className="section-head">
            <span className="section-eyebrow">{t("proto.eyebrow")}</span>
            <h2 className="section-h2">
              {t("proto.titleA")} <span className="em">{t("proto.titleEm")}</span>
            </h2>
            <p className="section-sub">{t("proto.sub")}</p>
          </div>

          <div className="proto-card">
            <div className="proto-card-head">
              <span className="proto-label">{t("proto.cardLabel")}</span>
              <span className="proto-tag">{t("proto.cardTag")}</span>
            </div>

            <div className="proto-idea">
              <span className="proto-idea-label">{t("proto.ideaLabel")}</span>
              <p>{t("proto.idea")}</p>
            </div>

            {protoItems.map((it, i) => (
              <div className="proto-item" key={i}>
                <div className="proto-item-head">
                  <span className="proto-num">{it.num}</span>
                  <div>
                    <div className="proto-title">{it.title}</div>
                    <div className="proto-meta">{it.meta}</div>
                  </div>
                  <span className={`proto-verdict proto-verdict-${it.verdictKind}`}>{it.verdict}</span>
                </div>
                <p className="proto-row">
                  <strong>{t("proto.commonLabel")}</strong> {it.common}
                </p>
                <p className="proto-row">
                  <strong>{t("proto.diffLabel")}</strong> {it.diff}
                </p>
              </div>
            ))}

            <div className="proto-foot">{t("proto.foot")}</div>
          </div>
        </div>
      </section>

      {/* ROI — патентное агентство vs ПатентСкан */}
      <section className="roi-section">
        <div className="container">
          <div className="section-head">
            <span className="section-eyebrow">{t("roi.eyebrow")}</span>
            <h2 className="section-h2">
              {t("roi.titleA")} <span className="em">{t("roi.titleEm")}</span>
            </h2>
            <p className="section-sub">{t("roi.sub")}</p>
          </div>

          <div className="roi-grid">
            <div className="roi-card roi-poverenny">
              <h3>{t("roi.agencyTitle")}</h3>
              <ul className="roi-list">
                {roiAgencyRows.map((r, i) => (
                  <li key={i}>
                    <span className="roi-li-l">{r.label}</span> <strong>{r.value}</strong>
                  </li>
                ))}
              </ul>
            </div>

            <div className="roi-card roi-ours">
              <h3>{t("roi.oursTitle")}</h3>
              <ul className="roi-list">
                {roiOursRows.map((r, i) => (
                  <li key={i}>
                    <span className="roi-li-l">{r.label}</span> <strong>{r.value}</strong>
                    {r.note ?? ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="roi-anchor">
            <p>
              <span dangerouslySetInnerHTML={{ __html: t.raw("roi.anchorA") as string }} />
              <span className="em">{t("roi.anchorEm")}</span>
              {t("roi.anchorB")}
            </p>
          </div>

          <p className="roi-note">{t("roi.note")}</p>
        </div>
      </section>

      {/* SUBSCRIPTIONS (client: toggle + prices from lib/pricing) */}
      <LandingPricing />

      {/* TRUST */}
      <section className="trust">
        <div className="container">
          <div className="section-head">
            <span className="section-eyebrow">{t("trust.eyebrow")}</span>
            <h2 className="section-h2" dangerouslySetInnerHTML={{ __html: t.raw("trust.titleHtml") as string }} />
            <p className="section-sub">{t("trust.sub")}</p>
          </div>
          <div className="trust-grid">
            {cells.map((c) => (
              <div className="trust-cell" key={c.num}>
                <span className="num">{c.num}</span>
                <h4>{c.h4}</h4>
                <p>{c.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DECISION MATRIX */}
      <section>
        <div className="container">
          <div className="section-head">
            <span className="section-eyebrow">{t("matrix.eyebrow")}</span>
            <h2 className="section-h2">{t("matrix.title")}</h2>
            <p className="section-sub">{t("matrix.sub")}</p>
          </div>
          <div className="matrix-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th>{t("matrix.colTask")}</th>
                  <th>{t("matrix.colSearch")}</th>
                  <th>{t("matrix.colLandscape")}</th>
                  <th>{t("matrix.colScreening")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Fragment key={i}>
                    {r.section ? (
                      <tr className="matrix-section">
                        <td colSpan={4}>{r.section}</td>
                      </tr>
                    ) : null}
                    <tr>
                      <td>{r.task}</td>
                      {r.cells.map((c, j) => (
                        <td key={j} className={c.k}>
                          {c.t}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section>
        <div className="container">
          <div className="section-head">
            <span className="section-eyebrow">{t("faq.eyebrow")}</span>
            <h2 className="section-h2">
              {t("faq.titleA")} <span className="em">{t("faq.titleEm")}</span>
            </h2>
          </div>
          <div className="faq-list">
            {faqs.map((f, i) => (
              <FaqItem key={i} question={f.q} answerHtml={f.a} />
            ))}
          </div>
        </div>
      </section>

      {/* PILOT BAND */}
      <div className="pilot-wrap">
        <div className="container">
          <div className="pilot">
            <h3>{t("pilot.title")}</h3>
            <p>{t("pilot.sub")}</p>
            <TrackedLink href="/new-search" goal="pilot_cta" className="btn-primary">
              {t("pilot.cta")}
              {ARROW}
            </TrackedLink>
          </div>
        </div>
      </div>

      {/* LEGAL LINE */}
      <div className="legal-line">{t("legal")}</div>
    </div>
  );
}
