// /blog — index hub listing all articles. Links every post (internal-link hub
// for SEO + navigation). Statically generated.

import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BLOG_POSTS } from "@/lib/blog-posts";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://patent-scan.ru";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  await params;
  return {
    title: "Блог о патентном поиске — ПатентСкан",
    description:
      "Гайды по патентному поиску, проверке патентной чистоты и работе с базами Роспатента (ФИПС) и зарубежных стран.",
    alternates: { canonical: `${SITE}/blog` },
  };
}

export default async function BlogIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        Блог
      </h1>
      <p className="mt-3 text-slate-600">
        Как искать похожие патенты, проверять патентную чистоту идеи и работать с
        базами Роспатента и зарубежных стран — практические гайды для
        предпринимателей и изобретателей.
      </p>
      <ul className="mt-10 space-y-5">
        {BLOG_POSTS.map((post) => (
          <li
            key={post.slug}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300"
          >
            <Link href={`/blog/${post.slug}`} className="group">
              <h2 className="text-lg font-semibold text-slate-900 group-hover:text-blue-700">
                {post.headline}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {post.description}
              </p>
              <span className="mt-3 inline-block text-sm font-medium text-blue-600 group-hover:underline">
                Читать →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
