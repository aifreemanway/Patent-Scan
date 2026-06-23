"use client";

// IndustrialUsageRow — expandable section per patent in the novelty report.
// Lazy-loads from /api/industrial-usage on click; gates by tier server-side
// (free / starter get 403 → we render the lock + upsell).
//
// Renders nothing inline by default; the row is mounted as a <tr> sibling of
// the patent row, with a colspan covering the full table.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
// Single source of truth for the IU shape — the page lifts the loaded report up
// (via onLoaded) so the export can include it, so the type must be shared, not
// re-declared here (it drifted before).
import type { IUReport } from "@/lib/industrial-usage/types";

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: IUReport }
  | { kind: "locked"; upsell?: string }
  | { kind: "anon" }
  | { kind: "error"; message: string };

export function IndustrialUsageRow({
  patentId,
  patentTitle,
  colSpan,
  onLoaded,
}: {
  patentId: string;
  patentTitle: string;
  colSpan: number;
  // Fired once when IU is successfully loaded — lets the page collect the
  // report so a subsequent export can include the sections the user expanded.
  onLoaded?: (patentId: string, data: IUReport) => void;
}) {
  const t = useTranslations("Report.IndustrialUsage");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FetchState>({ kind: "idle" });

  async function load() {
    setState({ kind: "loading" });
    try {
      const resp = await fetch("/api/industrial-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patentId, patentTitle }),
      });
      if (resp.status === 401) {
        // Not logged in → friendly register teaser, not a generic error.
        setState({ kind: "anon" });
        return;
      }
      if (resp.status === 403) {
        const body = (await resp.json().catch(() => ({}))) as { upsell?: string };
        setState({ kind: "locked", upsell: body.upsell });
        return;
      }
      if (!resp.ok) {
        setState({ kind: "error", message: t("errorPipeline") });
        return;
      }
      const data = (await resp.json()) as IUReport;
      setState({ kind: "ok", data });
      // Surface the loaded report to the page so export can include it (WYSIWYG:
      // only patents the user actually expanded land in the exported file).
      onLoaded?.(patentId, data);
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : t("errorPipeline") });
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && state.kind === "idle") {
      void load();
    }
  }

  return (
    <tr className="bg-slate-50/40">
      <td colSpan={colSpan} className="px-6 py-2">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          <span aria-hidden>{open ? "▼" : "▶"}</span>
          {t("toggleLabel")}
        </button>

        {open && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
            {state.kind === "loading" && (
              <div className="space-y-2" role="status" aria-live="polite">
                <div className="flex items-center gap-2 text-slate-600">
                  <span
                    className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500"
                    aria-hidden
                  />
                  <span>{t("loading")}</span>
                </div>
                {/* Indeterminate bar — IU fans out to PatSearch /docs + Tavily +
                    Gemini, so duration is variable; a pulsing bar signals work
                    in progress without a misleading percentage. */}
                <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full w-full animate-pulse rounded-full bg-blue-400" />
                </div>
                <div className="text-xs text-slate-400">{t("loadingHint")}</div>
              </div>
            )}

            {state.kind === "locked" && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <div className="font-medium">{t("lockedTitle")}</div>
                <div className="mt-1 text-xs">{state.upsell ?? t("lockedDefault")}</div>
              </div>
            )}

            {state.kind === "anon" && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900">
                <div className="text-xs">{t("anonTeaser")}</div>
                <Link
                  href="/login"
                  className="mt-2 inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                >
                  {t("anonCta")}
                </Link>
              </div>
            )}

            {state.kind === "error" && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-900">
                <div className="font-medium">{t("errorTitle")}</div>
                <div className="mt-1 text-xs">{state.message}</div>
              </div>
            )}

            {state.kind === "ok" && <IndustrialUsageBody data={state.data} />}
          </div>
        )}
      </td>
    </tr>
  );
}

function refList(refs: number[]): string {
  return refs.length ? ` [${refs.join(", ")}]` : "";
}

function IndustrialUsageBody({ data }: { data: IUReport }) {
  const t = useTranslations("Report.IndustrialUsage");

  return (
    <div className="space-y-4">
      {/* Assignee */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("assigneeTitle")}
        </h4>
        <div className="mt-1 text-slate-900">
          <span className="font-medium">{data.assignee.canonical || "—"}</span>
          {data.assignee.country && (
            <span className="ml-2 text-xs text-slate-500">({data.assignee.country})</span>
          )}
        </div>
        {data.assignee.description && (
          <p className="mt-1 text-slate-700">
            {data.assignee.description}
            <span className="text-xs text-slate-400">{refList(data.assignee.sourceRefs)}</span>
          </p>
        )}
        {data.assignee.website && (
          <a
            href={data.assignee.website}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs text-blue-600 underline"
          >
            {data.assignee.website}
          </a>
        )}
      </section>

      {/* Products */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("productsTitle")}
        </h4>
        {data.products.length === 0 ? (
          <p className="mt-1 text-slate-500 italic">{t("productsEmpty")}</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {data.products.map((p, i) => (
              <li key={i} className="text-slate-700">
                <span className="font-medium text-slate-900">{p.name}</span>
                {p.description && <span> — {p.description}</span>}
                <span className="text-xs text-slate-400">{refList(p.sourceRefs)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Competitors */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("competitorsTitle")}
        </h4>
        {data.competitors.length === 0 ? (
          <p className="mt-1 text-slate-500 italic">{t("competitorsEmpty")}</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {data.competitors.map((c, i) => (
              <li key={i} className="text-slate-700">
                <span className="font-medium text-slate-900">{c.name}</span>
                {c.country && <span className="ml-1 text-xs text-slate-500">({c.country})</span>}
                {c.technology && <span> — {c.technology}</span>}
                <span className="text-xs text-slate-400">{refList(c.sourceRefs)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Caveats */}
      {data.caveats.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("caveatsTitle")}
          </h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
            {data.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Sources */}
      {data.sources.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("sourcesTitle")} ({data.sources.length})
          </h4>
          <ol className="mt-1 space-y-0.5 text-xs text-slate-600">
            {data.sources.map((s) => (
              <li key={s.ref}>
                <span className="font-mono text-slate-400">[{s.ref}]</span>{" "}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-slate-300 hover:decoration-slate-900"
                >
                  {s.title || s.url}
                </a>
                {s.reachedAt === null && (
                  <span className="ml-1 text-slate-400">{t("sourceArchived")}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Disclaimer — explicit so the user can't mistake this for legal analysis. */}
      <p className="border-t border-slate-100 pt-2 text-xs italic text-slate-400">
        {t("disclaimer")}
      </p>
    </div>
  );
}
