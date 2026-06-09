// /admin layout — the admin gate + chrome.
//
// requireAdminPage() runs in the RSC layout chain on every request to this
// segment, so a non-admin (signed-out or not allowlisted) gets a silent
// notFound() that bubbles ABOVE this layout → no admin chrome is ever revealed
// (spec §1: «тихий 404»). Each page re-gates too (defense-in-depth: PII of all
// users flows through the service-role client).

import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdminPage } from "@/lib/admin";

export const dynamic = "force-dynamic"; // never static — always re-gate

const NAV: { href: string; label: string }[] = [
  { href: "/admin", label: "Дашборд" },
  { href: "/admin/users", label: "Пользователи" },
  { href: "/admin/activity", label: "Активность" },
  { href: "/admin/costs", label: "Косты LLM" },
  { href: "/admin/actions", label: "Журнал" },
];

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="text-sm font-bold tracking-tight text-slate-900">
            ПатентСкан · Админ
          </span>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <span className="ml-auto text-xs text-slate-400">{admin.email}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
