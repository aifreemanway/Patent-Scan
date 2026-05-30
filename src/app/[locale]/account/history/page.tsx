// /account/history — full request history with filters + pagination.
// All filter state lives in URL search params so links are shareable and the
// page is server-renderable. Row actions (cancel, soft-delete) post to the
// shared server-action module via small <form action={fn}> wrappers.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/supabase-server";
import {
  cancelRequest,
  softDeleteRequest,
} from "@/lib/server-actions/account";

type Status =
  | "pending"
  | "in_progress"
  | "completed"
  | "error"
  | "cancelled";

type Type = "novelty" | "landscape" | "deep_analysis" | "literature_review";

type Row = {
  id: string;
  type: Type;
  topic: string;
  status: Status;
  created_at: string;
  result_pdf_url: string | null;
  progress_pct: number | null;
  error_message: string | null;
};

const PAGE_SIZE = 25;
const KNOWN_TYPES: readonly Type[] = [
  "novelty",
  "landscape",
  "deep_analysis",
  "literature_review",
];
const KNOWN_STATUSES: readonly Status[] = [
  "pending",
  "in_progress",
  "completed",
  "error",
  "cancelled",
];

const TYPE_COLOR: Record<Type, string> = {
  novelty: "bg-blue-100 text-blue-900",
  landscape: "bg-violet-100 text-violet-900",
  deep_analysis: "bg-amber-100 text-amber-900",
  literature_review: "bg-teal-100 text-teal-900",
};

const STATUS_COLOR: Record<Status, string> = {
  pending: "bg-slate-100 text-slate-700",
  in_progress: "bg-sky-100 text-sky-800",
  completed: "bg-emerald-100 text-emerald-800",
  error: "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-100 text-slate-500",
};

function asOne(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

function isType(v: string): v is Type {
  return (KNOWN_TYPES as readonly string[]).includes(v);
}
function isStatus(v: string): v is Status {
  return (KNOWN_STATUSES as readonly string[]).includes(v);
}

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function reportHref(r: Row): string | null {
  if (r.status !== "completed") return null;
  if (r.type === "landscape") return `/landscape/report?id=${r.id}`;
  // novelty / deep_analysis share the report page
  return `/report?id=${r.id}`;
}

function buildQuery(
  current: URLSearchParams,
  overrides: Record<string, string | null>
): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === "") next.delete(k);
    else next.set(k, v);
  }
  const s = next.toString();
  return s ? `?${s}` : "";
}

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Account");

  const sp = await searchParams;
  const typeRaw = asOne(sp.type);
  const statusRaw = asOne(sp.status);
  const from = asOne(sp.from);
  const to = asOne(sp.to);
  const q = asOne(sp.q).trim();
  const pageRaw = parseInt(asOne(sp.page) || "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const filterType: Type | null = isType(typeRaw) ? typeRaw : null;
  const filterStatus: Status | null = isStatus(statusRaw) ? statusRaw : null;

  const { supabase } = await requireUser();

  let query = supabase
    .from("search_requests")
    .select(
      "id, type, topic, status, created_at, result_pdf_url, progress_pct, error_message",
      { count: "exact" }
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (filterType) query = query.eq("type", filterType);
  if (filterStatus) query = query.eq("status", filterStatus);
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59Z`);
  if (q) query = query.ilike("topic", `%${q}%`);

  const { data, error, count } = await query;
  const rows = (data ?? []) as Row[];

  const totalRows = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const hasAnyFilter = Boolean(filterType || filterStatus || from || to || q);

  // current URL params for pagination links (page param is replaced)
  const currentParams = new URLSearchParams();
  if (filterType) currentParams.set("type", filterType);
  if (filterStatus) currentParams.set("status", filterStatus);
  if (from) currentParams.set("from", from);
  if (to) currentParams.set("to", to);
  if (q) currentParams.set("q", q);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("history.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("history.subtitle")}</p>
      </header>

      {/* Filters form — all GET, server re-renders on submit */}
      <form
        method="GET"
        className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="block text-xs font-medium text-slate-600">
          {t("history.filterType")}
          <select
            name="type"
            defaultValue={filterType ?? ""}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
          >
            <option value="">{t("history.filterAll")}</option>
            {KNOWN_TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {t(`type.${tp}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">
          {t("history.filterStatus")}
          <select
            name="status"
            defaultValue={filterStatus ?? ""}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
          >
            <option value="">{t("history.filterAll")}</option>
            {KNOWN_STATUSES.map((st) => (
              <option key={st} value={st}>
                {t(`status.${st}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">
          {t("history.filterFrom")}
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          {t("history.filterTo")}
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          {t("history.filterSearch")}
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder={t("history.filterSearchPlaceholder")}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
          />
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            {t("history.applyFilters")}
          </button>
          {hasAnyFilter && (
            <Link
              href="/account/history"
              className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              {t("history.resetFilters")}
            </Link>
          )}
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {t("history.loadError")}
        </div>
      )}

      {/* Table OR empty state */}
      {!error && rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-700">
            {hasAnyFilter ? t("history.emptyFiltered") : t("history.empty")}
          </p>
          <div className="mt-4">
            {hasAnyFilter ? (
              <Link
                href="/account/history"
                className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                {t("history.resetFilters")}
              </Link>
            ) : (
              <Link
                href="/search"
                className="inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                {t("history.ctaFirstSearch")}
              </Link>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t("history.colType")}</th>
                  <th className="px-4 py-3">{t("history.colTopic")}</th>
                  <th className="px-4 py-3">{t("history.colDate")}</th>
                  <th className="px-4 py-3">{t("history.colStatus")}</th>
                  <th className="px-4 py-3 text-right">{t("history.colActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const open = reportHref(r);
                  const canCancel =
                    r.status === "pending" || r.status === "in_progress";
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLOR[r.type]}`}
                        >
                          {t(`type.${r.type}`)}
                        </span>
                      </td>
                      <td className="max-w-md px-4 py-3 text-slate-800" title={r.topic}>
                        <span className="line-clamp-2">{r.topic}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatDate(r.created_at, locale)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status]}`}
                        >
                          {t(`status.${r.status}`)}
                          {r.status === "in_progress" && typeof r.progress_pct === "number" && r.progress_pct > 0
                            ? ` · ${r.progress_pct}%`
                            : ""}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-2 text-xs">
                          {open && (
                            <Link
                              href={open}
                              className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-100"
                            >
                              {t("history.actionOpen")}
                            </Link>
                          )}
                          {r.status === "completed" && r.result_pdf_url && (
                            <a
                              href={r.result_pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-100"
                            >
                              {t("history.actionPdf")}
                            </a>
                          )}
                          {canCancel && (
                            <form action={cancelRequest}>
                              <input type="hidden" name="id" value={r.id} />
                              <button
                                type="submit"
                                className="rounded-md border border-rose-200 px-2 py-1 font-medium text-rose-700 hover:bg-rose-50"
                              >
                                {t("history.actionCancel")}
                              </button>
                            </form>
                          )}
                          <form action={softDeleteRequest}>
                            <input type="hidden" name="id" value={r.id} />
                            <button
                              type="submit"
                              className="rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-500 hover:bg-slate-100"
                              title={t("history.actionDeleteTitle")}
                            >
                              {t("history.actionDelete")}
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <nav className="flex items-center justify-between text-sm text-slate-600">
              <span>
                {t("history.pageOf", { page, total: totalPages })}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`/account/history${buildQuery(currentParams, { page: String(page - 1) })}`}
                    className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    ← {t("history.prev")}
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/account/history${buildQuery(currentParams, { page: String(page + 1) })}`}
                    className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {t("history.next")} →
                  </Link>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
