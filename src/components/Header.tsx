"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { routing } from "@/i18n/routing";
import { createSupabaseBrowser } from "@/lib/supabase-browser";

export function Header() {
  const tc = useTranslations("Common");
  const ta = useTranslations("Auth.header");
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const currentLocale = params.locale;

  const [email, setEmail] = useState<string | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowser();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setEmail(data.user?.email ?? null);
      setAuthLoaded(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setEmail(session?.user?.email ?? null);
      setAuthLoaded(true);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    const supabase = createSupabaseBrowser();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <Link
          href="/"
          className="text-lg font-bold tracking-tight text-slate-900 hover:text-slate-700"
        >
          {tc("appName")}
        </Link>
        <div className="flex items-center gap-4">
          {authLoaded && email ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden max-w-[180px] truncate text-slate-600 sm:inline">
                {email}
              </span>
              <button
                type="button"
                onClick={onSignOut}
                disabled={signingOut}
                className="rounded-md border border-slate-300 px-3 py-1 font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ta("logout")}
              </button>
            </div>
          ) : authLoaded ? (
            <Link
              href="/login"
              className="rounded-md bg-slate-900 px-3 py-1 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              {ta("login")}
            </Link>
          ) : (
            <span className="h-6 w-16" />
          )}
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
      </div>
    </header>
  );
}
