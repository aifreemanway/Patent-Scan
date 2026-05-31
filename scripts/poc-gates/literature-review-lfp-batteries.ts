// Sample literature review: LFP cathode batteries (B2B SEO-driven topic).
// Outputs to scripts/poc-gates/out/ — copy to Obsidian after run.
//   `npm run poc:literature-review-lfp`

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  stage1, stage2, stage3to8, stage7VerifySources, harvestToSources, applyRelevanceFilter,
} from "../../src/worker/literature-review/stages";
import { renderReportMarkdown } from "../../src/worker/literature-review/markdown";
import type { LitReviewParams } from "../../src/lib/literature-review/types";

const PARAMS: LitReviewParams = {
  topic:
    "Литий-железо-фосфатные (LFP) аккумуляторы: мировые производители катодного материала, технологии производства, размер ячеек, плотность энергии 2020-2026. Особенно интересуют CATL, BYD, Gotion, EVE Energy и российские разработки.",
  industry: "energy",
  regions: ["RU", "CIS", "CN", "US", "EU", "WORLD"],
  periodFrom: 2020,
  periodTo: 2026,
  hypotheses:
    "Гипотеза: Китай (CATL, BYD) доминирует в LFP-производстве с долей 70%+; EV-применения подняли спрос на 5-8x за 2020-2024; российские проекты в зачаточном состоянии. Интересует разрыв технологии и стоимости между лидерами и догоняющими.",
};

const SLUG = "lfp-batteries";

async function main() {
  const apiKey = process.env.TIMEWEB_AI_KEY;
  if (!apiKey) { console.error("Missing TIMEWEB_AI_KEY"); process.exit(1); }

  console.log(`[poc:${SLUG}] Stage 1: query expansion`);
  const s1 = await stage1(apiKey, PARAMS);
  console.log(`  ${s1.queriesRu.length} RU + ${s1.queriesEn.length} EN queries`);

  console.log(`[poc:${SLUG}] Stage 2: harvesting`);
  const harvest = await stage2(PARAMS, s1);
  console.log(`  patents=${harvest.patents.length} scholar=${harvest.scholar.length} web=${harvest.web.length} wiki=${harvest.wiki.length}`);

  console.log(`[poc:${SLUG}] Stage 3 prep: blacklist + relevance filter`);
  const initial = harvestToSources(harvest);
  console.log(`  blacklist dropped ${initial.blacklistedCount}, kept ${initial.sources.length}`);
  const filtered = await applyRelevanceFilter({ apiKey, topic: PARAMS.topic, sources: initial.sources, snippets: initial.snippets });
  console.log(`  relevance filter dropped ${filtered.droppedCount}, kept ${filtered.sources.length}`);
  if (filtered.droppedCount > 0) {
    console.log(`  reasons sample:`, [...filtered.droppedRefs.entries()].slice(0, 5));
  }

  console.log(`[poc:${SLUG}] Stage 3-8: synthesis`);
  const sources = filtered.sources;
  const snippets = filtered.snippets;
  const report = await stage3to8(
    apiKey, PARAMS, sources, snippets,
    process.env.TAVILY_API_KEY ?? "",
    s1.seedCompanies ?? []
  );

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
