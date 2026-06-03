// Regression harness for the novelty prior-art accuracy beta-blocker.
//
// Acceptance (beta-tz §8.2): the NORD water-cooled copper caisson case must
// reliably surface the international analogs US6322610 + US4572482 in the
// analyze window. This drives the REAL retrieval lib (retrieveNoveltyPriorArt)
// against a running dev server, so it can't drift from what the UI ships.
//
// Run:  cd web && npm run dev            (separate terminal, loads .env.local)
//       npx tsx scripts/regression-nord-kesson.ts
// Env:  BASE_URL (default http://localhost:3000)
//       RUNS     (default 3)
//       SLEEP_MS (default 65000 — clears the per-IP rate-limit window between runs)
//
// AUTH (B1): the internal routes (landscape/plan, landscape/search,
// prior-art-rank) are now behind requireAuth, so the harness must present a
// session cookie or every call 401s. Drop a Supabase session token into
// SESSION_FILE (same as t1-recall-test.ts) and we inject it on every fetch:
//   • locally: start dev, then hit /api/qa-preview-login on a preview to mint a
//     token, or paste an existing qa-team session token into the file.
//   • the token is the value of the `sb-<ref>-auth-token` cookie.

import { readFileSync } from "fs";
import { retrieveNoveltyPriorArt, type PatentHit } from "../src/lib/novelty-retrieval.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const RUNS = Number(process.env.RUNS ?? 3);
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 65_000);
const ANALYZE_WINDOW = 60; // MAX_PATENTS_ANALYZE — patents the judge actually sees.
const SESSION_FILE =
  process.env.QA_SESSION_FILE ??
  "C:\\Users\\kobzar\\AppData\\Local\\Temp\\qa_session_token.txt";

// Auth-injecting fetch — attaches the Supabase session cookie to every internal
// call so requireAuth passes. Falls back to plain fetch if the token file is
// missing (the run will then 401 and surface that clearly rather than silently).
function makeFetch(): typeof fetch {
  let token = "";
  try {
    token = readFileSync(SESSION_FILE, "utf-8").trim();
  } catch {
    console.warn(
      `[regression] no session token at ${SESSION_FILE} — internal routes will 401. ` +
        `Mint one via /api/qa-preview-login and save it there.`
    );
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

// Must land in the analyze window for the verdict to be honest.
const TARGETS = ["US6322610", "US4572482"];
// Tracked but not gating — known long-tail residuals worth watching.
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

type RunOutcome = {
  ok: boolean;
  total: number;
  poolSemantic: number;
  poolSweep: number;
  ranked: number;
  topGroups: string[];
  positions: Record<string, number>;
  inWindow: Record<string, boolean>;
};

async function oneRun(): Promise<RunOutcome> {
  const { hits, total, diagnostics } = await retrieveNoveltyPriorArt({
    description: DESCRIPTION,
    base: BASE_URL,
    fetchImpl: fetchWithAuth,
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
    poolSemantic: diagnostics.poolSemantic,
    poolSweep: diagnostics.poolSweep,
    ranked: diagnostics.ranked,
    topGroups: diagnostics.topGroups,
    positions,
    inWindow,
  };
}

function fmt(target: string, o: RunOutcome): string {
  const pos = o.positions[target];
  const tag = pos < 0 ? "MISS" : o.inWindow[target] ? `#${pos + 1}` : `#${pos + 1} (out)`;
  return `${target}=${tag}`;
}

async function main() {
  console.log(`[regression] NORD caisson — ${RUNS} run(s) against ${BASE_URL}`);
  console.log(`[regression] gate: ${TARGETS.join(" + ")} both in top-${ANALYZE_WINDOW}\n`);

  const outcomes: RunOutcome[] = [];
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`run ${i + 1}/${RUNS} ... `);
    try {
      const o = await oneRun();
      outcomes.push(o);
      const tline = TARGETS.map((t) => fmt(t, o)).join("  ");
      const wline = WATCH.map((t) => fmt(t, o)).join("  ");
      console.log(o.ok ? "PASS" : "FAIL");
      console.log(
        `   pool sem=${o.poolSemantic} sweep=${o.poolSweep} ranked=${o.ranked} total=${o.total}`
      );
      console.log(`   groups=[${o.topGroups.join(", ")}]`);
      console.log(`   gate:  ${tline}`);
      console.log(`   watch: ${wline}`);
    } catch (e) {
      console.log("ERROR");
      console.log(`   ${e instanceof Error ? e.message : String(e)}`);
    }
    if (i < RUNS - 1) await sleep(SLEEP_MS);
  }

  const passes = outcomes.filter((o) => o.ok).length;
  console.log(`\n[regression] PASS ${passes}/${outcomes.length} runs`);
  for (const t of TARGETS) {
    const hit = outcomes.filter((o) => o.inWindow[t]).length;
    console.log(`   ${t}: in-window ${hit}/${outcomes.length}`);
  }
  process.exit(passes === outcomes.length && outcomes.length === RUNS ? 0 : 1);
}

main();
