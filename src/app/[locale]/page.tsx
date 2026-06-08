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
type Tile = { tag: string; h3: string; tagline: string; desc: string; bullets: string[]; who: string; cta: string };
type Cell = { num: string; h4: string; p: string };
type MatrixRow = { task: string; cells: { t: string; k: "yes" | "no" | "partial" }[] };
type SourceItem = { name: string; sub: string };
type Faq = { q: string; a: string };
type HeroRow = { label: string; value: string };

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
  const sources = t.raw("sources.items") as SourceItem[];
  const faqs = t.raw("faq.items") as Faq[];
  const heroRows = t.raw("hero.card.rows") as HeroRow[];
  const pills = t.raw("hero.pills") as string[];

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

  return (
    <div className="lp">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
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
              <TrackedLink href="/search" goal="search_start" className="btn-primary">
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
                  <span className={`tile-tag${free ? " free" : ""}`}>{tile.tag}</span>
                  <div className="tile-h3">{tile.h3}</div>
                  <div className="tile-tagline">{tile.tagline}</div>
                  <p className="tile-desc">{tile.desc}</p>
                  <ul className="tile-bullets">
                    {tile.bullets.map((b, i) => (
                      <li key={i} dangerouslySetInnerHTML={{ __html: b }} />
                    ))}
                  </ul>
                  <div className="tile-meta">
                    <span className="tile-meta-label">{t("tiles.whoLabel")}</span>
                    <strong>{tile.who}</strong>
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
                  <tr key={i}>
                    <td>{r.task}</td>
                    {r.cells.map((c, j) => (
                      <td key={j} className={c.k}>
                        {c.t}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* SOURCES STRIP */}
      <div className="sources">
        <div className="container">
          <div className="sources-head">{t("sources.head")}</div>
          <div className="sources-row">
            {sources.map((s) => (
              <div className="src" key={s.name}>
                {s.name}
                <span className="sub">{s.sub}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

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
            <TrackedLink href="/search" goal="pilot_cta" className="btn-primary">
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
