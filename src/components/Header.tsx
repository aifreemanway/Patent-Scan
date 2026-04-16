"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { routing } from "@/i18n/routing";

export function Header() {
  const tc = useTranslations("Common");
  const pathname = usePathname();
  const params = useParams<{ locale: string }>();
  const currentLocale = params.locale;

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="text-lg font-bold tracking-tight text-slate-900 hover:text-slate-700"
        >
          {tc("appName")}
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {routing.locales.map((loc) => (
            <Link
              key={loc}
              href={pathname}
              locale={loc}
              className={`rounded-md px-2 py-1 font-medium transition ${
                loc === currentLocale
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {loc.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
