// Sample literature review: monoclonal antibody biosimilars (rituximab, trastuzumab, bevacizumab).
// FINAL THEME v4 from ap-marketing — third sample.

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
    "Производство биосимиляров моноклональных антител класса IgG (ритуксимаб, трастузумаб, бевацизумаб): технологии (клеточные линии CHO, ферментёрный синтез, нисходящая очистка хроматографией, виро-инактивация), мировые производители биосимиляров, регуляторные пути регистрации (EMA, FDA, EAC, NMPA), пейзаж 2020-2026.",
  industry: "biotech",
  regions: ["RU", "CIS", "CN", "US", "EU", "WORLD"],
  periodFrom: 2020,
  periodTo: 2026,
  hypotheses:
    "Гипотеза: рынок биосимиляров MAB IgG быстро растёт после истечения патентов на оригинаторов (Rituxan/MabThera, Herceptin, Avastin); индийские (Biocon), южнокорейские (Celltrion, Samsung Bioepis), европейские (Sandoz) и российские (Биокад, Р-Фарм) игроки задают темп; китайские производители (Innovent, Mabworks) тоже активны. Хочу проверить структуру индустрии и понять разрыв технологий downstream-processing между ведущими и российскими/китайскими производителями.",
};

const SLUG = "mab-biosimilars";

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
  const report = await stage3to8(apiKey, PARAMS, sources, snippets);

  console.log(`[poc:${SLUG}] Stage 7: verifying sources`);
  report.sources = (await stage7VerifySources(report.sources)).sources;
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
