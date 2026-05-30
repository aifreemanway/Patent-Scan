// Server layout for /account/*. Resolves the user + profile once and renders
// the Sidebar; the inner pages just receive `children` and re-fetch only what
// they specifically need (history rows, quota status, etc).
//
// Unauthenticated visitors are bounced to /login with a return_to param so
// the post-login redirect lands them where they intended to go.

import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Header } from "@/components/Header";
import { Sidebar } from "./Sidebar";
import {
  requireUser,
  UnauthorizedError,
} from "@/lib/supabase-server";

type Tier = "free" | "starter" | "team" | "enterprise";

const KNOWN_TIERS: readonly Tier[] = ["free", "starter", "team", "enterprise"];

function normalizeTier(value: unknown): Tier {
  return typeof value === "string" && (KNOWN_TIERS as readonly string[]).includes(value)
    ? (value as Tier)
    : "free";
}

export default async function AccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  let user, supabase;
  try {
    ({ user, supabase } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      redirect(`/login?return_to=${encodeURIComponent("/account")}`);
    }
    throw e;
  }

  // Single profile read shared across all account pages (Next caches
  // identical fetches inside a single request — but Supabase queries are
  // not part of that cache, so each page that needs additional columns
  // re-queries explicitly).
  const { data: profile } = await supabase
    .from("profiles")
    .select("tier")
    .eq("id", user.id)
    .single();

  const tier = normalizeTier(profile?.tier);

  return (
    <>
      <Header />
      <div className="flex flex-1 flex-col lg:flex-row">
        <Sidebar email={user.email ?? ""} tier={tier} />
        <main className="flex-1 px-6 py-8 lg:px-10">{children}</main>
      </div>
    </>
  );
}
