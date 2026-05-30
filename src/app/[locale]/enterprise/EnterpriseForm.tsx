"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Status = "idle" | "submitting" | "success" | "error";

type TurnstileApi = {
  render: (
    selector: string | HTMLElement,
    opts: {
      sitekey: string;
      callback?: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
    }
  ) => string;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const ERROR_CODES = [
  "invalid_format",
  "captcha_missing",
  "captcha_failed",
  "send_failed",
  "rate_limited",
] as const;
type ErrorCode = (typeof ERROR_CODES)[number];

function isKnownErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === "string" &&
    (ERROR_CODES as readonly string[]).includes(value)
  );
}

export function EnterpriseForm({
  locale,
  siteKey,
}: {
  locale: string;
  siteKey: string;
}) {
  const t = useTranslations("Enterprise.form");
  const [fullName, setFullName] = useState("");
  const [position, setPosition] = useState("");
  const [organization, setOrganization] = useState("");
  const [inn, setInn] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [topic, setTopic] = useState("");
  const [consent, setConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorCode, setErrorCode] = useState<ErrorCode | "generic" | null>(null);
  const [consentError, setConsentError] = useState(false);
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const rendered = useRef(false);

  function renderWidget() {
    if (rendered.current) return;
    if (!widgetRef.current || !siteKey) return;
    if (typeof window === "undefined" || !window.turnstile) return;
    widgetIdRef.current = window.turnstile.render(widgetRef.current, {
      sitekey: siteKey,
      callback: (tok: string) => setToken(tok),
      "error-callback": () => setToken(null),
      "expired-callback": () => setToken(null),
      theme: "light",
    });
    rendered.current = true;
  }

  useEffect(() => {
    renderWidget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting") return;

    setConsentError(false);
    if (!consent) {
      setConsentError(true);
      return;
    }

    setStatus("submitting");
    setErrorCode(null);

    try {
      const resp = await fetch("/api/enterprise/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          position,
          organization,
          inn: inn || undefined,
          email,
          phone: phone || undefined,
          topic,
          marketingConsent,
          turnstileToken: token,
          locale,
        }),
      });

      if (resp.ok) {
        setStatus("success");
        return;
      }

      if (resp.status === 429) {
        setErrorCode("rate_limited");
      } else {
        const data = (await resp.json().catch(() => null)) as
          | { error?: unknown }
          | null;
        setErrorCode(isKnownErrorCode(data?.error) ? data.error : "generic");
      }
      setStatus("error");

      if (widgetIdRef.current && typeof window !== "undefined" && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
      setToken(null);
    } catch {
      setErrorCode("generic");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h3 className="text-xl font-bold tracking-tight text-slate-900">
          {t("successTitle")}
        </h3>
        <p className="mt-3 text-slate-600">{t("successBody")}</p>
      </div>
    );
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={renderWidget}
      />
      <form
        onSubmit={onSubmit}
        className="space-y-5 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <Field
          id="fullName"
          label={t("fullNameLabel")}
          value={fullName}
          onChange={setFullName}
          required
          autoComplete="name"
        />
        <Field
          id="position"
          label={t("positionLabel")}
          value={position}
          onChange={setPosition}
          required
          autoComplete="organization-title"
        />
        <Field
          id="organization"
          label={t("organizationLabel")}
          value={organization}
          onChange={setOrganization}
          required
          autoComplete="organization"
        />
        <Field
          id="inn"
          label={t("innLabel")}
          value={inn}
          onChange={setInn}
          inputMode="numeric"
          pattern="[0-9]{10,12}"
          hint={t("innHint")}
        />
        <Field
          id="email"
          label={t("emailLabel")}
          value={email}
          onChange={setEmail}
          required
          type="email"
          autoComplete="email"
        />
        <Field
          id="phone"
          label={t("phoneLabel")}
          value={phone}
          onChange={setPhone}
          type="tel"
          autoComplete="tel"
          hint={t("phoneHint")}
        />

        <div>
          <label
            htmlFor="topic"
            className="block text-sm font-medium text-slate-900"
          >
            {t("topicLabel")}{" "}
            <span className="text-rose-600">*</span>
          </label>
          <textarea
            id="topic"
            required
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={5}
            placeholder={t("topicPlaceholder")}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
          <p className="mt-1 text-xs text-slate-500">{t("topicHint")}</p>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (e.target.checked) setConsentError(false);
            }}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
          />
          <span>
            {t.rich("consent", {
              terms: (chunks) => (
                <Link
                  href="/terms"
                  target="_blank"
                  className="underline hover:text-slate-900"
                >
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link
                  href="/privacy"
                  target="_blank"
                  className="underline hover:text-slate-900"
                >
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        {consentError && (
          <p className="text-xs text-rose-600">{t("consentRequired")}</p>
        )}

        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => setMarketingConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
          />
          <span>{t("marketingConsent")}</span>
        </label>

        <div className="min-h-[70px]" ref={widgetRef} />
        {!siteKey && (
          <p className="text-xs text-amber-600">
            Turnstile site key is missing — submission is disabled.
          </p>
        )}

        {errorCode && (
          <p className="text-sm text-rose-600">
            {t(`errors.${errorCode}` as Parameters<typeof t>[0])}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "submitting" || !token}
          className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {status === "submitting" ? t("submitting") : t("submit")}
        </button>
      </form>
    </>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  required,
  type = "text",
  autoComplete,
  inputMode,
  pattern,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "tel" | "email";
  pattern?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-900">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        pattern={pattern}
        className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
      />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
