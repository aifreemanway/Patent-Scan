// /admin/costs — LLM cost detail (§4): total + per-model + per-stage for the
// current month. Per-user cost lives on the users list / drill. Exact totals
// come from the admin_cost_summary RPC (Postgres-side aggregation).

import { setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/lib/admin";
import { getCostSummary, monthStart } from "@/lib/admin-data";
import { Card, StatTile, formatRub, PendingMigrationNote } from "../ui";

export const dynamic = "force-dynamic";

export default async function AdminCostsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage();

  const cost = await getCostSummary(monthStart());
  const byModel = Object.entries(cost.byModel).sort((a, b) => b[1] - a[1]);
  const byLabel = Object.entries(cost.byLabel).sort((a, b) => b[1] - a[1]);

  const period = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(monthStart());

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Косты LLM
      </h1>
      <p className="text-sm text-slate-500">
        Период: {period} (с 1-го числа). Реальные ₽ из cost-телеметрии; модель без
        подтверждённой цены даёт пустой ₽ (anti-fab). Внутреннее — клиенту не
        показывается.
      </p>

      {cost.pending ? (
        <Card>
          <PendingMigrationNote />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="ИТОГО за месяц" value={formatRub(cost.totalRub)} />
            <StatTile label="LLM-вызовов" value={cost.eventCount} />
            <StatTile
              label="Средний ₽/вызов"
              value={
                cost.eventCount > 0
                  ? formatRub(cost.totalRub / cost.eventCount)
                  : "—"
              }
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card title="По моделям">
              {byModel.length === 0 ? (
                <p className="text-sm text-slate-400">Нет вызовов.</p>
              ) : (
                <ul className="space-y-1.5">
                  {byModel.map(([model, rub]) => (
                    <li key={model} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-xs text-slate-600">{model}</span>
                      <span className="font-semibold text-slate-900">{formatRub(rub)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="По стадиям">
              {byLabel.length === 0 ? (
                <p className="text-sm text-slate-400">Нет вызовов.</p>
              ) : (
                <ul className="space-y-1.5">
                  {byLabel.map(([label, rub]) => (
                    <li key={label} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-xs text-slate-600">{label}</span>
                      <span className="font-semibold text-slate-900">{formatRub(rub)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
