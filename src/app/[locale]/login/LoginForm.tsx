"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type Status = "idle" | "submitting" | "success" | "error";

// Narrow typing for the subset of the Cloudflare Turnstile JS API we use.
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

const KNOWN_ERROR_CODES = [
  "invalid_format",
  "disposable_email",
  "no_mx_record",
  "captcha_missing",
  "captcha_failed",
  "otp_send_failed",
  "rate_limited",
] as const;
type ErrorCode = (typeof KNOWN_ERROR_CODES)[number];

function isKnownErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === "string" &&
    (KNOWN_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function LoginForm({
  locale,
  siteKey,
}: {
  locale: string;
  siteKey: string;
}) {
  const t = useTranslations("Auth.login");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorCode, setErrorCode] = useState<ErrorCode | "generic" | null>(null);
  const [consentError, setConsentError] = useState(false);
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const rendered = useRef(false);

  // Render Turnstile once the script is loaded. The Script component below
  // calls this via `onReady`, and we also attempt on mount in case it was
  // already cached.
  function renderWidget() {
    if (rendered.current) return;
    if (!widgetRef.current) return;
    if (!siteKey) return;
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
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
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

      // Reset Turnstile so the user gets a fresh token on retry.
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
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("successTitle")}
        </h1>
        <p className="mt-3 text-slate-600">
          {t("successBody", { email })}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={renderWidget}
      />
      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("title")}
        </h1>
        <p className="mt-2 text-sm text-slate-600">{t("subtitle")}</p>

        <label
          htmlFor="email"
          className="mt-6 block text-sm font-medium text-slate-900"
        >
          {t("emailLabel")}
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        />

        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (e.target.checked) setConsentError(false);
            }}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
          />
          <span>{t("consent")}</span>
        </label>
        {consentError && (
          <p className="mt-1 text-xs text-red-600">{t("consentRequired")}</p>
        )}

        <div className="mt-5 min-h-[70px]" ref={widgetRef} />
        {!siteKey && (
          <p className="text-xs text-amber-600">
            Turnstile site key is missing — login is disabled.
          </p>
        )}

        {errorCode && (
          <p className="mt-3 text-sm text-red-600">
            {t(`errors.${errorCode}`)}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "submitting" || !token}
          className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {status === "submitting" ? t("submitting") : t("submit")}
        </button>
      </form>
    </div>
  );
}
