"use client";

import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** Куда вернуть пользователя ПОСЛЕ магик-линка, по query лендинга/тарифов:
 *  - ?next=/... (явная цель, напр. /account/billing от тарифных CTA) — приоритет;
 *    если есть ?plan= и next ведёт в биллинг без plan — добавляем plan туда;
 *  - ?intent=landscape|screening (плитки «Заказать») → страница продукта;
 *  - ?plan=<id> (подписка) без next → биллинг с предвыбором тарифа.
 *  next протаскивается в emailRedirectTo (см. /api/auth/login) и читается
 *  серверным callback'ом — sessionStorage тут не подходит (callback серверный,
 *  и письмо могут открыть на другом устройстве). Возвращает path или undefined. */
function computePostLoginNext(params: URLSearchParams): string | undefined {
  const next = params.get("next");
  const plan = params.get("plan");
  const intent = params.get("intent");

  const isSafe = (p: string) => p.startsWith("/") && !p.startsWith("//");

  if (next && isSafe(next)) {
    if (plan && next.startsWith("/account/billing") && !next.includes("plan=")) {
      const sep = next.includes("?") ? "&" : "?";
      return `${next}${sep}plan=${encodeURIComponent(plan)}`;
    }
    return next;
  }
  if (intent === "landscape") return "/landscape";
  if (intent === "screening") return "/literature-review";
  if (plan) return `/account/billing?plan=${encodeURIComponent(plan)}`;
  return undefined;
}

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
  const searchParams = useSearchParams();
  const postLoginNext = useMemo(
    () => computePostLoginNext(searchParams),
    [searchParams],
  );
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  // Optional marketing opt-in (NOT pre-checked, NOT required to submit).
  // Value is sent on every login; the signup trigger acts on it only when
  // creating the profile row — re-logins by existing users don't overwrite
  // a previously-set consent state.
  const [marketingConsent, setMarketingConsent] = useState(false);
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
          marketingConsent,
          next: postLoginNext,
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
      <div className="auth-card">
        <h1 className="auth-h1">{t("successTitle")}</h1>
        <p className="auth-sub">{t("successBody", { email })}</p>
      </div>
    );
  }

  return (
    <div className="auth-card-wrap">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={renderWidget}
      />
      <form onSubmit={onSubmit} className="auth-card">
        <h1 className="auth-h1">
          {t.rich("title", { em: (chunks) => <span className="em">{chunks}</span> })}
        </h1>
        <p className="auth-sub">{t("subtitle")}</p>

        <div className="field">
          <label htmlFor="email">{t("emailLabel")}</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
          />
        </div>

        <label className="consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (e.target.checked) setConsentError(false);
            }}
          />
          <span>
            {t.rich("consent", {
              terms: (chunks) => (
                <Link href="/terms" target="_blank">
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link href="/privacy" target="_blank">
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        {consentError && (
          <p className="auth-consent-error">{t("consentRequired")}</p>
        )}

        <div className="turnstile-wrap" ref={widgetRef} />
        {!siteKey && (
          <p className="auth-turnstile-warn">
            Turnstile site key is missing — login is disabled.
          </p>
        )}

        {errorCode && (
          <p className="auth-error">{t(`errors.${errorCode}`)}</p>
        )}

        <button
          type="submit"
          disabled={status === "submitting" || !token}
          className="btn-submit"
        >
          {status === "submitting" ? t("submitting") : t("submit")}
        </button>

        <label className="consent consent-after">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => setMarketingConsent(e.target.checked)}
          />
          <span>{t("marketingConsent")}</span>
        </label>
        <p
          className="consent-caption"
          style={{
            margin: "4px 0 0 26px",
            fontSize: "12px",
            lineHeight: 1.45,
            color: "var(--text-mute, #64748b)",
          }}
        >
          {t("marketingConsentCaption")}
        </p>

        <p className="auth-foot">{t("loginNote")}</p>
      </form>
    </div>
  );
}
