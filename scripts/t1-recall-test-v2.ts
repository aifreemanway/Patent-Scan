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

const BASE = process.env.T1_BASE ?? "http://localhost:3000";
const DEPTH = (process.env.T1_DEPTH as RetrievalDepth) ?? "full";
const SESSION_FILE = "C:\\Users\\kobzar\\AppData\\Local\\Temp\\qa_session_token.txt";

// EMM-описание (СамГТУ, КОНФИДЕНЦИАЛЬНО)
const EMM_DESCRIPTION = `Модуль контроля электродвигателей EMM для непрерывного мониторинга технического состояния трёхфазных асинхронных электродвигателей напряжением 0,4 кВ методом анализа сигнатуры тока (MCSA). Устройство включает микроконтроллер STM32F407, аналого-цифровой преобразователь с разрядностью 12 бит и частотой дискретизации 10 кГц, интерфейс RS-485, протокол обмена MODBUS RTU, питание 24В DC. Система обнаруживает дефекты подшипников, обрывы стержней ротора, межвитковые замыкания статора по гармоническому составу спектра тока. Алгоритм MCSA выполняет спектральный анализ мгновенных значений тока в режиме реального времени и сравнивает полученные гармоники с пороговыми значениями для классификации типа и степени дефекта. Устройство также включает защитную функцию отключения двигателя при обнаружении критического дефекта.`;

// Эталонный набор СамГТУ (32 патента). КОНФИДЕНЦИАЛЬНО.
const ETALON_IDS = new Set([
  "RU2854805", "RU2799985", "RU2781595", "RU2769378", "RU2769369",
  "RU2764774", "RU2758826", "RU2756916", "RU2755800", "RU2752085",
  "RU2748410", "RU2747267", "RU2745395", "RU2738628", "RU2737534",
  "RU2729765", "RU2727559", "RU2727203", "RU2723691", "RU2723444",
  "RU2715371", "RU2710834", "RU2707697", "RU2706058", "RU2703490",
  "RU2701508", "RU2699047", "RU2695939", "RU2694809", "RU2687951",
  "RU2686440", "RU2685094",
]);

const RED_LINE_IDS = ["RU2854805", "RU2799985"];

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

  console.log("=== T1 recall re-test — P2 v2 (facets + depth + subgroup enum) ===");
  console.log(`Base: ${BASE}  Depth: ${DEPTH}`);
  console.log(`Description: ${EMM_DESCRIPTION.length} chars`);
  console.log("Starting full retrieval...\n");

  const t0 = Date.now();
  const result = await retrieveNoveltyPriorArt({
    description: EMM_DESCRIPTION,
    base: BASE,
    fetchImpl: fetchWithAuth,
    depth: DEPTH,
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
  console.log(`diagnostics: ${JSON.stringify(diagnostics, null, 2)}`);

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
  console.log("\n=== UNION CHECK ===");
  console.log(`Etalon in POOL:   ${unionPool.length}/32 — ${unionPool.join(", ") || "(none)"}`);
  console.log(`Etalon in WINDOW: ${unionWindow.length}/32 — ${unionWindow.join(", ") || "(none)"}`);

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
  console.log(`  Union pool ${unionPool.length}/32, window ${unionWindow.length}/32 (baseline was 1/32)`);
  console.log("  (18/32 НЕ хард на парафразе; финал — на точном входе Самары)");
  process.exit(redLinePassed ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
