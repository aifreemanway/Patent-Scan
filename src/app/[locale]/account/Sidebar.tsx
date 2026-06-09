"use client";

// Account-section sidebar nav: 4 links + plan badge + email. Active link is
// detected from the current pathname (locale prefix stripped, since next-intl
// usePathname() returns locale-less paths).
//
// Sign-out is handled by the global <Header />; this sidebar is purely
// in-account navigation.

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

type Tier = "free" | "starter" | "team" | "enterprise";

const TIER_BADGE_COLOR: Record<Tier, string> = {
  free: "bg-slate-100 text-slate-700",
  starter: "bg-sky-100 text-sky-800",
  team: "bg-blue-100 text-blue-900",
  enterprise: "bg-slate-900 text-white",
};

export function Sidebar({
  email,
  tier,
}: {
  email: string;
  tier: Tier;
}) {
  const t = useTranslations("Account.Sidebar");
  const tt = useTranslations("Account.tier");
  const pathname = usePathname();

  const items = [
    { href: "/account", label: t("overview") },
    { href: "/account/history", label: t("history") },
    { href: "/account/billing", label: t("billing") },
    { href: "/account/profile", label: t("profile") },
  ] as const;

  return (
    <aside className="w-full shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-6 lg:w-64 lg:border-b-0 lg:border-r lg:py-8">
      <div className="mb-6 break-words text-sm text-slate-600">
        {email}
      </div>
      <div className="mb-8">
        <span
          className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${TIER_BADGE_COLOR[tier]}`}
        >
          {tt(tier)}
        </span>
      </div>
      <nav className="space-y-1">
        {items.map((it) => {
          const isActive =
            it.href === "/account"
              ? pathname === "/account"
              : pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`block rounded-md px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-200/60"
              }`}
            >
              {it.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-8 border-t border-slate-200 pt-6">
        <Link
          href="/new-search"
          className="block rounded-md bg-blue-600 px-3 py-2 text-center text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          {t("newSearch")}
        </Link>
      </div>
    </aside>
  );
}
