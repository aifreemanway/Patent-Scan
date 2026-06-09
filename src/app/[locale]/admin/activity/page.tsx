// /admin/activity — recent activity feed (§3.2): search_requests across all
// users, newest first, joined to user email.

import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdminPage } from "@/lib/admin";
import { getActivity } from "@/lib/admin-data";
import { Card, TypeBadge, StatusBadge, formatDateTime } from "../ui";

export const dynamic = "force-dynamic";

export default async function AdminActivityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage();

  const { rows } = await getActivity(200);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Активность <span className="text-slate-400">(последние {rows.length})</span>
      </h1>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2">Тема</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2">Пользователь</th>
                <th className="px-3 py-2">Дата</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    Нет активности.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <TypeBadge type={r.type} />
                  </td>
                  <td className="max-w-sm truncate px-3 py-2 text-slate-700">
                    {r.topic ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2">
                    {r.user_id ? (
                      <Link
                        href={`/admin/users/${r.user_id}`}
                        className="text-blue-700 hover:underline"
                      >
                        {r.email ?? r.user_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {formatDateTime(r.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
