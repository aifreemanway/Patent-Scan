import type { MetadataRoute } from "next";

// robots.txt — per ap-mediabuyer SEO/LLM package (seo-content-package-v7-2026-06-03).
// Policy: AI/LLM crawlers EXPLICITLY ALLOWED (citability in GenSearch / Perplexity /
// ChatGPT / Алиса). User-/tool-specific routes blocked from indexing.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru";

// Verified against current platform robots docs at finalize time (tokens drift).
const AI_BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "YandexAdditional",
  "CCBot",
];

// Non-content / per-user routes — keep out of the index.
const DISALLOW = ["/login", "/account", "/auth", "/processing", "/report", "/api/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      ...AI_BOTS.map((userAgent) => ({ userAgent, allow: "/" })),
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
