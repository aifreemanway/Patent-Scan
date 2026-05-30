// Sample literature review: PEM and alkaline electrolyzers (B2B SEO-driven topic).

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  stage1, stage2, stage3to8, stage7VerifySources, harvestToSources,
} from "../../src/worker/literature-review/stages";
import { renderReportMarkdown } from "../../src/worker/literature-review/markdown";
import type { LitReviewParams } from "../../src/lib/literature-review/types";

const PARAMS: LitReviewParams = {
  topic:
    "Электролизеры для производства водорода (PEM и щёлочные): мировые производители, эффективность, мощностные диапазоны, стоимость 2020-2026. Особенно интересуют развитие в РФ и КНР, гос.программа водородной энергетики, ключевые игроки (Nel Hydrogen, ITM Power, Plug Power, Cummins/Hydrogenics, Siemens, российские проекты).",
  industry: "energy",
  regions: ["RU", "CIS", "CN", "US", "EU", "WORLD"],
  periodFrom: 2020,
  periodTo: 2026,
  hypotheses:
    "Гипотеза: ЕС и Китай лидируют в установленных мощностях, США наращивают через IRA, в РФ — на уровне пилотных проектов (Газпром, Росатом, Северсталь). PEM-технология растёт быстрее щёлочной, но щёлочная остаётся дешевле. Хочу оценить технологический разрыв и понять структуру конкуренции.",
};

const SLUG = "hydrogen-electrolyzers";

async function main() {
  const apiKey = process.env.TIMEWEB_AI_KEY;
  if (!apiKey) { console.error("Missing TIMEWEB_AI_KEY"); process.exit(1); }

  console.log(`[poc:${SLUG}] Stage 1: query expansion`);
  const s1 = await stage1(apiKey, PARAMS);
  console.log(`  ${s1.queriesRu.length} RU + ${s1.queriesEn.length} EN queries`);

  console.log(`[poc:${SLUG}] Stage 2: harvesting`);
  const harvest = await stage2(PARAMS, s1);
  console.log(`  patents=${harvest.patents.length} scholar=${harvest.scholar.length} web=${harvest.web.length} wiki=${harvest.wiki.length}`);

  console.log(`[poc:${SLUG}] Stage 3-8: synthesis`);
  const { sources, snippets } = harvestToSources(harvest);
  const report = await stage3to8(apiKey, PARAMS, sources, snippets);

  console.log(`[poc:${SLUG}] Stage 7: verifying sources`);
  report.sources = await stage7VerifySources(report.sources);
  const reachable = report.sources.filter((s) => s.reachedAt !== null).length;
  console.log(`  ${reachable}/${report.sources.length} reachable`);

  const md = renderReportMarkdown(report);
  const outPath = resolve(`scripts/poc-gates/out/sample-${SLUG}-2026-05-30.md`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, md, "utf-8");
  console.log(`[poc:${SLUG}] wrote ${outPath} (${md.length} bytes)`);
  console.log(`[poc:${SLUG}] tables=${report.comparativeTables.length} tech=${report.technologies.length} concl=${report.conclusions.length} caveats=${report.caveats.length}`);
}

main().catch((e) => { console.error(`[poc:${SLUG}] fatal`, e); process.exit(1); });
