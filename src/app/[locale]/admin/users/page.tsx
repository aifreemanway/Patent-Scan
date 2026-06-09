// /admin/users — all users (§3.1): email · tier · reg · last activity ·
// #requests · attributed LLM cost (this month). Row → per-user drill.

import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdminPage } from "@/lib/admin";
import { listUsers } from "@/lib/admin-data";
import {
  Card,
  TierBadge,
  formatRub,
  formatDate,
  formatDateTime,
  CappedNote,
} from "../ui";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage();

  const { users, capped, costPending } = await listUsers();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Пользователи <span className="text-slate-400">({users.length})</span>
      </h1>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Тариф</th>
                <th className="px-3 py-2">Регистрация</th>
                <th className="px-3 py-2">Активность</th>
                <th className="px-3 py-2 text-right">Запросов</th>
                <th className="px-3 py-2 text-right">Косты / мес</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    Нет пользователей.
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {u.email}
                    </Link>
                    {u.organization && (
                      <div className="text-xs text-slate-400">{u.organization}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <TierBadge tier={u.tier} />
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {formatDate(u.created_at)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {formatDateTime(u.lastActivity)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {u.requestCount}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {costPending ? "—" : formatRub(u.costRub)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {capped && <CappedNote />}
        {costPending && (
          <p className="mt-2 text-xs text-amber-700">
            Косты — после применения миграции 0011.
          </p>
        )}
        <p className="mt-2 text-xs text-slate-400">
          «Косты / мес» — атрибутированные пользователю LLM-вызовы за текущий
          месяц (сейчас это разбор-вердикт; полная атрибуция fan-out — следующим
          шагом).
        </p>
      </Card>
    </div>
  );
}
