// Pricing single-source-of-truth for the /pricing page + ЛК mirror (PR-C).
//
// CANON: Antepatent/calibration-reference/CANON-products-IA-pricing-2026-06-02.md
// (sign-off Vsevolod 2026-06-02). On any conflict with the build-ready ТЗ
// (pricing-page-TZ-2026-06-02.md) — CANON wins.
//
// ⚠ Prices are PRELIMINARY (launch-baseline, WTP calibration via the Samara demo
// cohort). They are intentionally chosen numbers, NOT placeholders — but the
// page must carry a visible «предварительные тарифы» banner until sign-off-final.
//
// Architecture per ТЗ §11 = "тариф + слой аддонов": every price/quota/feature
// lives in THIS config, not in markup, so finals replace numbers without a
// re-layout. Future paid products/addons are reserved as gated entries below
// and MUST NOT render while their flag is off (no product = anti-fab).

// ─────────────────────────────────────────────────────────────────────────────
// Feature flags
// ─────────────────────────────────────────────────────────────────────────────

/** Billing (ЮKassa) is NOT live yet (PR-A/PR-B in build). While false, every CTA
 *  routes to a "заявка / свяжемся для оплаты" flow — never a broken checkout. */
export const BILLING_LIVE = false;

/** Premium-track prices (Deep 9900 / Ландшафт 14900 / Скрининг 19900) unlock only
 *  after legal-status (Этап 1) + a formal deliverable export. HIDDEN until then —
 *  do NOT render the premium column/cards while this is false. */
export const PREMIUM_TRACK_ENABLED = false;

/** Reserved addon layer (FTO-заключение, мониторинг, ГОСТ-экспорт, зарубежный
 *  правовой статус, API, IUL). No product exists yet → structure only, NOT
 *  rendered while false (anti-fab). Flip per-addon `enabled` + this flag when a
 *  service ships. */
export const ADDONS_ENABLED = false;

// ─────────────────────────────────────────────────────────────────────────────
// Named price constants (₽). Today-track is authoritative; premium-track is the
// gated future tier kept here so it flips on via PREMIUM_TRACK_ENABLED + config.
// ─────────────────────────────────────────────────────────────────────────────

// One-off reports — today-track (CANON §4, sign-off)
export const PRICE_DEEP_TODAY = 6900;
export const PRICE_LANDSCAPE_TODAY = 9900;
/** Скрининг (ex-«литобзор»): 12900 пилот. Таргет 14900 после 5–10 продаж —
 *  меняется здесь одной строкой, текущая launch-baseline = 12900. */
export const PRICE_SCREENING_TODAY = 12900;
// export const PRICE_SCREENING_TARGET = 14900; // next step after pilot WTP

// One-off reports — premium-track (gated by PREMIUM_TRACK_ENABLED)
export const PRICE_DEEP_PREMIUM = 9900;
export const PRICE_LANDSCAPE_PREMIUM = 14900;
export const PRICE_SCREENING_PREMIUM = 19900;

// Subscription — ₽/мес (CANON §4, model C; quotas are SEPARATE per tier)
export const PRICE_FREE = 0;
export const PRICE_STARTER = 5900;
export const PRICE_TEAM = 24900;
export const PRICE_TEAM_PLUS = 39900;
// Enterprise = custom (по запросу) — no numeric price.

// Institutional credit packs (CANON / ТЗ §3.4 footer line)
export const PRICE_PACK_SCREENING_10 = 119000;
export const PRICE_PACK_DEEP_20 = 109000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CtaKind =
  /** Subscribe / order — pre-launch: opens заявка flow; live: real checkout. */
  | "request"
  /** Free tier — straight into the product, no payment. */
  | "free"
  /** Enterprise / institutional — contact sales. */
  | "contact";

/** i18n key suffix under Pricing.* — copy never lives in this file. */
type I18nKey = string;

export type SubscriptionTier = {
  id: "free" | "starter" | "team" | "team_plus" | "enterprise";
  /** ₽/мес, or null for "по запросу" (Enterprise). */
  priceMonthly: number | null;
  featured?: boolean;
  cta: CtaKind;
  /** Quota line keys (rendered as a bullet list from i18n). */
  quotaKeys: I18nKey[];
  /** Feature-bullet i18n keys. */
  featureKeys: I18nKey[];
};

export type OneOffProduct = {
  id: "deep" | "landscape" | "screening";
  priceToday: number;
  /** Gated price shown only when PREMIUM_TRACK_ENABLED. */
  pricePremium: number;
  featured?: boolean;
  cta: CtaKind;
  /** ~time-to-result key (Pricing.products.*.time). */
};

export type Addon = {
  id:
    | "fto_opinion"
    | "monitoring"
    | "gost_export"
    | "foreign_legal_status"
    | "api_access"
    | "iul";
  /** Per-addon kill-switch; ALSO gated by ADDONS_ENABLED globally. */
  enabled: boolean;
  /** null = price not set / "по запросу". */
  price: number | null;
  type: "one_off" | "recurring" | "tier_feature";
};

// ─────────────────────────────────────────────────────────────────────────────
// Structured config — the page reads ONLY this (prices/quotas/features here,
// not in markup). i18n keys resolve copy under the Pricing namespace.
// ─────────────────────────────────────────────────────────────────────────────

export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  {
    id: "free",
    priceMonthly: PRICE_FREE,
    cta: "free",
    quotaKeys: ["tiers.free.quota.searches"],
    featureKeys: [
      "tiers.free.feat.iul",
      "tiers.free.feat.worldwide",
      "tiers.free.feat.history",
    ],
  },
  {
    id: "starter",
    priceMonthly: PRICE_STARTER,
    cta: "request",
    quotaKeys: ["tiers.starter.quota.searches", "tiers.starter.quota.deep"],
    featureKeys: [
      "tiers.starter.feat.iul",
      "tiers.starter.feat.export",
      "tiers.starter.feat.priority",
    ],
  },
  {
    id: "team",
    priceMonthly: PRICE_TEAM,
    featured: true,
    cta: "request",
    quotaKeys: [
      "tiers.team.quota.searches",
      "tiers.team.quota.deep",
      "tiers.team.quota.landscape",
      "tiers.team.quota.seats",
    ],
    featureKeys: ["tiers.team.feat.iul", "tiers.team.feat.export", "tiers.team.feat.priority"],
  },
  {
    id: "team_plus",
    priceMonthly: PRICE_TEAM_PLUS,
    cta: "request",
    quotaKeys: [
      "tiers.team_plus.quota.searches",
      "tiers.team_plus.quota.deep",
      "tiers.team_plus.quota.landscape",
      "tiers.team_plus.quota.screening",
    ],
    featureKeys: ["tiers.team_plus.feat.iul", "tiers.team_plus.feat.allTeam"],
  },
  {
    id: "enterprise",
    priceMonthly: null,
    cta: "contact",
    quotaKeys: ["tiers.enterprise.quota.unlimited"],
    featureKeys: [
      "tiers.enterprise.feat.api",
      "tiers.enterprise.feat.sso",
      "tiers.enterprise.feat.contract",
    ],
  },
] as const;

export const ONE_OFF_PRODUCTS: readonly OneOffProduct[] = [
  {
    id: "deep",
    priceToday: PRICE_DEEP_TODAY,
    pricePremium: PRICE_DEEP_PREMIUM,
    featured: true,
    cta: "request",
  },
  {
    id: "landscape",
    priceToday: PRICE_LANDSCAPE_TODAY,
    pricePremium: PRICE_LANDSCAPE_PREMIUM,
    cta: "request",
  },
  {
    id: "screening",
    priceToday: PRICE_SCREENING_TODAY,
    pricePremium: PRICE_SCREENING_PREMIUM,
    cta: "request",
  },
] as const;

/** Reserved future paid services. ⚠ Gated by ADDONS_ENABLED — NOT rendered now
 *  (no product = anti-fab). Slots exist so a service is added by config, not by
 *  re-layout (ТЗ §11). */
export const ADDONS: readonly Addon[] = [
  { id: "fto_opinion", enabled: false, price: null, type: "one_off" },
  { id: "monitoring", enabled: false, price: null, type: "recurring" },
  { id: "gost_export", enabled: false, price: null, type: "one_off" },
  { id: "foreign_legal_status", enabled: false, price: null, type: "one_off" },
  { id: "api_access", enabled: false, price: null, type: "tier_feature" },
  { id: "iul", enabled: false, price: null, type: "tier_feature" },
] as const;

/** Addons to actually render = global flag AND per-addon flag. Empty while
 *  ADDONS_ENABLED is false. */
export const VISIBLE_ADDONS: readonly Addon[] = ADDONS_ENABLED
  ? ADDONS.filter((a) => a.enabled)
  : [];

/** Institutional credit packs (ТЗ §3.4). Rendered as a single contact line. */
export const CREDIT_PACKS = {
  screening10: PRICE_PACK_SCREENING_10,
  deep20: PRICE_PACK_DEEP_20,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** ₽ formatting with non-breaking thousands space, e.g. 24900 → "24 900 ₽". */
export function formatRub(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Active one-off price for the live track (premium when flagged on). */
export function oneOffPrice(p: OneOffProduct): number {
  return PREMIUM_TRACK_ENABLED ? p.pricePremium : p.priceToday;
}
