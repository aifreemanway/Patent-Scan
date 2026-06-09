// /new-search — product chooser. The account "+ Новый поиск" button lands here
// so the user picks WHICH product (Поиск новизны / Патентный ландшафт / Скрининг)
// before being dropped into a form, instead of silently defaulting to novelty.
// Server component: locale + header + the user's live per-product quota, then a
// card grid of Links to each product's own page (those keep their own gating).

import { setRequestLocale, getTranslations } from "next-intl/server";
import { Header } from "@/components/Header";
import { Link } from "@/i18n/navigation";
import { createSupabaseServer } from "@/lib/supabase-server";

type ProductKey = "search" | "expert" | "landscape" | "screening";

type ChooserHref = string | { pathname: string; query?: Record<string, string> };

const PRODUCTS: { key: ProductKey; href: ChooserHref }[] = [
  { key: "search", href: "/search" },
  // Object form, NOT the "/search?mode=expert" string — next-intl <Link> dropped
  // the query on the string form, so /search ran the consumer v1 path (no field,
  // no toggle). QA #3 fix. The object form reliably carries ?mode=expert.
  { key: "expert", href: { pathname: "/search", query: { mode: "expert" } } },
  { key: "landscape", href: "/landscape" },
  { key: "screening", href: "/literature-review" },
];

// Which get_quota_status() bucket backs each product's badge. Screening has no
// monthly quota counter (paid/ordered separately), so it shows no badge.
const QUOTA_KEY: Record<ProductKey, "search" | "landscape" | null> = {
  search: "search",
  // Экспертный поиск: 1 бесплатный прогон на аккаунт, затем тратит Поиск-квоту —
  // отдельная механика, поэтому без статичного бейджа квоты в чузере.
  expert: null,
  landscape: "landscape",
  screening: null,
};

// Unlimited sentinel — matches get_quota_status() / the account quota grid.
const UNLIMITED = 999999;

type QuotaInfo = { limit: number; used: number; remaining: number };
type QuotaStatus = { search?: QuotaInfo; landscape?: QuotaInfo };

// Minimal line icons (inherit currentColor) — one per product.
const ICONS: Record<ProductKey, React.ReactNode> = {
  search: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
    />
  ),
  expert: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25Zm9.75-9.75A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v2.25a2.25 2.25 0 0 1-2.25 2.25h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
    />
  ),
  landscape: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
    />
  ),
  screening: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
    />
  ),
};

export default async function NewSearchPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("NewSearch");
  const items = t.raw("items") as Record<
    ProductKey,
    { title: string; desc: string; who: string; cta: string }
  >;

  // Live per-product quota for the signed-in user. The chooser is reachable both
  // authed (from the account sidebar) and not, so this is best-effort: no user →
  // no badges (the product pages still gate). Anti-fab: we only show a quota
  // badge for a product the RPC actually returned a counter for.
  let quota: QuotaStatus = {};
  try {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.rpc("get_quota_status");
      quota = (data ?? {}) as QuotaStatus;
    }
  } catch {
    quota = {};
  }

  const badgeFor = (key: ProductKey) => {
    const bucket = QUOTA_KEY[key];
    const q = bucket ? quota[bucket] : undefined;
    if (!q || typeof q.limit !== "number") return null;
    if (q.limit >= UNLIMITED) {
      return { text: t("quotaUnlimited"), tone: "ok" as const };
    }
    const remaining = typeof q.remaining === "number" ? q.remaining : q.limit - q.used;
    return {
      text: t("quotaRemaining", { remaining: Math.max(0, remaining), limit: q.limit }),
      tone: remaining <= 0 ? ("out" as const) : ("ok" as const),
    };
  };

  const BADGE_TONE = {
    ok: "bg-emerald-100 text-emerald-800",
    out: "bg-rose-100 text-rose-800",
  };

  return (
    <>
      <Header />
      <main className="flex flex-1 flex-col bg-slate-50">
        <div className="mx-auto w-full max-w-5xl px-6 py-12 sm:py-16">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-2xl text-slate-600">{t("subtitle")}</p>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PRODUCTS.map(({ key, href }) => {
              const it = items[key];
              const badge = badgeFor(key);
              return (
                <Link
                  key={key}
                  href={href}
                  className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-900 hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white">
                      <svg
                        className="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.6}
                        stroke="currentColor"
                        aria-hidden
                      >
                        {ICONS[key]}
                      </svg>
                    </span>
                    {badge && (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE_TONE[badge.tone]}`}
                      >
                        {badge.text}
                      </span>
                    )}
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-slate-900">
                    {it.title}
                  </h2>
                  <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                    {it.desc}
                  </p>
                  <p className="mt-4 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">
                      {t("whoLabel")}:
                    </span>{" "}
                    {it.who}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 group-hover:gap-2.5">
                    {it.cta}
                    <svg
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </main>
    </>
  );
}
