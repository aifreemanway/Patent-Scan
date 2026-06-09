// Shared presentational helpers for the /admin panel. Server-component-safe
// (no hooks/client state). Internal tool → Russian strings are hardcoded here
// rather than routed through next-intl (spec §2: «i18n-обвязку не плодить»).
//
// NOT a route (no page/route/layout export) — just a module under the admin
// segment.

import type { ReactNode } from "react";

export const TYPE_LABEL: Record<string, string> = {
  novelty: "Поиск",
  landscape: "Ландшафт",
  deep_analysis: "Глубокий анализ",
  literature_review: "Скрининг / обзор",
};

export const STATUS_LABEL: Record<string, string> = {
  pending: "В очереди",
  in_progress: "В работе",
  completed: "Готово",
  error: "Ошибка",
  cancelled: "Отменён",
};

export const TIER_LABEL: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  team: "Team",
  team_plus: "Team Plus",
  enterprise: "Enterprise",
};

const TYPE_COLOR: Record<string, string> = {
  novelty: "bg-blue-100 text-blue-900",
  landscape: "bg-violet-100 text-violet-900",
  deep_analysis: "bg-amber-100 text-amber-900",
  literature_review: "bg-teal-100 text-teal-900",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  in_progress: "bg-sky-100 text-sky-800",
  completed: "bg-emerald-100 text-emerald-800",
  error: "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-100 text-slate-500",
};

const TIER_COLOR: Record<string, string> = {
  free: "bg-slate-100 text-slate-700",
  starter: "bg-indigo-100 text-indigo-900",
  team: "bg-blue-100 text-blue-900",
  team_plus: "bg-violet-100 text-violet-900",
  enterprise: "bg-amber-100 text-amber-900",
};

function Pill({ text, cls }: { text: string; cls: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {text}
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <Pill
      text={TYPE_LABEL[type] ?? type}
      cls={TYPE_COLOR[type] ?? "bg-slate-100 text-slate-700"}
    />
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Pill
      text={STATUS_LABEL[status] ?? status}
      cls={STATUS_COLOR[status] ?? "bg-slate-100 text-slate-700"}
    />
  );
}

export function TierBadge({ tier }: { tier: string }) {
  return (
    <Pill
      text={TIER_LABEL[tier] ?? tier}
      cls={TIER_COLOR[tier] ?? "bg-slate-100 text-slate-700"}
    />
  );
}

/** "₽123.45" with thin-space grouping, or "—" for null (anti-fab: no invented ₽). */
export function formatRub(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const rounded = Math.round(n * 100) / 100;
  return (
    "₽" +
    rounded.toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export function Card({
  title,
  children,
  right,
}: {
  title?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          {title && (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {title}
            </h2>
          )}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}

/** Yellow notice for the «migration 0011 not applied yet» state. */
export function PendingMigrationNote() {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      Данные костов появятся после применения миграции{" "}
      <code className="font-mono">0011_admin_cost_telemetry.sql</code> на
      прод-БД. Таблицы <code className="font-mono">llm_cost_events</code> /{" "}
      <code className="font-mono">admin_actions</code> ещё не созданы.
    </div>
  );
}

export function CappedNote() {
  return (
    <div className="mt-2 text-xs text-slate-400">
      Показаны последние 2000 записей (агрегаты приблизительны при большем
      объёме — позже переедет на SQL-агрегацию).
    </div>
  );
}
