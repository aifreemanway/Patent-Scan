"use client";

// Polls /api/literature-review/[id]/status every 5 seconds and renders a
// stage-named progress block. On completion redirects the user to download
// the report (or shows the link if no auto-download is wired).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Status =
  | "pending"
  | "in_progress"
  | "completed"
  | "error"
  | "cancelled";

type StatusPayload = {
  id: string;
  type: string;
  status: Status;
  stage: number | null;
  progress_pct: number | null;
  result_pdf_url: string | null;
  error_message: string | null;
  created_at: string;
};

const POLL_MS = 5000;
const STAGE_KEYS: Record<number, string> = {
  1: "stage1",
  2: "stage2",
  3: "stage3",
  4: "stage4",
  5: "stage5",
  6: "stage6",
  7: "stage7",
  8: "stage8",
  9: "stage9",
};

export function ProcessingClient({ id }: { id: string }) {
  const t = useTranslations("LiteratureReview.processing");
  const [state, setState] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<"not_found" | "network" | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const resp = await fetch(`/api/literature-review/${id}/status`, {
          cache: "no-store",
        });
        if (!resp.ok) {
          if (resp.status === 404) setError("not_found");
          else setError("network");
          return;
        }
        const data = (await resp.json()) as StatusPayload;
        if (cancelled) return;
        setState(data);
        setError(null);
        // Keep polling if not terminal
        if (data.status === "pending" || data.status === "in_progress") {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch {
        if (cancelled) return;
        setError("network");
        timer = setTimeout(poll, POLL_MS * 2);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (error === "not_found") {
    return (
      <Alert tone="rose">
        <p>{t("notFound")}</p>
        <p className="mt-3">
          <Link href="/account/history" className="underline">
            {t("backToHistory")}
          </Link>
        </p>
      </Alert>
    );
  }

  if (!state) {
    return <p className="text-slate-500">{t("loading")}</p>;
  }

  const shortId = state.id.slice(0, 8);

  if (state.status === "completed") {
    return (
      <div className="space-y-6">
        <Alert tone="emerald">
          <h2 className="text-lg font-semibold">{t("doneTitle")}</h2>
          <p className="mt-2 text-sm">{t("doneBody", { id: shortId })}</p>
        </Alert>
        {state.result_pdf_url && (
          <a
            href={state.result_pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded-md bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            {t("downloadReport")}
          </a>
        )}
        <div>
          <Link
            href="/account/history"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {t("viewHistory")} →
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Alert tone="rose">
        <h2 className="text-lg font-semibold">{t("errorTitle")}</h2>
        <p className="mt-2 text-sm">{t("errorBody")}</p>
        {state.error_message && (
          <pre className="mt-3 overflow-x-auto rounded bg-rose-100 p-2 text-xs text-rose-900">
            {state.error_message}
          </pre>
        )}
        <form
          method="POST"
          action={`/api/literature-review/${state.id}/retry`}
          className="mt-4"
        >
          <button
            type="submit"
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
          >
            {t("retry")}
          </button>
        </form>
      </Alert>
    );
  }

  if (state.status === "cancelled") {
    return (
      <Alert tone="slate">
        <p>{t("cancelled")}</p>
        <p className="mt-3">
          <Link href="/literature-review" className="underline">
            {t("startNew")}
          </Link>
        </p>
      </Alert>
    );
  }

  // pending or in_progress — show stage label + progress bar
  const stageLabel = state.stage
    ? t(`stages.${STAGE_KEYS[state.stage] ?? "stage1"}` as Parameters<typeof t>[0])
    : t("queued");
  const pct = state.progress_pct ?? 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-500">{t("status")}</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">{stageLabel}</p>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">{pct}%</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700">
        <p className="font-semibold">{t("whatNext")}</p>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>{t("whatNext1")}</li>
          <li>{t("whatNext2")}</li>
          <li>{t("whatNext3")}</li>
        </ol>
      </div>

      <p className="text-xs text-slate-500">{t("closeWindowHint")}</p>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/account/history"
          className="inline-flex rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          {t("viewHistory")}
        </Link>
        <Link
          href="/literature-review"
          className="inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t("startNew")}
        </Link>
      </div>
    </div>
  );
}

function Alert({
  tone,
  children,
}: {
  tone: "rose" | "emerald" | "slate";
  children: React.ReactNode;
}) {
  const colors: Record<typeof tone, string> = {
    rose: "border-rose-200 bg-rose-50 text-rose-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return (
    <div className={`rounded-2xl border p-6 ${colors[tone]}`}>{children}</div>
  );
}
