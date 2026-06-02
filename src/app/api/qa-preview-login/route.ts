// QA preview auto-login — lets a tester authenticate on a Vercel PREVIEW
// deployment with one click, without Turnstile / magic-link email / the
// Supabase redirect allow-list (none of which cover the dynamic per-PR preview
// domains, so the normal login flow dead-ends on previews).
//
// ⚠ AUTH BYPASS — hard-gated so it is INERT everywhere except Vercel previews:
//   • Active ONLY when VERCEL_ENV === "preview". On the VPS prod box VERCEL_ENV
//     is undefined, on Vercel production it is "production", in local dev it is
//     undefined → every one of those returns 404 (route does not exist).
//   • Mints a session ONLY for a fixed allow-list of qa-*@patent-scan.ru test
//     accounts — never an arbitrary email. The preview shares the prod Supabase
//     project, so the blast radius is capped at throwaway test-tier accounts.
//
// Usage (on a preview):  /api/qa-preview-login?email=qa-team@patent-scan.ru
//                        (email optional, defaults to qa-team@patent-scan.ru)

import { NextResponse } from "next/server";
import { createSupabaseAdmin, createSupabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

// Throwaway test accounts only. The preview hits the SAME Supabase project as
// prod, so we must never let this mint a session for a real user's email.
const QA_ACCOUNTS = new Set([
  "qa-free@patent-scan.ru",
  "qa-starter@patent-scan.ru",
  "qa-team@patent-scan.ru",
  "qa-enterprise@patent-scan.ru",
]);
const DEFAULT_QA = "qa-team@patent-scan.ru";

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

export async function GET(req: Request) {
  // Hard gate: only ever runs on a Vercel preview deployment.
  if (process.env.VERCEL_ENV !== "preview") return notFound();

  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || DEFAULT_QA).trim().toLowerCase();
  if (!QA_ACCOUNTS.has(email)) {
    return NextResponse.json(
      { error: "email_not_allowed", allowed: [...QA_ACCOUNTS] },
      { status: 403 }
    );
  }

  // 1. Mint a one-time token for the test account (service-role, no email sent).
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    console.error("[qa-preview-login] generateLink failed:", error?.message);
    return NextResponse.json(
      { error: "generate_link_failed", detail: error?.message ?? "no token" },
      { status: 500 }
    );
  }

  // 2. Exchange it on the cookie-writing SSR client so the session lands as
  //    same-origin cookies on THIS preview domain.
  const supabase = await createSupabaseServer();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) {
    console.error("[qa-preview-login] verifyOtp failed:", verifyError.message);
    return NextResponse.json(
      { error: "verify_failed", detail: verifyError.message },
      { status: 500 }
    );
  }

  // 3. Land in the cabinet, authenticated. Cookies set above ride along.
  return NextResponse.redirect(new URL("/account", url.origin));
}
