"use client";

import { useTranslations } from "next-intl";
import type { LegalStatus, LegalStatusState } from "@/lib/patent-legal-status";

// Map each badge state to an emoji + Tailwind chip styling + the i18n label key
// under Report.legalStatus.*. Kept in one place so the report table and (if
// reused) other surfaces stay consistent. Anti-fab: the default/unknown chip is
// the neutral orange "не определён", never a green default.
export const LEGAL_STATUS_UI: Record<
  LegalStatusState,
  { emoji: string; chip: string; key: string }
> = {
  действует: { emoji: "🟢", chip: "bg-emerald-100 text-emerald-800", key: "active" },
  "не действует": { emoji: "⚪", chip: "bg-slate-100 text-slate-700", key: "inactive" },
  восстановим: { emoji: "🟡", chip: "bg-amber-100 text-amber-800", key: "restorable" },
  истёк: { emoji: "🔵", chip: "bg-sky-100 text-sky-800", key: "expired" },
  "не определён": { emoji: "🟠", chip: "bg-orange-100 text-orange-800", key: "unknown" },
};

// DD.MM.YYYY for captions (extractedAt is ISO YYYY-MM-DD).
export function formatExtractedDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

export function LegalStatusBadge({ status }: { status: LegalStatus }) {
  const t = useTranslations("Report.legalStatus");
  const ui = LEGAL_STATUS_UI[status.state] ?? LEGAL_STATUS_UI["не определён"];
  const caption = t("caption", { date: formatExtractedDate(status.extractedAt) });

  return (
    <span className="inline-flex flex-col gap-0.5">
      <a
        href={status.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={caption}
        className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium no-underline ${ui.chip}`}
      >
        <span aria-hidden>{ui.emoji}</span>
        <span>{t(ui.key)}</span>
      </a>
      <span className="text-[10px] leading-tight text-slate-400">{caption}</span>
    </span>
  );
}

// A small spinner chip shown while the status batch is in flight (per RU row).
export function LegalStatusPending() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-200 border-t-slate-400" />
    </span>
  );
}
