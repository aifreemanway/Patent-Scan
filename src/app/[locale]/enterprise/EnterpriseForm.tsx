"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// v9 demo-request form. VISUAL layout mirrors v7-enterprise.html (2-col
// .form-grid, RU labels, single 152-ФЗ consent). BACKEND IS PRESERVED:
// POST /api/enterprise/request → server Turnstile verify → rate-limit →
// support@ notification + lead confirmation. The route validates
// fullName/position/organization/email/topic as required; inn is optional.
//
// Removed from the visible form per v9 spec (Vsevolod): Phone field and the
// marketing-consent checkbox. The API route still reads `phone`/`marketingConsent`
// but both are OPTIONAL there (phone → "", marketingConsent → false), so omitting
// them from the payload does NOT break submit or validation.

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
  const [topic, setTopic] = useState("");
  const [consent, setConsent] = useState(false);
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
          topic,
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
      <>
        <h3 className="form-success-h">{t("successTitle")}</h3>
        <p className="form-success-p">{t("successBody")}</p>
      </>
    );
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={renderWidget}
      />
      <form onSubmit={onSubmit} autoComplete="on">
        <div className="form-grid">
          <Field
            id="fullName"
            label={t("fullNameLabel")}
            value={fullName}
            onChange={setFullName}
            required
            autoComplete="name"
            placeholder={t("fullNamePlaceholder")}
          />
          <Field
            id="organization"
            label={t("organizationLabel")}
            value={organization}
            onChange={setOrganization}
            required
            autoComplete="organization"
            placeholder={t("organizationPlaceholder")}
          />
        </div>

        <div className="form-grid">
          <Field
            id="position"
            label={t("positionLabel")}
            value={position}
            onChange={setPosition}
            required
            autoComplete="organization-title"
            placeholder={t("positionPlaceholder")}
          />
          <Field
            id="email"
            label={t("emailLabel")}
            value={email}
            onChange={setEmail}
            required
            type="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
          />
        </div>

        <div className="form-row">
          <label htmlFor="topic">
            {t("topicLabel")}
            <span className="req">*</span>
          </label>
          <textarea
            id="topic"
            required
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t("topicPlaceholder")}
          />
        </div>

        {/* ИНН — опционально (для 44-ФЗ / 223-ФЗ). Решение Vsevolod: оставить,
            но не required. Бэкенд валидирует только если поле заполнено. */}
        <div className="form-row">
          <Field
            id="inn"
            label={t("innLabel")}
            value={inn}
            onChange={setInn}
            inputMode="numeric"
            pattern="[0-9]{10,12}"
            hint={t("innHint")}
            bare
          />
        </div>

        <label className="form-consent">
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
          <p className="form-consent-error">{t("consentRequired")}</p>
        )}

        <div className="form-turnstile" ref={widgetRef} />
        {!siteKey && (
          <p className="form-turnstile-warn">{t("turnstileMissing")}</p>
        )}

        {errorCode && (
          <p className="form-error">
            {t(`errors.${errorCode}` as Parameters<typeof t>[0])}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "submitting" || !token}
          className="form-submit"
        >
          {status === "submitting" ? t("submitting") : t("submit")}
        </button>
        <p className="form-note">{t("note")}</p>
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
  placeholder,
  bare,
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
  placeholder?: string;
  // When inside a parent .form-row (e.g. the optional ИНН), render without the
  // wrapping <div className="form-row"> to avoid double margin.
  bare?: boolean;
}) {
  const inner = (
    <>
      <label htmlFor={id}>
        {label}
        {required && <span className="req">*</span>}
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
        placeholder={placeholder}
      />
      {hint && <p className="form-hint">{hint}</p>}
    </>
  );
  if (bare) return inner;
  return <div className="form-row">{inner}</div>;
}
