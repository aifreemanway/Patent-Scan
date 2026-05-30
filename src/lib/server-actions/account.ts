"use server";

// Server actions powering the /account/* surface. Each one re-checks auth
// (server actions are POST endpoints — never trust the calling component to
// have done it) and runs through the user-scoped Supabase client so RLS is the
// last line of defence even if the action is invoked from a forged form.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase-server";

// ── Profile fields editable from /account/profile ─────────────
// All optional and treated as "no change" if absent from the form; explicit
// empty string is allowed and stored as NULL (lets the user clear a field).

const PROFILE_FIELDS = [
  "full_name",
  "organization",
  "position",
  "phone",
] as const;

const MAX_PROFILE_FIELD_LEN: Record<(typeof PROFILE_FIELDS)[number], number> = {
  full_name: 100,
  organization: 200,
  position: 100,
  phone: 40,
};

// All server actions return Promise<void> so they bind cleanly to <form action>.
// On failure we log server-side and let the user see the same page (or the
// redirect target); follow-up toast/UX feedback can hook into a separate
// useFormState wrapper in a later PR.

export async function updateProfile(formData: FormData): Promise<void> {
  let user, supabase;
  try {
    ({ user, supabase } = await requireUser());
  } catch {
    console.error("[account/updateProfile] not authenticated");
    return;
  }

  const patch: Record<string, string | boolean | null> = {};

  for (const field of PROFILE_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue; // field omitted entirely — leave unchanged
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length > MAX_PROFILE_FIELD_LEN[field]) {
      console.error("[account/updateProfile] validation: too long", { field });
      return;
    }
    patch[field] = trimmed === "" ? null : trimmed;
  }

  if (formData.get("industrial_usage_enabled_present") === "1") {
    patch["industrial_usage_enabled"] =
      formData.get("industrial_usage_enabled") === "on";
  }
  if (formData.get("email_notifications_ready_present") === "1") {
    patch["email_notifications_ready"] =
      formData.get("email_notifications_ready") === "on";
  }

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) {
    console.error("[account/updateProfile] db error", { message: error.message });
    return;
  }

  revalidatePath("/account/profile");
  revalidatePath("/account");
}

// ── Cancel a pending/in-progress request ──────────────────────

export async function cancelRequest(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;

  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch {
    console.error("[account/cancelRequest] not authenticated");
    return;
  }

  const { error } = await supabase.rpc("cancel_search_request", {
    p_request_id: id,
  });
  if (error) {
    console.error("[account/cancelRequest] rpc error", { id, message: error.message });
  }

  revalidatePath("/account/history");
  revalidatePath("/account");
}

// ── Soft-delete a request from history (30-day grace) ─────────

export async function softDeleteRequest(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;

  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch {
    console.error("[account/softDeleteRequest] not authenticated");
    return;
  }

  const { error } = await supabase.rpc("soft_delete_search_request", {
    p_request_id: id,
  });
  if (error) {
    console.error("[account/softDeleteRequest] rpc error", {
      id,
      message: error.message,
    });
  }

  revalidatePath("/account/history");
}

// ── Delete account (soft, 30-day grace) ───────────────────────
// The user types their email as confirmation in the modal; we re-validate it
// server-side before stamping account_deleted_at + signing out + redirecting.
// On email mismatch we redirect back to /account/profile with a query flag so
// the page can render a server-rendered error message in a follow-up PR.

export async function deleteAccount(formData: FormData): Promise<void> {
  const confirmation = formData.get("email_confirmation");

  let user, supabase;
  try {
    ({ user, supabase } = await requireUser());
  } catch {
    console.error("[account/deleteAccount] not authenticated");
    redirect("/login");
  }

  if (typeof confirmation !== "string" || confirmation.trim() !== user.email) {
    redirect("/account/profile?delete_error=email_mismatch");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ account_deleted_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    console.error("[account/deleteAccount] db error", { message: error.message });
    redirect("/account/profile?delete_error=db");
  }

  await supabase.auth.signOut();
  redirect("/login?account_deleted=1");
}
