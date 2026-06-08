/**
 * T1 recall re-test — P2 v2 (recall redesign: facets + depth + subgroup enum).
 *
 * Запуск (LOCAL dev, нужен TIMEWEB_AI_KEY + PATSEARCH_TOKEN в .env.local):
 *   npx tsx scripts/t1-recall-test-v2.ts
 *   T1_DEPTH=lite npx tsx scripts/t1-recall-test-v2.ts   # сравнить с быстрым тиром
 *
 * EMM-кейс (СамГТУ), КОНФИДЕНЦИАЛЬНО — не публиковать, не коммитить эталон.
 * cofounder hard-gate (2026-06-03):
 *   • RU2854805 ДОЛЖЕН войти в ПУЛ (сейчас вообще не извлекается — доказательство
 *     что глубина заработала).
 *   • RU2799985 — в РАНЖИРОВАННОМ ОКНЕ.
 *   • union материально вверх (кратно, не 1/32). 18/32 НЕ хард на парафразе —
 *     финальный verdict только на точном входе Самары.
 */

import { readFileSync } from "fs";
import {
  retrieveNoveltyPriorArt,
  type RetrievalDepth,
} from "../src/lib/novelty-retrieval-v2";
import { ETALON_IDS, HARD_GATE, INPUT_A } from "./samara-fixture";

const BASE = process.env.T1_BASE ?? "http://localhost:3000";
const DEPTH = (process.env.T1_DEPTH as RetrievalDepth) ?? "full";
const SESSION_FILE = "C:\\Users\\kobzar\\AppData\\Local\\Temp\\qa_session_token.txt";

// Вход теста: A (best-case) по умолчанию, либо B через файл (SAMARA_DESC_FILE).
// Эталон/хард-гейт — из samara-fixture (реальный набор СамГТУ).
const EMM_DESCRIPTION = process.env.SAMARA_DESC_FILE
  ? readFileSync(process.env.SAMARA_DESC_FILE, "utf-8").trim()
  : INPUT_A;
const INPUT_LABEL = process.env.SAMARA_DESC_FILE ? "B (file)" : "A (best-case)";

const RED_LINE_IDS = HARD_GATE;

function normalizeId(raw: string): string {
  return raw
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/_\d{8}$/, "")
    .replace(/[A-Z]\d*$/, "")
    .trim();
}

async function main() {
  let sessionToken: string;
  try {
    sessionToken = readFileSync(SESSION_FILE, "utf-8").trim();
  } catch {
    console.error("ERROR: Session token file not found:", SESSION_FILE);
    console.error("Run the PowerShell QA-login step first to save the session token.");
    process.exit(1);
  }

  const fetchWithAuth: typeof fetch = (input, init = {}) => {
    const headers = new Headers((init as RequestInit).headers ?? {});
    headers.set("Cookie", `sb-ycwtxilrkswlzjhvyiea-auth-token=${sessionToken}`);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetch(input, { ...(init as RequestInit), headers });
  };

  console.log("=== T1 recall — v2 (recall-v2-hold) · САМАРА эталон ===");
  console.log(`Base: ${BASE}  Depth: ${DEPTH}`);
  console.log(`Input: ${INPUT_LABEL}  ·  Эталон: ${ETALON_IDS.size} док.`);
  console.log(`Description: ${EMM_DESCRIPTION.length} chars`);
  console.log("Starting full retrieval...\n");

  const t0 = Date.now();
  const result = await retrieveNoveltyPriorArt({
    description: EMM_DESCRIPTION,
    base: BASE,
    fetchImpl: fetchWithAuth,
    depth: DEPTH,
    traceIds: [...ETALON_IDS], // localise where each etalon falls per stage
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const { hits, total, diagnostics } = result;
  // result.hits = the WHOLE pool, reordered so the ranked window is first.
  // diagnostics.ranked = size of the ranked window (the close-аналоги list).
  const windowSize = diagnostics.ranked || hits.length;
  const poolIds = hits.map((h) => normalizeId(h.id));
  const windowIds = poolIds.slice(0, windowSize);

  console.log(`\n=== RESULTS (${elapsed}s) ===`);
  console.log(`Total PatSearch hits seen: ${total}`);
  console.log(`Pool size (result.hits): ${hits.length}`);
  console.log(`Ranked window size: ${windowSize}`);
  const { trace, ...diagNoTrace } = diagnostics;
  console.log(`diagnostics: ${JSON.stringify(diagNoTrace, null, 2)}`);

  console.log("\n=== RED-LINE CHECK ===");
  let redLinePassed = true;
  // RU2854805 → must be in POOL. RU2799985 → must be in WINDOW.
  for (const target of RED_LINE_IDS) {
    const poolIdx = poolIds.indexOf(target);
    const winIdx = windowIds.indexOf(target);
    const inPool = poolIdx >= 0;
    const inWindow = winIdx >= 0;
    const gate = target === "RU2854805" ? "POOL" : "WINDOW";
    const ok = gate === "POOL" ? inPool : inWindow;
    if (!ok) redLinePassed = false;
    console.log(
      `  ${ok ? "✓" : "✗"} ${target} [gate=${gate}] — ` +
        `pool=${inPool ? `#${poolIdx + 1}` : "MISS"}, ` +
        `window=${inWindow ? `#${winIdx + 1}` : "MISS"}`
    );
  }

  const unionPool = poolIds.filter((id) => ETALON_IDS.has(id));
  const unionWindow = windowIds.filter((id) => ETALON_IDS.has(id));
  const denom = ETALON_IDS.size;
  console.log("\n=== UNION CHECK ===");
  console.log(`Etalon in POOL:   ${unionPool.length}/${denom} — ${unionPool.join(", ") || "(none)"}`);
  console.log(`Etalon in WINDOW: ${unionWindow.length}/${denom} — ${unionWindow.join(", ") || "(none)"}`);

  // ── GATE-TRACE table ── per-stage localisation of every etalon id. Shows the
  // EXACT stage a recall miss happens: retrieve (sem/fac), sweep-targeting
  // (sweep/seed), or LLM-rank (pR/bR/win). idx values are 0-based; "—" = absent.
  if (trace) {
    const fmt = (n: number) => (n < 0 ? "—" : String(n));
    const bestSweep = (units: { key: string; idx: number }[]) =>
      units.length
        ? units.reduce((a, b) => (b.idx < a.idx ? b : a)).key.replace(/^[gs]:/, "") +
          ":" +
          units.reduce((a, b) => (b.idx < a.idx ? b : a)).idx
        : "—";
    console.log("\n=== GATE-TRACE (per etalon, per stage; idx 0-based, —=absent) ===");
    console.log("  id          ipc0       sem  fac  sweep(unit:idx)  seed  pool  pRank bRank  WIN");
    const order = [...ETALON_IDS].sort((a, b) => {
      const ga = RED_LINE_IDS.includes(a) ? 0 : 1;
      const gb = RED_LINE_IDS.includes(b) ? 0 : 1;
      if (ga !== gb) return ga - gb;
      return (trace[b]?.poolIdx ?? -1) >= 0 ? 1 : -1;
    });
    for (const id of order) {
      const tr = trace[id];
      if (!tr) continue;
      const tag = RED_LINE_IDS.includes(id) ? "*" : " ";
      const ipc0 = (tr.ipc?.[0] ?? "—").padEnd(9).slice(0, 9);
      console.log(
        `  ${tag}${id.padEnd(11)} ${ipc0} ` +
          `${fmt(tr.semanticIdx).padStart(4)} ${fmt(tr.facetIdx).padStart(4)}  ` +
          `${bestSweep(tr.sweepUnits).padEnd(15)} ${fmt(tr.prioritySeedIdx).padStart(4)} ` +
          `${fmt(tr.poolIdx).padStart(5)} ${fmt(tr.priorityRankedIdx).padStart(5)} ` +
          `${fmt(tr.broadRankedIdx).padStart(5)} ${fmt(tr.windowIdx).padStart(4)}`
      );
    }
    console.log("  (* = hard-gate · sem/fac=semantic/facet pool · seed=in-class precision seed · WIN=ranked window)");
  }

  console.log("\n=== WINDOW (first 40) ===");
  hits.slice(0, 40).forEach((h, i) => {
    const nid = normalizeId(h.id);
    const tag = RED_LINE_IDS.includes(nid)
      ? " [RED-LINE]"
      : ETALON_IDS.has(nid)
        ? " [etalon]"
        : "";
    const marker = i < windowSize ? " " : "·"; // · = below ranked window
    console.log(`  ${marker}${String(i + 1).padStart(3)}. ${h.id}${tag} — ${(h.title ?? h.titleRu ?? "").slice(0, 56)}`);
  });

  console.log("\n=== VERDICT (interim, paraphrase) ===");
  console.log(`  Red-line gates (RU2854805∈pool & RU2799985∈window): ${redLinePassed ? "PASS" : "FAIL"}`);
  console.log(`  Union pool ${unionPool.length}/${denom}, window ${unionWindow.length}/${denom} (baseline was 1/32)`);
  console.log("  (18/32 НЕ хард на парафразе; финал — на точном входе Самары)");
  process.exit(redLinePassed ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
