// Billing domain helpers — plans, purpose↔tier mapping, ЮKassa IP allowlist,
// 54-ФЗ receipt. Design: specs/subscription-billing-design-2026-06-02.md.
// Prices come from config (single source, PROVISIONAL).

import { SUBSCRIPTION_PRICE_RUB } from "./config";

export type BillingTier = "starter" | "team" | "team_plus";

export type Plan = {
  tier: BillingTier;
  /** payments.purpose code, mirrored in metadata for the webhook. */
  purpose: string;
  priceRub: number;
  periodMonths: number;
};

const SELF_SERVE_TIERS: readonly BillingTier[] = ["starter", "team", "team_plus"];

/** Resolve a requested tier to a self-serve monthly plan, or null if invalid.
 *  Enterprise is custom (договор) — never self-checkout. */
export function planFor(tier: string): Plan | null {
  if (!SELF_SERVE_TIERS.includes(tier as BillingTier)) return null;
  const price = SUBSCRIPTION_PRICE_RUB[tier];
  if (typeof price !== "number" || price <= 0) return null;
  return {
    tier: tier as BillingTier,
    purpose: `subscription_${tier}`,
    priceRub: price,
    periodMonths: 1,
  };
}

/** Reverse map: a succeeded payment's metadata.purpose → tier + period for the
 *  apply RPC. Null for non-subscription purposes (one-report etc. don't grant a
 *  tier). */
export function tierFromPurpose(
  purpose: string
): { tier: BillingTier; periodMonths: number } | null {
  const m = /^subscription_(starter|team|team_plus)$/.exec(purpose);
  if (!m) return null;
  return { tier: m[1] as BillingTier, periodMonths: 1 };
}

// 54-ФЗ receipt. vat_code=7 = НДС 5% (ИП Кобзарь shop 1374001 tax setup —
// УСН+НДС5%, per shop config). Attached on EVERY charge, incl. recurring
// renewals (cofounder hard-gate #1).
export function buildReceipt(email: string, description: string, amountRub: number) {
  return {
    customer: { email },
    items: [
      {
        description: description.slice(0, 128),
        quantity: "1.00",
        amount: { value: amountRub.toFixed(2), currency: "RUB" },
        vat_code: 7,
        payment_subject: "service",
        payment_mode: "full_payment",
      },
    ],
  };
}

// ── ЮKassa notification source IPs (published) ────────────────────────────────
// Defense-in-depth ONLY — the webhook also re-verifies every payment via
// GET /payments/{id}, which is the authoritative check (never trust the body).
// https://yookassa.ru/developers/using-api/webhooks
const YOOKASSA_IPV4_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ["185.71.76.0", 27],
  ["185.71.77.0", 27],
  ["77.75.153.0", 25],
  ["77.75.154.128", 25],
  ["77.75.156.11", 32],
  ["77.75.156.35", 32],
];
const YOOKASSA_IPV6_PREFIX = "2a02:5180:";

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n * 256 + o) >>> 0;
  }
  return n >>> 0;
}

export function isYooKassaIp(ip: string | null): boolean {
  if (!ip) return false;
  const clean = ip.trim();
  if (clean.includes(":")) {
    return clean.toLowerCase().startsWith(YOOKASSA_IPV6_PREFIX);
  }
  const ipInt = ipv4ToInt(clean);
  if (ipInt === null) return false;
  for (const [base, bits] of YOOKASSA_IPV4_CIDRS) {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((ipInt & mask) >>> 0 === (baseInt & mask) >>> 0) return true;
  }
  return false;
}
