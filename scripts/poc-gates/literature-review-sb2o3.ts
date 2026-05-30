// POC quality-gate script for the literature-review pipeline.
// Spec: Antepatent/specs/literature-review-spec-2026-05-30.md §8.
//
// Runs the full Stage 1–9 pipeline against the NORD Sb₂O₃ topic and writes the
// markdown report to stdout + scripts/poc-gates/out/. Then evaluates the spec's
// six quality gates and prints PASS/FAIL.
//
// Run locally:  `npm run poc:literature-review-sb2o3`
// Requires .env.local with TIMEWEB_AI_KEY + PATSEARCH_TOKEN + TAVILY_API_KEY.

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  stage1,
  stage2,
  stage3to8,
  stage7VerifySources,
  harvestToSources,
} from "../../src/worker/literature-review/stages";
import { renderReportMarkdown } from "../../src/worker/literature-review/markdown";
import type { LitReviewParams } from "../../src/lib/literature-review/types";

const PARAMS: LitReviewParams = {
  topic:
    "Технологии переработки сурьмы (Sb₂O₃): производители, оборудование, патентная картина в РФ и КНР за 2015-2026 годы. Особенно интересуют пирометаллургические и гидрометаллургические методы получения триоксида сурьмы из сурьмосодержащего сырья.",
  industry: "metallurgy",
  regions: ["RU", "CN", "WORLD"],
  periodFrom: 2015,
  periodTo: 2026,
  hypotheses:
    "Гипотеза: Китай доминирует на мировом рынке Sb₂O₃; в РФ есть единичные перерабатывающие предприятия. Хочу проверить структуру отрасли + оценить технологический gap.",
};

async function main() {
  const apiKey = process.env.TIMEWEB_AI_KEY;
  if (!apiKey) {
    console.error("Missing TIMEWEB_AI_KEY in .env.local");
    process.exit(1);
  }

  console.log("[poc] Stage 1: query expansion");
  const s1 = await stage1(apiKey, PARAMS);
  console.log(`  generated ${s1.queriesRu.length} RU + ${s1.queriesEn.length} EN queries`);

  console.log("[poc] Stage 2: harvesting");
  const harvest = await stage2(PARAMS, s1);
  console.log(
    `  patents=${harvest.patents.length} scholar=${harvest.scholar.length} web=${harvest.web.length} wiki=${harvest.wiki.length}`
  );

  console.log("[poc] Stage 3-8: synthesis");
  const { sources, snippets } = harvestToSources(harvest);
  const report = await stage3to8(apiKey, PARAMS, sources, snippets);

  console.log("[poc] Stage 7: verifying source URLs");
  report.sources = await stage7VerifySources(report.sources);
  const reachable = report.sources.filter((s) => s.reachedAt !== null).length;
  console.log(`  ${reachable}/${report.sources.length} sources reachable`);

  console.log("[poc] Stage 9: rendering markdown");
  const md = renderReportMarkdown(report);

  const outPath = resolve("scripts/poc-gates/out/literature-review-sb2o3.md");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, md, "utf-8");
  console.log(`[poc] wrote ${outPath} (${md.length} bytes)`);

  // ── Spec §8 quality gates ─────────────────────────────────
  const gates = {
    sources: report.sources.length >= 20,
    tables: report.comparativeTables.length >= 4,
    tablesFilled: report.comparativeTables.every((t) =>
      t.rows.length === 0
        ? false
        : t.rows.filter((r) => r.cells.filter((c) => c && c !== "—").length >= 0.7 * r.cells.length).length /
            t.rows.length >=
          0.7
    ),
    technologies: report.technologies.length >= 8,
    conclusions: report.conclusions.length >= 5,
    caveats: report.caveats.length >= 1,
    sourcesReachable: reachable / Math.max(report.sources.length, 1) >= 0.8,
  };

  console.log("\n[poc] quality gates:");
  for (const [k, v] of Object.entries(gates)) {
    console.log(`  ${v ? "✅" : "❌"} ${k}`);
  }
  const passed = Object.values(gates).filter(Boolean).length;
  console.log(`\n[poc] ${passed}/${Object.keys(gates).length} gates passed`);

  // Manual gate: compare against NORD Sb₂O₃ PDF (14 enterprises) — Vsevolod
  // does this by hand once he reviews the output. Print enterprise candidates
  // from the report to make that easier.
  const enterpriseHints = new Set<string>();
  for (const t of report.comparativeTables) {
    for (const c of t.columns.slice(1)) enterpriseHints.add(c);
  }
  console.log(
    `\n[poc] enterprise candidates in tables (${enterpriseHints.size}): ${[...enterpriseHints]
      .slice(0, 20)
      .join(", ")}`
  );

  if (passed < 5) {
    console.error("\n[poc] FAIL — fewer than 5/7 gates passed. Do not ship PR-3 yet.");
    process.exit(1);
  }
  console.log("\n[poc] PASS — minimum gate threshold met. Manual NORD-PDF comparison still required.");
}

main().catch((e) => {
  console.error("[poc] fatal", e);
  process.exit(1);
});
