// Expert Field-View — pure reorganisation of an EXISTING prior-art pool by IPC
// class (ТЗ feature-expert-field-view-mvp-2026-06-08). The ranker can't pull the
// single needle out of ~140 equally-relevant in-class patents — that's the
// expert's job, which we ACCELERATE: group the pool the search already produced
// by classification.ipc, surface in-class top hits, let the expert navigate.
// RETRIEVAL IS NOT TOUCHED — this is presentation logic over the v2 pool, whose
// `hits` is the full pool ordered window-first (so pool index is a relevance
// proxy and window members lead their class).
//
// Anti-fab: nothing here invents data. "Close" means a real relevance signal
// (the LLM-ranked window), labels are only attached for known classes (unknown →
// no label, never guessed), and a patent with no IPC is shown in an explicit
// "unclassified" bucket, not dropped or merged.

import { ipcMainGroupLabel } from "./ipc-labels";

/** Minimal patent shape the field view needs — a subset of PatentHit plus the
 *  derived window flag. legalStatus is optional and passed through verbatim. */
export type FieldPatentInput = {
  id: string;
  title?: string;
  titleRu?: string;
  titleEn?: string;
  year?: string;
  country?: string;
  url?: string;
  ipc?: string[];
  legalStatus?: string;
};

export type FieldPatent = {
  id: string;
  title: string;
  year?: string;
  country?: string;
  url?: string;
  ipc: string[]; // ALL normalised IPC codes (no spaces), deduped
  primaryClass: string; // IPC main-group of the first valid code, e.g. "G01R31"; "" if none
  inWindow: boolean; // was in the LLM-ranked window (the real relevance signal)
  poolIndex: number; // position in the full pool (relevance proxy; window-first)
  legalStatus?: string; // verbatim from source if available; UI shows "не определён" if absent
};

export type FieldClass = {
  mainGroup: string; // e.g. "G01R31"
  label: string | null; // human label for known classes, else null (never fabricated)
  patents: FieldPatent[]; // sorted window-first then by pool order
  total: number; // patents in this class
  closeCount: number; // # of in-window patents ("близких") — a real relevance signal
  subgroups: string[]; // distinct full subgroups present (for drill-down), sorted
};

export type FieldView = {
  classes: FieldClass[]; // sorted by relevance density (closeCount desc, then size)
  unclassified: FieldPatent[]; // patents with no/invalid IPC — shown, never dropped
  totalPatents: number;
};

const IPC_FULL_RE = /^[A-H]\d{2}[A-Z]\d{1,4}\/\d{1,6}$/;
const IPC_MAINGROUP_RE = /^[A-H]\d{2}[A-Z]\d{1,4}$/;

/** Normalise an IPC code: strip all whitespace, uppercase. "G01R 31/34" → "G01R31/34". */
export function normalizeIpc(code: string): string {
  return code.replace(/\s+/g, "").toUpperCase();
}

/** Main-group of a full IPC code: "G01R31/34" → "G01R31". Returns "" if the input
 *  isn't a recognisable full code or bare main-group. */
export function mainGroupOf(code: string): string {
  const c = normalizeIpc(code);
  if (IPC_FULL_RE.test(c)) return c.split("/")[0];
  if (IPC_MAINGROUP_RE.test(c)) return c;
  return "";
}

/** All normalised, valid, deduped IPC codes of a patent (full subgroup codes). */
function validCodes(p: FieldPatentInput): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of p.ipc ?? []) {
    if (typeof raw !== "string") continue;
    const c = normalizeIpc(raw);
    if (!IPC_FULL_RE.test(c)) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

function titleOf(p: FieldPatentInput): string {
  return (p.title || p.titleRu || p.titleEn || "").trim();
}

/**
 * CRITICAL (ТЗ §4.2, AC#2): does a patent belong to `classCode` by ANY of its IPC
 * codes — not just its primary? A jump/filter to a class must surface every
 * patent carrying that code anywhere in its IPC list, or we lose targets (Samara
 * RU2799985 must appear when jumping to its class even if grouped elsewhere).
 * - classCode with "/" (a subgroup, e.g. "G01R31/34") → exact match on any code.
 * - classCode without "/" (a main-group, e.g. "G01R31") → any code's main-group matches.
 */
export function patentMatchesClass(p: FieldPatentInput, classCode: string): boolean {
  const target = normalizeIpc(classCode);
  const codes = validCodes(p);
  if (target.includes("/")) return codes.includes(target);
  return codes.some((c) => c.split("/")[0] === target);
}

/** Map a raw pool patent to a FieldPatent. `poolIndex` is its position in the full
 *  pool (window-first); `rankedCount` is the size of the LLM-ranked window. */
function toFieldPatent(
  p: FieldPatentInput,
  poolIndex: number,
  rankedCount: number
): FieldPatent {
  const codes = validCodes(p);
  return {
    id: p.id,
    title: titleOf(p),
    year: p.year,
    country: p.country,
    url: p.url,
    ipc: codes,
    primaryClass: codes.length ? mainGroupOf(codes[0]) : "",
    inWindow: poolIndex < rankedCount,
    poolIndex,
    legalStatus: p.legalStatus,
  };
}

/**
 * Build the field view from the full pool (ordered window-first, as v2 returns it)
 * and the ranked-window size. Groups by primary main-group, sorts each class
 * window-first then by pool order, and sorts classes by relevance density.
 */
export function buildFieldView(
  pool: FieldPatentInput[],
  rankedCount: number
): FieldView {
  const byClass = new Map<string, FieldPatent[]>();
  const unclassified: FieldPatent[] = [];

  pool.forEach((raw, i) => {
    if (!raw?.id) return;
    const fp = toFieldPatent(raw, i, rankedCount);
    if (!fp.primaryClass) {
      unclassified.push(fp);
      return;
    }
    const arr = byClass.get(fp.primaryClass) ?? [];
    arr.push(fp);
    byClass.set(fp.primaryClass, arr);
  });

  const classes: FieldClass[] = [];
  for (const [mainGroup, patents] of byClass) {
    // window-first (lower poolIndex = more relevant), stable for the rest.
    patents.sort((a, b) => a.poolIndex - b.poolIndex);
    const subgroups = Array.from(
      new Set(
        patents.flatMap((p) => p.ipc.filter((c) => c.split("/")[0] === mainGroup))
      )
    ).sort();
    classes.push({
      mainGroup,
      label: ipcMainGroupLabel(mainGroup),
      patents,
      total: patents.length,
      closeCount: patents.filter((p) => p.inWindow).length,
      subgroups,
    });
  }

  // Relevance-density sort: classes with more in-window ("close") hits first, then
  // larger classes; ties broken by code for stable, deterministic ordering.
  classes.sort(
    (a, b) =>
      b.closeCount - a.closeCount ||
      b.total - a.total ||
      a.mainGroup.localeCompare(b.mainGroup)
  );

  return {
    classes,
    unclassified,
    totalPatents: pool.filter((p) => p?.id).length,
  };
}

/**
 * Jump/filter: every pool patent matching `classCode` by ANY IPC code (ТЗ §4.2),
 * preserving pool (relevance) order. Used by the class-jump navigation.
 */
export function patentsInClass(
  pool: FieldPatentInput[],
  rankedCount: number,
  classCode: string
): FieldPatent[] {
  const out: FieldPatent[] = [];
  pool.forEach((raw, i) => {
    if (!raw?.id) return;
    if (patentMatchesClass(raw, classCode)) {
      out.push(toFieldPatent(raw, i, rankedCount));
    }
  });
  return out;
}

/** In-class display split: the first `k` (already window-first sorted) are the
 *  pinned highlight; the rest are revealed by "show more" (ТЗ §4.3 — the full
 *  class is ALWAYS expandable, the cap is never a wall). */
export function splitHighlight<T>(patents: T[], k = 15): { top: T[]; rest: T[] } {
  return { top: patents.slice(0, k), rest: patents.slice(k) };
}

export const FIELD_HIGHLIGHT_K = 15;
