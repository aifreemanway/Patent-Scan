// /admin/users/[id] — per-user drill (§3.5): profile + quotas + requests +
// attributed cost. READ-ONLY in Phase 1 — write-actions (tier switch / invoice
// activation, §5) are Phase 2 (deferred until billing-0010 + a real invoice).

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/lib/admin";
import { getUserDetail } from "@/lib/admin-data";
import {
  Card,
  TierBadge,
  TypeBadge,
  StatusBadge,
  formatRub,
  formatDate,
  formatDateTime,
} from "../../ui";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-900">{value || "—"}</span>
    </div>
  );
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdminPage();

  const { profile, requests, quotas, costRub, costPending } =
    await getUserDetail(id);
  if (!profile) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {profile.email}
        </h1>
        <TierBadge tier={profile.tier} />
        {profile.account_deleted_at && (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
            помечен на удаление
          </span>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Профиль">
          <Field label="ID" value={<span className="font-mono text-xs">{profile.id}</span>} />
          <Field label="ФИО" value={profile.full_name} />
          <Field label="Организация" value={profile.organization} />
          <Field label="Должность" value={profile.position} />
          <Field label="Телефон" value={profile.phone} />
          <Field label="Регистрация" value={formatDate(profile.created_at)} />
          <Field
            label="Тариф истекает"
            value={profile.tier_expires_at ? formatDate(profile.tier_expires_at) : "—"}
          />
          <Field
            label="Промышленное применение"
            value={profile.industrial_usage_enabled === false ? "выключено" : "включено"}
          />
          <Field
            label="Косты LLM / мес"
            value={costPending ? "— (миграция 0011)" : formatRub(costRub)}
          />
        </Card>

        <Card title="Квоты (текущий месяц)">
          <ul className="space-y-2">
            {quotas.map((q) => {
              const pct =
                q.limit && q.limit > 0
                  ? Math.min(100, Math.round((q.used / q.limit) * 100))
                  : 0;
              const exceeded = q.limit !== null && q.used >= q.limit;
              return (
                <li key={q.operation}>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700">
                      {q.operation === "search" ? "Поиск" : "Ландшафт"}
                    </span>
                    <span className={`font-mono ${exceeded ? "text-rose-700" : "text-slate-600"}`}>
                      {q.used} / {q.limit ?? "∞"}
                    </span>
                  </div>
                  {q.limit !== null && (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${exceeded ? "bg-rose-400" : "bg-blue-400"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card title={`Запросы (${requests.length})`}>
        {requests.length === 0 ? (
          <p className="text-sm text-slate-400">Нет запросов.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Тип</th>
                  <th className="px-2 py-2">Тема</th>
                  <th className="px-2 py-2">Статус</th>
                  <th className="px-2 py-2">Дата</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-2">
                      <TypeBadge type={r.type} />
                    </td>
                    <td className="max-w-md truncate px-2 py-2 text-slate-700">
                      {r.topic ?? "—"}
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-2 py-2 text-slate-500">
                      {formatDateTime(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Действия">
        <p className="text-sm text-slate-500">
          Смена тарифа и активация по счёту (Фаза 2) — пока вручную через Supabase
          по согласованию. Денежные write-действия включатся после мёрджа
          биллинг-миграции 0010 и появления реального счёта (ТЗ §0.1 / §5).
        </p>
      </Card>
    </div>
  );
}
