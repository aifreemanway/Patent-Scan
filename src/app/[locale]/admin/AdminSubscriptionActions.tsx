"use client";

// Admin manual subscription activate / deactivate (PR-C, §5 Фаза 2).
// Money-relevant write → posts to /api/admin/subscription (admin-gated), then
// router.refresh() to re-render the server page with the new tier. Hardcoded RU
// strings to match the rest of the internal /admin panel (no i18n — spec §2).

import { useState } from "react";
import { useRouter } from "next/navigation";

type Period = "month" | "year";
type Tier = "starter" | "team" | "team_plus";

const TIER_OPTIONS: { value: Tier; label: string }[] = [
  { value: "starter", label: "Starter" },
  { value: "team", label: "Team" },
  { value: "team_plus", label: "Team Plus" },
];

export function AdminSubscriptionActions({
  userId,
  currentTier,
}: {
  userId: string;
  currentTier: string;
}) {
  const router = useRouter();
  const [tier, setTier] = useState<Tier>("team");
  const [period, setPeriod] = useState<Period>("month");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<null | "activate" | "deactivate">(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function post(payload: Record<string, unknown>, which: "activate" | "deactivate") {
    setBusy(which);
    setMsg(null);
    try {
      const resp = await fetch("/api/admin/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...payload }),
      });
      const data = (await resp.json().catch(() => null)) as
        | { error?: string; result?: { period_end?: string } }
        | null;
      if (!resp.ok) {
        setMsg({ kind: "err", text: `Ошибка: ${data?.error ?? resp.status}` });
        return;
      }
      setMsg({
        kind: "ok",
        text:
          which === "activate"
            ? `Активирован тариф ${tier}${data?.result?.period_end ? ` до ${new Date(data.result.period_end).toLocaleDateString("ru-RU")}` : ""}.`
            : "Подписка деактивирована, аккаунт переведён на Free.",
      });
      router.refresh();
    } catch {
      setMsg({ kind: "err", text: "Сетевая ошибка, повтори." });
    } finally {
      setBusy(null);
    }
  }

  function onActivate() {
    const amt = amount.trim() ? Number(amount.trim()) : undefined;
    if (amount.trim() && (!Number.isFinite(amt) || (amt as number) < 0)) {
      setMsg({ kind: "err", text: "Сумма должна быть неотрицательным числом." });
      return;
    }
    void post(
      {
        action: "activate",
        tier,
        period,
        invoiceNo: invoiceNo.trim() || undefined,
        amount: amt,
      },
      "activate"
    );
  }

  function onDeactivate() {
    if (
      !window.confirm(
        "Деактивировать подписку и перевести аккаунт на Free прямо сейчас?"
      )
    )
      return;
    void post({ action: "deactivate" }, "deactivate");
  }

  const inputCls =
    "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-blue-400 focus:outline-none";

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Активация по счёту: счёт выставляется и оплачивается вне системы
        (закрывающий — УПД), здесь фиксируется факт и открывается тариф.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">Тариф</span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier)}
            className={inputCls}
          >
            {TIER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-600">Период</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className={inputCls}
          >
            <option value="month">Месяц (1 мес)</option>
            <option value="year">Год (12 мес)</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-600">№ счёта (опц.)</span>
          <input
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            placeholder="напр. 2026-014"
            className={inputCls}
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-600">Сумма ₽ (опц.)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="напр. 24900"
            className={inputCls}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onActivate}
          disabled={busy !== null}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "activate" ? "Активирую…" : "Активировать подписку"}
        </button>
        {currentTier !== "free" && (
          <button
            type="button"
            onClick={onDeactivate}
            disabled={busy !== null}
            className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            {busy === "deactivate" ? "Деактивирую…" : "Деактивировать → Free"}
          </button>
        )}
      </div>

      {msg && (
        <p
          className={`text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-rose-700"}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
