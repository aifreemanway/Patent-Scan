// /admin — dashboard: aggregate metrics (§3.4) + LLM cost summary (§4).

import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/lib/admin";
import { getMetrics, getCostSummary, monthStart } from "@/lib/admin-data";
import {
  Card,
  StatTile,
  TypeBadge,
  StatusBadge,
  TierBadge,
  formatRub,
  PendingMigrationNote,
  CappedNote,
} from "./ui";

export const dynamic = "force-dynamic";

function Breakdown({
  rows,
  renderKey,
}: {
  rows: [string, number][];
  renderKey?: (k: string) => ReactNode;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">Нет данных.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map(([k, v]) => (
        <li key={k} className="flex items-center justify-between text-sm">
          <span>{renderKey ? renderKey(k) : k}</span>
          <span className="font-mono text-slate-700">{v}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage();

  const [metrics, cost] = await Promise.all([
    getMetrics(),
    getCostSummary(monthStart()),
  ]);

  const maxReg = Math.max(1, ...metrics.recentRegistrations.map((r) => r.count));
  const costByLabel = Object.entries(cost.byLabel).sort((a, b) => b[1] - a[1]);
  const costByModel = Object.entries(cost.byModel).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Дашборд
      </h1>

      {/* Metrics tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Пользователей" value={metrics.totalUsers} />
        <StatTile
          label="Запросов (всего в выборке)"
          value={Object.values(metrics.byType).reduce((a, b) => a + b, 0)}
        />
        <StatTile
          label="Косты LLM за месяц"
          value={cost.pending ? "—" : formatRub(cost.totalRub)}
        />
        <StatTile
          label="LLM-вызовов за месяц"
          value={cost.pending ? "—" : cost.eventCount}
        />
      </div>
      {metrics.capped && <CappedNote />}

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Пользователи по тарифам">
          <Breakdown
            rows={Object.entries(metrics.byTier).sort((a, b) => b[1] - a[1])}
            renderKey={(k) => <TierBadge tier={k} />}
          />
        </Card>

        <Card title="Запросы по типам">
          <Breakdown
            rows={Object.entries(metrics.byType).sort((a, b) => b[1] - a[1])}
            renderKey={(k) => <TypeBadge type={k} />}
          />
        </Card>

        <Card title="Запросы по статусам">
          <Breakdown
            rows={Object.entries(metrics.byStatus).sort((a, b) => b[1] - a[1])}
            renderKey={(k) => <StatusBadge status={k} />}
          />
        </Card>

        <Card title="Косты LLM за месяц — по моделям">
          {cost.pending ? (
            <PendingMigrationNote />
          ) : costByModel.length === 0 ? (
            <p className="text-sm text-slate-400">Пока нет LLM-вызовов в этом месяце.</p>
          ) : (
            <ul className="space-y-1.5">
              {costByModel.map(([model, rub]) => (
                <li
                  key={model}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="font-mono text-xs text-slate-600">{model}</span>
                  <span className="font-semibold text-slate-900">
                    {formatRub(rub)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Косты LLM за месяц — по стадиям">
        {cost.pending ? (
          <PendingMigrationNote />
        ) : costByLabel.length === 0 ? (
          <p className="text-sm text-slate-400">Пока нет LLM-вызовов в этом месяце.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {costByLabel.map(([label, rub]) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-1.5 text-sm"
              >
                <span className="font-mono text-xs text-slate-600">{label}</span>
                <span className="font-semibold text-slate-900">{formatRub(rub)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Регистрации за 14 дней">
        <div className="flex items-end gap-1" style={{ height: 80 }}>
          {metrics.recentRegistrations.map((r) => (
            <div key={r.date} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-blue-400"
                style={{ height: `${(r.count / maxReg) * 64}px` }}
                title={`${r.date}: ${r.count}`}
              />
              <span className="text-[9px] text-slate-400">
                {r.date.slice(8, 10)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
