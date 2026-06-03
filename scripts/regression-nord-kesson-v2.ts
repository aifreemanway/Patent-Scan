// Caisson regression against the P2 v2 retrieval (recall redesign).
//
// cofounder VALIDATION must-have (2026-06-03): the v2 redesign MUST NOT break
// existing recall. This mirrors regression-nord-kesson.ts but drives the v2 lib
// at depth="full". Gate unchanged: US6322610 + US4572482 both in the analyze
// window (top-60).
//
// Run:  cd web && npm run dev            (separate terminal, loads .env.local)
//       npx tsx scripts/regression-nord-kesson-v2.ts
// Env:  BASE_URL (default http://localhost:3000), RUNS (default 1),
//       T1_DEPTH (default full), SLEEP_MS (default 65000 between runs).

import { readFileSync } from "fs";
import {
  retrieveNoveltyPriorArt,
  type PatentHit,
  type RetrievalDepth,
} from "../src/lib/novelty-retrieval-v2.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const RUNS = Number(process.env.RUNS ?? 1);
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 65_000);
const DEPTH = (process.env.T1_DEPTH as RetrievalDepth) ?? "full";
const ANALYZE_WINDOW = 60;
const SESSION_FILE =
  process.env.QA_SESSION_FILE ??
  "C:\\Users\\kobzar\\AppData\\Local\\Temp\\qa_session_token.txt";

function makeFetch(): typeof fetch {
  let token = "";
  try {
    token = readFileSync(SESSION_FILE, "utf-8").trim();
  } catch {
    console.warn(`[regression-v2] no session token at ${SESSION_FILE} — routes will 401.`);
  }
  if (!token) return fetch;
  return ((input, init = {}) => {
    const headers = new Headers((init as RequestInit).headers ?? {});
    headers.set("Cookie", `sb-ycwtxilrkswlzjhvyiea-auth-token=${token}`);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetch(input, { ...(init as RequestInit), headers });
  }) as typeof fetch;
}

const fetchWithAuth = makeFetch();

const DESCRIPTION =
  "Водоохлаждаемый медный кессон с двумя отверстиями под фурмы с подачей " +
  "кислородно-воздушной смеси или вдувания материала непосредственно в расплав.";

const TARGETS = ["US6322610", "US4572482"];
const WATCH = ["CN210486521U", "US4693274", "EA6910B1"];

function findPos(hits: PatentHit[], target: string): number {
  const cc = target.slice(0, 2).toUpperCase();
  const num = target.replace(/\D/g, "");
  return hits.findIndex((h) => {
    const idU = (h.id ?? "").toUpperCase();
    return idU.startsWith(cc) && idU.replace(/\D/g, "").includes(num);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function oneRun() {
  const { hits, total, diagnostics } = await retrieveNoveltyPriorArt({
    description: DESCRIPTION,
    base: BASE_URL,
    fetchImpl: fetchWithAuth,
    depth: DEPTH,
  });
  const positions: Record<string, number> = {};
  const inWindow: Record<string, boolean> = {};
  for (const t of [...TARGETS, ...WATCH]) {
    const pos = findPos(hits, t);
    positions[t] = pos;
    inWindow[t] = pos >= 0 && pos < ANALYZE_WINDOW;
  }
  return {
    ok: TARGETS.every((t) => inWindow[t]),
    total,
    facetCount: diagnostics.facetCount,
    poolSemantic: diagnostics.poolSemantic,
    poolFacet: diagnostics.poolFacet,
    poolSweep: diagnostics.poolSweep,
    ranked: diagnostics.ranked,
    topGroups: diagnostics.topGroups,
    enumeratedSubgroups: diagnostics.enumeratedSubgroups,
    paginatedSubclasses: diagnostics.paginatedSubclasses,
    positions,
    inWindow,
  };
}

async function main() {
  console.log(`[regression-v2] NORD caisson — depth=${DEPTH}, ${RUNS} run(s) against ${BASE_URL}`);
  console.log(`[regression-v2] gate: ${TARGETS.join(" + ")} both in top-${ANALYZE_WINDOW}\n`);

  let passes = 0;
  let done = 0;
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`run ${i + 1}/${RUNS} ... `);
    try {
      const o = await oneRun();
      done++;
      if (o.ok) passes++;
      const fmt = (t: string) => {
        const p = o.positions[t];
        return `${t}=${p < 0 ? "MISS" : o.inWindow[t] ? `#${p + 1}` : `#${p + 1}(out)`}`;
      };
      console.log(o.ok ? "PASS" : "FAIL");
      console.log(`   facets=${o.facetCount} sem=${o.poolSemantic} facetPool=${o.poolFacet} sweep=${o.poolSweep} ranked=${o.ranked} total=${o.total}`);
      console.log(`   groups=[${o.topGroups.join(", ")}]`);
      console.log(`   enumerated=[${o.enumeratedSubgroups.join(", ")}] paginated=[${o.paginatedSubclasses.join(", ")}]`);
      console.log(`   gate:  ${TARGETS.map(fmt).join("  ")}`);
      console.log(`   watch: ${WATCH.map(fmt).join("  ")}`);
    } catch (e) {
      console.log("ERROR");
      console.log(`   ${e instanceof Error ? e.message : String(e)}`);
    }
    if (i < RUNS - 1) await sleep(SLEEP_MS);
  }

  console.log(`\n[regression-v2] PASS ${passes}/${done} runs`);
  process.exit(passes === done && done === RUNS ? 0 : 1);
}

main();
