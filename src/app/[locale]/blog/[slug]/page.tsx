// /blog/<slug> — a single SEO article. Statically generated (no auth, no dynamic
// data) for speed + crawlability. Content + meta come from lib/blog-posts.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { TrackedLink } from "@/components/TrackedLink";
import { BLOG_POSTS, getBlogPost } from "@/lib/blog-posts";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru";

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};
  const url = `${SITE}/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: "article",
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const post = getBlogPost(slug);
  if (!post) notFound();

  const url = `${SITE}/blog/${post.slug}`;
  // Article JSON-LD — matches the visible content (schema↔page parity).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.headline,
    description: post.description,
    url,
    datePublished: post.datePublished,
    dateModified: post.dateModified,
    author: { "@type": "Organization", name: "ПатентСкан", url: SITE },
    publisher: { "@type": "Organization", name: "ПатентСкан", url: SITE },
    inLanguage: "ru",
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article>
        <Link href="/blog" className="text-sm font-medium text-blue-600 hover:underline">
          ← Блог
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {post.headline}
        </h1>
        <div className="mt-8 space-y-8">
          {post.passages.map((p, i) => (
            <section key={i}>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                {p.heading}
              </h2>
              <p className="mt-3 text-base leading-7 text-slate-700">{p.body}</p>
            </section>
          ))}
        </div>
        <div className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
          <TrackedLink
            href="/search"
            goal="blog_to_search"
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            {post.ctaText} →
          </TrackedLink>
        </div>
      </article>
    </main>
  );
}
