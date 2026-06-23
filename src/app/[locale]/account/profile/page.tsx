// /account/profile — contact fields + report settings + delete account.
// Forms submit to the server-actions module (updateProfile / deleteAccount).
// Each form has a hidden marker (`*_present=1`) for the two toggles so an
// unchecked box doesn't get confused with «field absent» in the FormData.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/supabase-server";
import {
  updateProfile,
  updateMarketingConsent,
  deleteAccount,
} from "@/lib/server-actions/account";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Account");

  const { user, supabase } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "tier, full_name, organization, position, phone, industrial_usage_enabled, email_notifications_ready, marketing_consent_at"
    )
    .eq("id", user.id)
    .single();

  // Industrial Usage доступен на всех тарифах (решение Vsevolod 2026-06-09).
  const canUseIndustrial = true;

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("profile.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("profile.subtitle")}</p>
      </header>

      {/* Contact + settings — one combined form */}
      <form action={updateProfile} className="space-y-8 rounded-2xl border border-slate-200 bg-white p-6">
        <section className="space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-slate-500">
            {t("profile.contactSection")}
          </h2>
          <Field
            id="full_name"
            label={t("profile.fullName")}
            helper={t("profile.fullNameHelper")}
            defaultValue={profile?.full_name ?? ""}
            maxLength={100}
          />
          <Field
            id="organization"
            label={t("profile.organization")}
            helper={t("profile.organizationHelper")}
            defaultValue={profile?.organization ?? ""}
            maxLength={200}
          />
          <Field
            id="position"
            label={t("profile.position")}
            helper={t("profile.positionHelper")}
            defaultValue={profile?.position ?? ""}
            maxLength={100}
          />
          <Field
            id="phone"
            label={t("profile.phone")}
            helper={t("profile.phoneHelper")}
            defaultValue={profile?.phone ?? ""}
            maxLength={40}
          />
          <div>
            <label className="block text-sm font-medium text-slate-900">
              {t("profile.email")}
            </label>
            <input
              type="email"
              value={user.email ?? ""}
              readOnly
              className="mt-1 block w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600"
            />
            <p className="mt-1 text-xs text-slate-500">
              {t("profile.emailHelper")}
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-slate-500">
            {t("profile.settingsSection")}
          </h2>

          <Toggle
            name="industrial_usage_enabled"
            disabled={!canUseIndustrial}
            defaultChecked={
              canUseIndustrial && (profile?.industrial_usage_enabled ?? true)
            }
            title={t("profile.industrialTitle")}
            body={t("profile.industrialBody")}
            availability={
              canUseIndustrial
                ? t("profile.industrialAvailable")
                : t("profile.industrialUpsell")
            }
          />

          <Toggle
            name="email_notifications_ready"
            defaultChecked={profile?.email_notifications_ready ?? true}
            title={t("profile.emailReadyTitle")}
            body={t("profile.emailReadyBody")}
            availability={t("profile.emailReadyNote")}
          />
        </section>

        <button
          type="submit"
          className="rounded-md bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          {t("profile.save")}
        </button>
      </form>

      {/* Marketing consent — separate form: toggling it appends to the immutable
          consent log + stamps unsubscribe (spec §4), distinct from profile edits. */}
      <form
        action={updateMarketingConsent}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
      >
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-500">
          {t("profile.marketingSection")}
        </h2>
        <Toggle
          name="marketing_consent"
          defaultChecked={Boolean(profile?.marketing_consent_at)}
          title={t("profile.marketingTitle")}
          body={t("profile.marketingBody")}
          availability={t("profile.marketingNote")}
        />
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          {t("profile.save")}
        </button>
      </form>

      {/* Security */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-500">
          {t("profile.securitySection")}
        </h2>
        <p className="mt-4 text-sm text-slate-600">
          {t("profile.passwordlessNote")}
        </p>
        <DeleteAccountForm
          confirmLabel={t("profile.deleteConfirmLabel", { email: user.email ?? "" })}
          email={user.email ?? ""}
          ctaLabel={t("profile.deleteAccount")}
          warningTitle={t("profile.deleteWarningTitle")}
          warningBody={t("profile.deleteWarningBody")}
          submitLabel={t("profile.deleteSubmit")}
        />
      </section>
    </div>
  );
}

function Field({
  id,
  label,
  helper,
  defaultValue,
  maxLength,
}: {
  id: string;
  label: string;
  helper: string;
  defaultValue: string;
  maxLength: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-900">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        defaultValue={defaultValue}
        maxLength={maxLength}
        className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
      />
      <p className="mt-1 text-xs text-slate-500">{helper}</p>
    </div>
  );
}

function Toggle({
  name,
  title,
  body,
  availability,
  defaultChecked,
  disabled,
}: {
  name: string;
  title: string;
  body: string;
  availability: string;
  defaultChecked: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 disabled:opacity-50"
        />
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-1 text-sm text-slate-600">{body}</p>
          <p className="mt-2 text-xs text-slate-500">{availability}</p>
        </div>
      </label>
      {/* Presence marker — without it an unchecked toggle would be indistinguishable
          from a missing field in the FormData. */}
      <input type="hidden" name={`${name}_present`} value="1" />
    </div>
  );
}

function DeleteAccountForm({
  email,
  confirmLabel,
  ctaLabel,
  warningTitle,
  warningBody,
  submitLabel,
}: {
  email: string;
  confirmLabel: string;
  ctaLabel: string;
  warningTitle: string;
  warningBody: string;
  submitLabel: string;
}) {
  return (
    <details className="mt-6">
      <summary className="cursor-pointer rounded-md border border-rose-200 bg-rose-50/50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50">
        {ctaLabel}
      </summary>
      <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/40 p-5">
        <p className="text-sm font-semibold text-rose-900">{warningTitle}</p>
        <p className="mt-2 whitespace-pre-line text-sm text-rose-800">
          {warningBody}
        </p>
        <form action={deleteAccount} className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-rose-900">
            {confirmLabel}
            <input
              type="email"
              name="email_confirmation"
              required
              placeholder={email}
              autoComplete="off"
              className="mt-1 block w-full rounded-lg border border-rose-300 px-3 py-2 text-slate-900 focus:border-rose-600 focus:outline-none focus:ring-1 focus:ring-rose-600"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
          >
            {submitLabel}
          </button>
        </form>
      </div>
    </details>
  );
}
