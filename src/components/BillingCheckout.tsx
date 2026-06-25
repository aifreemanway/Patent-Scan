"use client";

// Checkout modal (PR-C) — the screenshot pattern, invoice-first.
//
//   [ Оплатить по счёту ]   ← PRIMARY, always available (safe заявка → admin
//                             activation). Money moves outside the system.
//   [ Оплатить картой   ]   ← shown only when billingLive (real ЮKassa). With an
//                             auto-renew checkbox; OFF by default (one-time month).
//
// Annual is invoice-only (CANON §4b) — the card button hides when period=year.
//
// Prices come from lib/pricing (client-safe number constants). billingLive is
// passed from the server page (it reads the env-driven flag); we never trust a
// client-side env for the money gate.

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  PRICE_STARTER,
  PRICE_TEAM,
  PRICE_TEAM_PLUS,
  formatRub,
} from "@/lib/pricing";

type Tier = "starter" | "team" | "team_plus";
type Period = "month" | "year";

const MONTHLY: Record<Tier, number> = {
  starter: PRICE_STARTER,
  team: PRICE_TEAM,
  team_plus: PRICE_TEAM_PLUS,
};

const TIER_NAME: Record<Tier, string> = {
  starter: "Starter",
  team: "Team",
  team_plus: "Team Plus",
};

type InvoiceStatus = "idle" | "submitting" | "success" | "error";

export function CheckoutModal({
  tier,
  billingLive,
  defaultPeriod = "month",
  onClose,
}: {
  tier: Tier;
  billingLive: boolean;
  defaultPeriod?: Period;
  onClose: () => void;
}) {
  const t = useTranslations("Checkout");
  const locale = useLocale();

  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [mode, setMode] = useState<"choose" | "invoice">("choose");

  // Invoice form
  const [name, setName] = useState("");
  const [inn, setInn] = useState("");
  const [phone, setPhone] = useState("");
  const [invStatus, setInvStatus] = useState<InvoiceStatus>("idle");
  const [invError, setInvError] = useState<string | null>(null);

  // Card
  const [autoRenew, setAutoRenew] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  const monthly = MONTHLY[tier];
  const amount = period === "year" ? monthly * 10 : monthly;
  const priceLabel =
    period === "year"
      ? t("priceYear", { price: formatRub(amount, locale) })
      : t("priceMonth", { price: formatRub(amount, locale) });

  async function submitInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (invStatus === "submitting") return;
    if (!name.trim()) {
      setInvError("invalid_format");
      setInvStatus("error");
      return;
    }
    setInvStatus("submitting");
    setInvError(null);
    try {
      const resp = await fetch("/api/billing/invoice-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          period,
          name: name.trim(),
          inn: inn.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      });
      if (resp.ok) {
        setInvStatus("success");
        return;
      }
      if (resp.status === 429) setInvError("rate_limited");
      else {
        const d = (await resp.json().catch(() => null)) as { error?: string } | null;
        setInvError(d?.error ?? "generic");
      }
      setInvStatus("error");
    } catch {
      setInvError("generic");
      setInvStatus("error");
    }
  }

  async function payByCard() {
    if (cardBusy) return;
    setCardBusy(true);
    setCardError(null);
    try {
      const resp = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, autoRenew }),
      });
      const d = (await resp.json().catch(() => null)) as
        | { confirmationUrl?: string; error?: string }
        | null;
      if (resp.ok && d?.confirmationUrl) {
        window.location.href = d.confirmationUrl;
        return;
      }
      setCardError(d?.error ?? "generic");
      setCardBusy(false);
    } catch {
      setCardError("generic");
      setCardBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {t("title", { tier: TIER_NAME[tier] })}
            </h2>
            <p className="mt-0.5 text-sm font-semibold text-blue-600">{priceLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {invStatus === "success" ? (
          <div className="mt-6 space-y-2">
            <h3 className="text-base font-semibold text-slate-900">
              {t("invoiceSuccessTitle")}
            </h3>
            <p className="text-sm text-slate-600">{t("invoiceSuccessBody")}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              {t("close")}
            </button>
          </div>
        ) : (
          <>
            {/* Period toggle */}
            <div className="mt-4 inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setPeriod("month")}
                className={`rounded-md px-3 py-1.5 font-medium ${period === "month" ? "bg-slate-900 text-white" : "text-slate-600"}`}
              >
                {t("periodMonth")}
              </button>
              <button
                type="button"
                onClick={() => setPeriod("year")}
                className={`rounded-md px-3 py-1.5 font-medium ${period === "year" ? "bg-slate-900 text-white" : "text-slate-600"}`}
              >
                {t("periodYear")}{" "}
                <span className="text-emerald-600">{t("yearBadge")}</span>
              </button>
            </div>

            {mode === "invoice" ? (
              <form onSubmit={submitInvoice} className="mt-5 space-y-3">
                <p className="text-sm text-slate-600">{t("invoiceLead")}</p>
                <Input
                  label={t("nameLabel")}
                  value={name}
                  onChange={setName}
                  required
                  autoComplete="organization"
                />
                <Input
                  label={t("innLabel")}
                  value={inn}
                  onChange={setInn}
                  inputMode="numeric"
                />
                <Input
                  label={t("phoneLabel")}
                  value={phone}
                  onChange={setPhone}
                  inputMode="tel"
                />
                <p className="text-xs text-slate-500">{t("emailNote")}</p>
                <p className="text-xs text-slate-500">{t("invoiceAccessNote")}</p>
                {invStatus === "error" && invError && (
                  <p className="text-sm text-rose-600">{t(`errors.${invError}` as never)}</p>
                )}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={invStatus === "submitting"}
                    className="inline-flex flex-1 justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {invStatus === "submitting" ? t("submitting") : t("submitInvoice")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("choose")}
                    className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-800"
                  >
                    {t("back")}
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-5 space-y-3">
                {/* PRIMARY — pay by invoice */}
                <button
                  type="button"
                  onClick={() => setMode("invoice")}
                  className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  {t("payByInvoice")}
                </button>

                {/* SECONDARY — pay by card (gated; month-only) */}
                {billingLive && period === "month" && (
                  <>
                    <button
                      type="button"
                      onClick={payByCard}
                      disabled={cardBusy}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {cardBusy ? t("submitting") : t("payByCard")}
                    </button>
                    <p className="text-center text-xs text-slate-500">{t("cardInstant")}</p>
                    <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={autoRenew}
                        onChange={(e) => setAutoRenew(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        <strong className="text-slate-800">{t("autoRenewLabel")}</strong>
                        {" — "}
                        {t("autoRenewDesc", { price: formatRub(monthly, locale) })}
                      </span>
                    </label>
                    {cardError && (
                      <p className="text-sm text-rose-600">{t(`errors.${cardError}` as never)}</p>
                    )}
                  </>
                )}
                {billingLive && period === "year" && (
                  <p className="text-center text-xs text-slate-500">{t("yearCardOnlyInvoice")}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  inputMode,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  inputMode?: "text" | "numeric" | "tel" | "email";
  autoComplete?: string;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-slate-600">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-400 focus:outline-none"
      />
    </label>
  );
}

// Button that opens the checkout modal for a tier (used inside the ЛК TierCard).
export function SubscribeButton({
  tier,
  billingLive,
  featured,
  label,
  autoOpen = false,
  autoOpenPeriod = "month",
}: {
  tier: Tier;
  billingLive: boolean;
  featured?: boolean;
  label: string;
  autoOpen?: boolean;
  autoOpenPeriod?: Period;
}) {
  const [open, setOpen] = useState(autoOpen);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex w-full justify-center rounded-md px-4 py-2 text-sm font-semibold transition ${
          featured
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "bg-slate-900 text-white hover:bg-slate-800"
        }`}
      >
        {label}
      </button>
      {open && (
        <CheckoutModal
          tier={tier}
          billingLive={billingLive}
          defaultPeriod={autoOpenPeriod}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
