"use client";

// Expert Field-View — the "Поле" mode of the report (ТЗ feature-expert-field-view
// -mvp-2026-06-08). Pure presentation over the v2 pool the search already produced
// (lib/field-view.ts does the grouping/jump logic). Groups candidates by IPC main-
// group, pins the in-class top-15, lets the expert reveal the full class and jump
// to ANY class by ANY of a patent's codes (multi-class — ТЗ §4.2).
//
// Anti-fab: nothing here invents data. "Близкий" = a real relevance signal (the
// LLM-ranked window, inWindow), legal status is shown verbatim from ФИПС or
// "не определён" when absent, unknown IPC classes show the raw code (no guessed
// label) and patents with no IPC go to an explicit "Без классификации" bucket.

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  buildFieldView,
  patentsInClass,
  splitHighlight,
  normalizeIpc,
  FIELD_HIGHLIGHT_K,
  type FieldPatent,
  type FieldPatentInput,
} from "@/lib/field-view";
import { ipcMainGroupLabel } from "@/lib/ipc-labels";
import { LegalStatusBadge, LegalStatusPending } from "@/components/LegalStatusBadge";
import type { LegalStatus } from "@/lib/patent-legal-status";

type FieldViewProps = {
  pool: FieldPatentInput[];
  ranked: number;
  legalStatuses: Record<string, LegalStatus>;
  legalLoading: boolean;
};

// Full RU/SU id (with kind, e.g. "RU88863U1"), or null for non-RU. Carries the
// kind so the legal-status resolver picks RUPM vs RUPAT; doubles as the lookup
// key into the statuses map (matches report/page.tsx).
function ruNumberOf(p: { id: string; country?: string }): string | null {
  const cc = (p.country ?? "").toUpperCase() || /^([A-Z]{2})/.exec(p.id ?? "")?.[1] || "";
  if (cc !== "RU" && cc !== "SU") return null;
  const id = (p.id ?? "").trim();
  return id && /\d/.test(id) ? id : null;
}

export function FieldView({ pool, ranked, legalStatuses, legalLoading }: FieldViewProps) {
  const t = useTranslations("Report");
  const locale = useLocale() === "en" ? "en" : "ru";

  const field = useMemo(() => buildFieldView(pool, ranked), [pool, ranked]);

  // #7 — все «близкие» (in-window) патенты, собранные из всех классов в один
  // плоский список и отсортированные по релевантности (poolIndex asc = window-
  // first). Свёрнут по умолчанию, чтобы не заслонять навигацию по классам.
  const closeFlat = useMemo(() => {
    const all = [
      ...field.classes.flatMap((c) => c.patents),
      ...field.unclassified,
    ].filter((p) => p.inWindow);
    all.sort((a, b) => a.poolIndex - b.poolIndex);
    return all;
  }, [field]);
  const [showAllClose, setShowAllClose] = useState(false);

  // Class-jump (ТЗ §4.4): an expert types/clicks an IPC class → we show every
  // pool patent carrying that code in ANY position (multi-class match).
  const [jumpInput, setJumpInput] = useState("");
  const [activeJump, setActiveJump] = useState<string | null>(null);
  // Per-class "показать ещё" reveal state.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const jumpResults = useMemo(
    () => (activeJump ? patentsInClass(pool, ranked, activeJump) : null),
    [activeJump, pool, ranked]
  );

  const doJump = (code: string) => {
    const norm = normalizeIpc(code);
    if (norm) setActiveJump(norm);
  };

  // Empty field (ТЗ §4.5): no candidates at all → honest empty, NOT "уникально".
  if (field.totalPatents === 0) {
    return (
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">{t("field.title")}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{t("field.emptyField")}</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{t("field.escapeAttorney")}</p>
      </section>
    );
  }

  const card = (p: FieldPatent) => {
    const num = ruNumberOf(p);
    const st = num ? legalStatuses[num] : undefined;
    return (
      <li
        key={p.id}
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">
              {p.url ? (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-slate-300 hover:decoration-slate-900"
                >
                  {p.title || p.id}
                </a>
              ) : (
                p.title || p.id
              )}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="font-mono">{p.id}</span>
              {p.year && <span>{p.year}</span>}
              {p.country && <span>{p.country}</span>}
            </div>
          </div>
          {p.inWindow && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
              {t("field.cardClose")}
            </span>
          )}
        </div>

        {/* All IPC codes (ТЗ §4.2 — full classification on the card). */}
        {p.ipc.length > 0 && (
          <div className="mt-3">
            <span className="text-xs font-medium text-slate-500">{t("field.allCodes")}: </span>
            <span className="inline-flex flex-wrap gap-1.5 align-middle">
              {p.ipc.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => doJump(code)}
                  title={t("field.jumpToCode", { code })}
                  className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700 hover:bg-slate-200"
                >
                  {code}
                </button>
              ))}
            </span>
          </div>
        )}

        {/* Legal status — verbatim from ФИПС or "не определён" (anti-fab). RU only. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {num ? (
            st ? (
              <LegalStatusBadge status={st} />
            ) : legalLoading ? (
              <LegalStatusPending />
            ) : (
              <span className="text-slate-400">{t("legalStatus.unknown")}</span>
            )
          ) : (
            <span className="text-slate-400">{t("legalStatus.nonRu")}</span>
          )}
        </div>

        {/* Why here — the real signal that placed this card (class + window). */}
        <p className="mt-2 text-xs leading-5 text-slate-400">
          <span className="font-medium text-slate-500">{t("field.whyHere")}:</span>{" "}
          {p.primaryClass
            ? t("field.whyHereClass", { code: p.primaryClass })
            : t("field.whyHereUnclassified")}
          {p.inWindow ? ` · ${t("field.whyHereClose")}` : ""}
        </p>
      </li>
    );
  };

  return (
    <section className="mt-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">{t("field.title")}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{t("field.subtitle")}</p>

        {/* Class jump (ТЗ §4.4) */}
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (jumpInput.trim()) doJump(jumpInput.trim());
          }}
        >
          <input
            type="text"
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            placeholder={t("field.jumpPlaceholder")}
            aria-label={t("field.jumpLabel")}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 sm:max-w-xs"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            {t("field.jumpButton")}
          </button>
        </form>
      </div>

      {/* Jump results — every patent carrying the code in ANY position. */}
      {activeJump && jumpResults && (
        <div className="mt-4 rounded-2xl border border-slate-300 bg-slate-50 p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">
              {t("field.jumpResultsTitle", { code: activeJump, n: jumpResults.length })}
            </h3>
            <button
              type="button"
              onClick={() => {
                setActiveJump(null);
                setJumpInput("");
              }}
              className="shrink-0 text-sm font-medium text-slate-500 underline hover:text-slate-800"
            >
              {t("field.jumpClear")}
            </button>
          </div>
          {jumpResults.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">{t("field.jumpEmpty")}</p>
          ) : (
            <ul className="mt-4 space-y-3">{jumpResults.map(card)}</ul>
          )}
        </div>
      )}

      {/* Overview navigation (all-close list + class sections) — hidden while a
          class-jump is active so the jump result is the focus; «Сбросить» clears
          the jump and restores it (#4). */}
      {!activeJump && (
        <>
          {/* #7 — все близкие одним списком (relevance-sorted), свёрнуто по умолчанию */}
          {closeFlat.length > 0 && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setShowAllClose((v) => !v)}
                className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
                aria-expanded={showAllClose}
              >
                <span className="text-base font-semibold text-slate-900">
                  {t("field.allCloseTitle")}
                </span>
                <span className="shrink-0 text-sm font-medium text-slate-600">
                  {showAllClose
                    ? t("field.allCloseHide")
                    : t("field.allCloseShow", { n: closeFlat.length })}
                </span>
              </button>
              {showAllClose && (
                <ul className="space-y-3 border-t border-slate-100 p-6">
                  {closeFlat.map(card)}
                </ul>
              )}
            </div>
          )}

      {/* Class sections (ТЗ §4.1, §4.3) */}
      <div className="mt-4 space-y-4">
        {field.classes.map((cls) => {
          const label = ipcMainGroupLabel(cls.mainGroup, locale);
          const { top, rest } = splitHighlight(cls.patents, FIELD_HIGHLIGHT_K);
          const isOpen = expanded[cls.mainGroup];
          return (
            <div
              key={cls.mainGroup}
              className="rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="border-b border-slate-100 px-6 py-4">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <button
                    type="button"
                    onClick={() => doJump(cls.mainGroup)}
                    className="font-mono text-base font-semibold text-slate-900 hover:underline"
                    title={t("field.jumpToCode", { code: cls.mainGroup })}
                  >
                    {cls.mainGroup}
                  </button>
                  {label && <span className="text-sm text-slate-600">— {label}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                  <span>{t("field.patentCount", { n: cls.total })}</span>
                  {cls.closeCount > 0 && (
                    <span className="font-medium text-emerald-700">
                      {t("field.closeCount", { n: cls.closeCount })}
                    </span>
                  )}
                </div>
                {/* Subgroup drill (ТЗ §4.1) — distinct full subgroups present. */}
                {cls.subgroups.length > 1 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {cls.subgroups.map((sg) => (
                      <button
                        key={sg}
                        type="button"
                        onClick={() => doJump(sg)}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-600 hover:bg-slate-100"
                      >
                        {sg}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <ul className="space-y-3 p-6">{top.map(card)}</ul>

              {rest.length > 0 && (
                <div className="border-t border-slate-100 px-6 py-3">
                  {isOpen ? (
                    <>
                      <ul className="space-y-3 pb-3">{rest.map(card)}</ul>
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((e) => ({ ...e, [cls.mainGroup]: false }))
                        }
                        className="text-sm font-medium text-slate-500 underline hover:text-slate-800"
                      >
                        {t("field.showLess")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((e) => ({ ...e, [cls.mainGroup]: true }))
                      }
                      className="text-sm font-medium text-slate-700 underline hover:text-slate-900"
                    >
                      {t("field.showMore", { n: rest.length })}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Unclassified bucket (ТЗ §4.5) — shown, never dropped. */}
        {field.unclassified.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-semibold text-slate-900">
                {t("field.unclassifiedTitle")}
              </h3>
              <p className="mt-1 text-xs text-slate-500">{t("field.unclassifiedNote")}</p>
              <p className="mt-1 text-xs text-slate-500">
                {t("field.patentCount", { n: field.unclassified.length })}
              </p>
            </div>
            <ul className="space-y-3 p-6">{field.unclassified.map(card)}</ul>
          </div>
        )}
      </div>
        </>
      )}

      {/* Field never claims completeness — escape to the expert/attorney. */}
      <p className="mt-4 text-xs leading-5 text-slate-500">{t("field.escapeAttorney")}</p>
    </section>
  );
}
