// ЮKassa REST client — createPayment / getPayment.
// Design: specs/subscription-billing-design-2026-06-02.md §3.
//
// Auth is HTTP Basic `shopId:secretKey`. Every create MUST carry an
// Idempotence-Key header so a retried create never doubles a charge. The webhook
// path (PR-B) re-verifies a payment with getPayment() rather than trusting the
// notification body. Credentials live in env (YOOKASSA_SHOP_ID /
// YOOKASSA_SECRET_KEY) — never logged.
//
// RISK: this talks to a LIVE payment provider. Callers gate every real call
// behind BILLING_LIVE; until then this module is dead code (nothing imports it).

const YOOKASSA_API = "https://api.yookassa.ru/v3";
const TIMEOUT_MS = 20_000;

export type YooKassaAmount = { value: string; currency: string };

export type YooKassaPaymentStatus =
  | "pending"
  | "waiting_for_capture"
  | "succeeded"
  | "canceled";

export type YooKassaPayment = {
  id: string;
  status: YooKassaPaymentStatus;
  paid: boolean;
  amount: YooKassaAmount;
  /** Present once a save_payment_method payment succeeds (recurring anchor). */
  payment_method?: { id?: string; saved?: boolean; type?: string };
  confirmation?: { type: string; confirmation_url?: string };
  metadata?: Record<string, unknown>;
  created_at?: string;
  captured_at?: string;
};

function authHeader(): string {
  const shop = process.env.YOOKASSA_SHOP_ID;
  const secret = process.env.YOOKASSA_SECRET_KEY;
  if (!shop || !secret) {
    throw new Error("YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY not configured");
  }
  return "Basic " + Buffer.from(`${shop}:${secret}`).toString("base64");
}

async function ykFetch(
  path: string,
  init: RequestInit & { idempotenceKey?: string }
): Promise<YooKassaPayment> {
  const { idempotenceKey, ...rest } = init;
  const headers: Record<string, string> = {
    Authorization: authHeader(),
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (idempotenceKey) headers["Idempotence-Key"] = idempotenceKey;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${YOOKASSA_API}${path}`, {
      ...rest,
      headers,
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (!resp.ok) {
      // Surface status + body server-side for diagnosis; never log auth header.
      console.error("[yookassa] non-ok response", {
        path,
        status: resp.status,
        body: text.slice(0, 500),
      });
      throw new Error(`ЮKassa ${path} failed: ${resp.status}`);
    }
    return JSON.parse(text) as YooKassaPayment;
  } finally {
    clearTimeout(timer);
  }
}

export type CreatePaymentInput = {
  amountRub: number;
  description: string;
  returnUrl: string;
  /** Persist the method for later autopayments (recurring first payment). */
  savePaymentMethod?: boolean;
  /** Charge a previously saved method server-side (renewal autopayment). */
  paymentMethodId?: string;
  capture?: boolean;
  metadata?: Record<string, unknown>;
  /** 54-ФЗ receipt — REQUIRED on every charge incl. recurring renewals. */
  receipt?: Record<string, unknown>;
};

/** Create a payment. `idempotenceKey` MUST be stable per logical attempt. */
export async function createPayment(
  input: CreatePaymentInput,
  idempotenceKey: string
): Promise<YooKassaPayment> {
  const body: Record<string, unknown> = {
    amount: { value: input.amountRub.toFixed(2), currency: "RUB" },
    capture: input.capture ?? true,
    description: input.description,
    metadata: input.metadata ?? {},
  };
  if (input.receipt) body.receipt = input.receipt;
  if (input.paymentMethodId) {
    // Server-side autopayment against a saved method — no redirect.
    body.payment_method_id = input.paymentMethodId;
  } else {
    body.confirmation = { type: "redirect", return_url: input.returnUrl };
    if (input.savePaymentMethod) body.save_payment_method = true;
  }
  return ykFetch("/payments", {
    method: "POST",
    body: JSON.stringify(body),
    idempotenceKey,
  });
}

/** Re-fetch a payment to verify its real status (webhook must not trust body). */
export async function getPayment(paymentId: string): Promise<YooKassaPayment> {
  return ykFetch(`/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
  });
}
