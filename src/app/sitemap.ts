import type { MetadataRoute } from "next";
import { BLOG_POSTS } from "@/lib/blog-posts";

// sitemap.xml — per ap-mediabuyer SEO package. Only PUBLIC, content routes that
// actually exist (anti-fab: no invented URLs). Locale strategy = next-intl
// "as-needed": default ru is unprefixed, en is /en. Each entry carries an
// hreflang alternate to /en.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru";

type Freq = MetadataRoute.Sitemap[number]["changeFrequency"];

const ROUTES: {
  path: string;
  priority: number;
  changeFrequency: Freq;
  /** Real last-edit date, ISO. Omitted where we do not actually track one —
   *  see the note on lastModified below. */
  lastModified?: string;
}[] = [
  { path: "", priority: 1.0, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "weekly" },
  { path: "/enterprise", priority: 0.7, changeFrequency: "monthly" },
  { path: "/search", priority: 0.6, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  // /requisites НЕ включаем в sitemap (правка ap-mediabuyer 2026-06-08) — страница
  // остаётся живой для ЮKassa-комплаенса, но не индексируется/не промоутится.
  // Blog — SEO content hub + articles (wave content lives in lib/blog-posts).
  {
    path: "/blog",
    priority: 0.6,
    changeFrequency: "weekly",
    // The hub is as fresh as its freshest article.
    lastModified: BLOG_POSTS.reduce(
      (max, p) => (p.dateModified > max ? p.dateModified : max),
      BLOG_POSTS[0]?.dateModified ?? ""
    ),
  },
  ...BLOG_POSTS.map((p) => ({
    path: `/blog/${p.slug}`,
    priority: 0.7,
    changeFrequency: "monthly" as Freq,
    lastModified: p.dateModified,
  })),
];

// lastModified is a CLAIM to the crawler, so it has to be true. It used to be
// `new Date()` for every URL, which told Yandex and Google that all 22 pages
// had changed at the moment of the crawl — on every crawl. A lastmod that is
// always "now" is worthless as a freshness signal and Yandex discounts sitemaps
// that carry one, which is a plausible contributor to 15 published articles
// sitting at ~5 indexed pages (ap-marketing, 26.08).
//
// Articles carry a real dateModified, so they get it. Static pages do NOT have
// a tracked edit date, and inventing one would be exactly the fabrication this
// project forbids — so they ship with no lastmod at all, which is valid and
// honest. Give a page a real date here if we start tracking one.
export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((r) => ({
    url: `${SITE}${r.path || "/"}`,
    ...(r.lastModified ? { lastModified: new Date(r.lastModified) } : {}),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
    alternates: {
      languages: {
        ru: `${SITE}${r.path || "/"}`,
        en: `${SITE}/en${r.path}`,
      },
    },
  }));
}
