// /account — Overview / Главная
// Shows: current tier card + 4-quota grid + last 3 requests + promo (Free only).
//
// Data: get_quota_status() RPC (cheap, RLS-respecting) + a single SELECT from
// search_requests (latest 3, non-deleted). Profile tier comes from the parent
// layout via a second SELECT here — kept separate from layout's read so the
// layout stays lean and this page can extend its read as the overview grows.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/supabase-server";

type Tier = "free" | "starter" | "team" | "enterprise";

type QuotaStatus = {
  search?: { limit: number; used: number; remaining: number };
  landscape?: { limit: number; used: number; remaining: number };
  tier?: Tier;
  period_start?: string;
  error?: string;
};

type RecentRow = {
  id: string;
  type: "novelty" | "landscape" | "deep_analysis" | "literature_review";
  topic: string;
  status:
    | "pending"
    | "in_progress"
    | "completed"
    | "error"
    | "cancelled";
  created_at: string;
};

const TIER_DESCRIPTION_KEY: Record<Tier, string> = {
  free: "tier.descFree",
  starter: "tier.descStarter",
  team: "tier.descTeam",
  enterprise: "tier.descEnterprise",
};

const STATUS_COLOR: Record<RecentRow["status"], string> = {
  pending: "bg-slate-100 text-slate-700",
  in_progress: "bg-sky-100 text-sky-800",
  completed: "bg-emerald-100 text-emerald-800",
  error: "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-100 text-slate-500",
};

const TYPE_COLOR: Record<RecentRow["type"], string> = {
  novelty: "bg-blue-100 text-blue-900",
  landscape: "bg-violet-100 text-violet-900",
  deep_analysis: "bg-amber-100 text-amber-900",
  literature_review: "bg-teal-100 text-teal-900",
};

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatResetDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  // period_start = first day of current month → reset = first day of next month
  const start = new Date(iso);
  const reset = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(reset);
}

export default async function AccountOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Account");

  const { user, supabase } = await requireUser();

  const [
    { data: profile },
    { data: quotaRaw },
    { data: recent },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("tier, free_deep_analysis_used")
      .eq("id", user.id)
      .single(),
    supabase.rpc("get_quota_status"),
    supabase
      .from("search_requests")
      .select("id, type, topic, status, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const tier: Tier = (profile?.tier as Tier) ?? "free";
  const quota = (quotaRaw ?? {}) as QuotaStatus;
  const deepUsed = profile?.free_deep_analysis_used ?? false;
  const recentRows = (recent ?? []) as RecentRow[];
  const resetDate = formatResetDate(quota.period_start, locale);

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("overview.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("overview.subtitle")}</p>
      </header>

      {/* Tariff card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-500">
          {t("overview.currentPlan")}
        </h2>
        <p className="mt-2 text-xl font-semibold text-slate-900">
          {t(`tier.${tier}`)}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {t(TIER_DESCRIPTION_KEY[tier])}
        </p>
        <p className="mt-3 text-xs text-slate-500">
          {tier === "free"
            ? t("overview.cycleFree")
            : t("overview.cycleSubscription")}
        </p>
        <div className="mt-5">
          <Link
            href="/account/billing"
            className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            {tier === "free"
              ? t("overview.ctaUpgrade")
              : t("overview.ctaManage")}
          </Link>
        </div>
      </section>

      {/* Quotas grid */}
      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-500">
          {t("overview.quotas")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <QuotaCard
            label={t("overview.quotaSearch")}
            used={quota.search?.used ?? 0}
            limit={quota.search?.limit ?? 0}
            resetLabel={resetDate ? t("overview.resetsOn", { date: resetDate }) : ""}
          />
          <QuotaCard
            label={t("overview.quotaLandscape")}
            used={quota.landscape?.used ?? 0}
            limit={quota.landscape?.limit ?? 0}
            resetLabel={resetDate ? t("overview.resetsOn", { date: resetDate }) : ""}
          />
          <QuotaCard
            label={t("overview.quotaDeep")}
            used={deepUsed ? 1 : 0}
            limit={1}
            resetLabel={t("overview.lifetime")}
          />
          <QuotaCard
            label={t("overview.quotaLitReview")}
            used={0}
            limit={0}
            resetLabel={t("overview.notInPlan")}
            unavailable
          />
        </div>
      </section>

      {/* Last 3 requests */}
      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-500">
          {t("overview.recent")}
        </h2>
        {recentRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm text-slate-600">
              {t("overview.emptyRecent")}
            </p>
            <Link
              href="/search"
              className="mt-4 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              {t("overview.ctaFirstSearch")}
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {recentRows.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
              >
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLOR[r.type]}`}
                >
                  {t(`type.${r.type}`)}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {r.topic}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status]}`}
                >
                  {t(`status.${r.status}`)}
                </span>
                <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">
                  {formatDate(r.created_at, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 text-right">
          <Link
            href="/account/history"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {t("overview.allHistory")} →
          </Link>
        </div>
      </section>

      {/* Promo — Free trial only */}
      {tier === "free" && (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-lg font-semibold text-slate-900">
            {t("overview.promoTitle")}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {t("overview.promoBody")}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/account/billing"
              className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              {t("overview.promoCtaPrimary")}
            </Link>
            <Link
              href="/account/billing"
              className="inline-flex rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
            >
              {t("overview.promoCtaCompare")}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

function QuotaCard({
  label,
  used,
  limit,
  resetLabel,
  unavailable,
}: {
  label: string;
  used: number;
  limit: number;
  resetLabel: string;
  unavailable?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      {unavailable ? (
        <p className="mt-2 text-2xl font-bold text-slate-400">—</p>
      ) : (
        <p className="mt-2 text-2xl font-bold text-slate-900">
          {used}
          <span className="text-base font-medium text-slate-400"> / {limit >= 999999 ? "∞" : limit}</span>
        </p>
      )}
      {resetLabel && (
        <p className="mt-1 text-xs text-slate-500">{resetLabel}</p>
      )}
    </div>
  );
}
