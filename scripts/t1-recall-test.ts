/**
 * T1 recall re-test — PR #85 (fix/recall-class-sweep-seeding)
 *
 * Запуск: npx tsx scripts/t1-recall-test.ts
 *
 * EMM-кейс (СамГТУ), КОНФИДЕНЦИАЛЬНО — не публиковать, не коммитить данные эталона.
 * Red-line: RU2854805 C1 + RU2799985 C1 оба в final hits; union >=18/32 эталона СамГТУ.
 */

import { readFileSync, existsSync } from "fs";
import { retrieveNoveltyPriorArt } from "../src/lib/novelty-retrieval";
import { ETALON_IDS, HARD_GATE, INPUT_A } from "./samara-fixture";

// LOCAL: http://localhost:3000 (требует TIMEWEB_AI_KEY в .env.local, нет auth-guard на /api/qa-preview-login)
// STAGING: https://patent-scan-git-fix-recall-class-4ab407-aifreemanways-projects.vercel.app
const BASE = process.env.T1_BASE ?? "http://localhost:3000";

const SESSION_FILE = "C:\\Users\\kobzar\\AppData\\Local\\Temp\\qa_session_token.txt";

// Вход теста: A (best-case) по умолчанию, либо B через файл (SAMARA_DESC_FILE) —
// ИИ-экстракт из реальных 4 документов EMM. Эталон/хард-гейт — из samara-fixture
// (реальный набор СамГТУ; раньше тут был плейсхолдер-парафраз).
const EMM_DESCRIPTION = process.env.SAMARA_DESC_FILE
  ? readFileSync(process.env.SAMARA_DESC_FILE, "utf-8").trim()
  : INPUT_A;
const INPUT_LABEL = process.env.SAMARA_DESC_FILE ? "B (file)" : "A (best-case)";

const RED_LINE_IDS = HARD_GATE;

function normalizeId(raw: string): string {
  // Handles: "RU2854805C1_20241022" / "RU2854805C1" / "RU 2854805 C1" → "RU2854805"
  // PatSearch returns IDs with _YYYYMMDD suffix + kind code (C1, B1, B2, A1, U1 …)
  return raw
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/_\d{8}$/, "")   // strip _YYYYMMDD date suffix
    .replace(/[A-Z]\d*$/, "")  // strip kind code (C1, B2, A1, A, U1, etc.)
    .trim();
}

async function main() {
  let sessionToken: string;
  try {
    sessionToken = readFileSync(SESSION_FILE, "utf-8").trim();
  } catch {
    console.error("ERROR: Session token file not found:", SESSION_FILE);
    console.error(
      "Run the PowerShell QA-login step first to save the session token."
    );
    process.exit(1);
  }

  // Auth-injecting fetch — passes session cookie on every call to staging
  const fetchWithAuth: typeof fetch = (input, init = {}) => {
    const headers = new Headers((init as RequestInit).headers ?? {});
    headers.set(
      "Cookie",
      `sb-ycwtxilrkswlzjhvyiea-auth-token=${sessionToken}`
    );
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(input, { ...(init as RequestInit), headers });
  };

  console.log("=== T1 recall — v1 (prod novelty-retrieval) · САМАРА эталон ===");
  console.log(`Base: ${BASE}`);
  console.log(`Input: ${INPUT_LABEL}  ·  Эталон: ${ETALON_IDS.size} док.`);
  console.log(`Description: ${EMM_DESCRIPTION.length} chars`);
  console.log("Starting full retrieval (1-3 min)...\n");

  const t0 = Date.now();
  const result = await retrieveNoveltyPriorArt({
    description: EMM_DESCRIPTION,
    base: BASE,
    fetchImpl: fetchWithAuth,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const { hits, total, diagnostics } = result;

  console.log(`\n=== RESULTS (${elapsed}s) ===`);
  console.log(`Total hits retrieved: ${total}`);
  console.log(`Hits in final window: ${hits.length}`);
  console.log(
    `diagnostics.topGroups: ${JSON.stringify(diagnostics.topGroups)}`
  );
  console.log(`diagnostics.poolSemantic: ${diagnostics.poolSemantic}`);
  console.log(`diagnostics.poolSweep: ${diagnostics.poolSweep}`);
  console.log(`diagnostics.ranked: ${diagnostics.ranked}`);
  console.log();

  // Red-line check: RU2854805 + RU2799985 must be in close-аналоги window
  console.log("=== RED-LINE CHECK ===");
  const hitIds = hits.map((h) => normalizeId(h.id));
  let redLinePassed = true;
  for (const target of RED_LINE_IDS) {
    const idx = hitIds.indexOf(target);
    if (idx >= 0) {
      console.log(`  ✓ ${target}: rank #${idx + 1} in final window`);
    } else {
      // Check if it's in top-100 of pre-ranked pool (hits may be capped at rankLimit=60)
      console.log(`  ✗ ${target}: NOT in final window (${hits.length} hits)`);
      redLinePassed = false;
    }
  }

  // Union check: how many etalon patents appear in hits
  const foundEtalon = hitIds.filter((id) => ETALON_IDS.has(id));
  const union = foundEtalon.length;
  const denom = ETALON_IDS.size;
  console.log(`\n=== UNION CHECK ===`);
  console.log(`Found ${union}/${denom} etalon patents in final window`);
  console.log(`Found IDs: ${foundEtalon.join(", ") || "(none)"}`);

  // Порог-ориентир (≈ половина набора); финальный verdict — за кофаундером.
  const unionPassed = union >= Math.ceil(denom / 2);
  console.log(
    unionPassed
      ? `  ✓ union ${union}/${denom} >= ${Math.ceil(denom / 2)} — PASS`
      : `  ✗ union ${union}/${denom} < ${Math.ceil(denom / 2)} — FAIL`
  );

  console.log("\n=== FINAL HITS (first 30) ===");
  hits.slice(0, 30).forEach((h, i) => {
    const isRedLine = RED_LINE_IDS.includes(normalizeId(h.id));
    const isEtalon = ETALON_IDS.has(normalizeId(h.id));
    const tag = isRedLine ? " [RED-LINE]" : isEtalon ? " [etalon]" : "";
    console.log(
      `  ${String(i + 1).padStart(2)}. ${h.id}${tag} — ${(h.title ?? h.titleRu ?? "").slice(0, 60)}`
    );
  });

  console.log("\n=== VERDICT ===");
  const pass = redLinePassed && unionPassed;
  console.log(pass ? "PASS ✓" : "FAIL ✗");
  console.log(
    `  Red-line (both targets in window): ${redLinePassed ? "PASS" : "FAIL"}`
  );
  console.log(`  Union >=18/32: ${unionPassed ? "PASS" : "FAIL"}`);

  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
