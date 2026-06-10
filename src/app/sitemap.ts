import type { MetadataRoute } from "next";
import { BLOG_POSTS } from "@/lib/blog-posts";

// sitemap.xml — per ap-mediabuyer SEO package. Only PUBLIC, content routes that
// actually exist (anti-fab: no invented URLs). Locale strategy = next-intl
// "as-needed": default ru is unprefixed, en is /en. Each entry carries an
// hreflang alternate to /en.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru";

type Freq = MetadataRoute.Sitemap[number]["changeFrequency"];

const ROUTES: { path: string; priority: number; changeFrequency: Freq }[] = [
  { path: "", priority: 1.0, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "weekly" },
  { path: "/enterprise", priority: 0.7, changeFrequency: "monthly" },
  { path: "/search", priority: 0.6, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  // /requisites НЕ включаем в sitemap (правка ap-mediabuyer 2026-06-08) — страница
  // остаётся живой для ЮKassa-комплаенса, но не индексируется/не промоутится.
  // Blog — SEO content hub + articles (wave content lives in lib/blog-posts).
  { path: "/blog", priority: 0.6, changeFrequency: "weekly" },
  ...BLOG_POSTS.map((p) => ({
    path: `/blog/${p.slug}`,
    priority: 0.7,
    changeFrequency: "monthly" as Freq,
  })),
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((r) => ({
    url: `${SITE}${r.path || "/"}`,
    lastModified: now,
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
