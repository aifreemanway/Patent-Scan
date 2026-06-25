// /admin/actions — audit journal (§6). Read-only. Empty in Phase 1 (no
// write-actions yet); the table exists as a scaffold so Phase 2 (tier switch /
// invoice activation) writes here with no further migration.

import { setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/lib/admin";
import { getAdminActions } from "@/lib/admin-data";
import { Card, formatDateTime, PendingMigrationNote } from "../ui";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  tier_switch: "Смена тарифа",
  invoice_activation: "Активация по счёту",
  subscription_deactivation: "Деактивация подписки",
  grant_credit: "Выдача кредитов",
};

export default async function AdminActionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage();

  const { rows, pending } = await getAdminActions(200);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Журнал действий
      </h1>
      <p className="text-sm text-slate-500">
        Аудит всех write-действий админа (кто · кого · что · когда). Заполняется
        в Фазе 2 — сейчас панель только для чтения.
      </p>

      <Card>
        {pending ? (
          <PendingMigrationNote />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400">
            Действий пока нет (write-операции — Фаза 2).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Когда</th>
                  <th className="px-3 py-2">Админ</th>
                  <th className="px-3 py-2">Действие</th>
                  <th className="px-3 py-2">Цель</th>
                  <th className="px-3 py-2">Детали</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 text-slate-500">
                      {formatDateTime(a.created_at)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{a.admin_email}</td>
                    <td className="px-3 py-2 text-slate-900">
                      {ACTION_LABEL[a.action] ?? a.action}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">
                      {a.target_user_id?.slice(0, 8) ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-xs text-slate-600">
                        {JSON.stringify(a.payload)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
