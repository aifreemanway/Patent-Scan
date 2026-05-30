// POC for the literature-review pipeline on a NON-metallurgy topic.
// Verifies that PR-3.2's diversified prompts don't carry over Sb₂O₃ framing
// to unrelated domains. Run AFTER PR-3.2 deploy:
//   `npm run poc:literature-review-saas-videoconf`
//
// Same gates as the Sb₂O₃ POC (spec literature-review-spec-2026-05-30.md §8).

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
    "Сервисы видеоконференций для корпоративных пользователей: рынок, ключевые игроки, технологии и тренды 2020-2026. Особенно интересуют российские и международные платформы, развитие AI-функций (транскрипция, перевод, генерация summary), безопасность и приватность.",
  industry: "electronics",
  regions: ["RU", "CIS", "US", "EU", "WORLD"],
  periodFrom: 2020,
  periodTo: 2026,
  hypotheses:
    "Гипотеза: после 2022 российские заказчики смещаются на отечественные платформы (TrueConf, Webinar.ru, Яндекс.Телемост, VK Звонки) от международных (Zoom, MS Teams, Google Meet). AI-функции стали обязательной частью value prop. Хочу проверить структуру рынка + понять основные технологические разрывы между RU и global.",
};

async function main() {
  const apiKey = process.env.TIMEWEB_AI_KEY;
  if (!apiKey) {
    console.error("Missing TIMEWEB_AI_KEY in .env.local");
    process.exit(1);
  }

  console.log("[poc-saas] Stage 1: query expansion");
  const s1 = await stage1(apiKey, PARAMS);
  console.log(`  generated ${s1.queriesRu.length} RU + ${s1.queriesEn.length} EN queries`);

  console.log("[poc-saas] Stage 2: harvesting");
  const harvest = await stage2(PARAMS, s1);
  console.log(
    `  patents=${harvest.patents.length} scholar=${harvest.scholar.length} web=${harvest.web.length} wiki=${harvest.wiki.length}`
  );

  console.log("[poc-saas] Stage 3-8: synthesis");
  const { sources, snippets } = harvestToSources(harvest);
  const report = await stage3to8(apiKey, PARAMS, sources, snippets);

  console.log("[poc-saas] Stage 7: verifying source URLs");
  report.sources = await stage7VerifySources(report.sources);
  const reachable = report.sources.filter((s) => s.reachedAt !== null).length;
  console.log(`  ${reachable}/${report.sources.length} sources reachable`);

  console.log("[poc-saas] Stage 9: rendering markdown");
  const md = renderReportMarkdown(report);

  const outPath = resolve("scripts/poc-gates/out/literature-review-saas-videoconf.md");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, md, "utf-8");
  console.log(`[poc-saas] wrote ${outPath} (${md.length} bytes)`);

  const gates = {
    sources: report.sources.length >= 20,
    tables: report.comparativeTables.length >= 3,
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

  console.log("\n[poc-saas] quality gates:");
  for (const [k, v] of Object.entries(gates)) {
    console.log(`  ${v ? "OK" : "FAIL"} ${k}`);
  }
  const passed = Object.values(gates).filter(Boolean).length;
  console.log(`\n[poc-saas] ${passed}/${Object.keys(gates).length} gates passed`);

  // Show what the model picked as table columns — to spot-check that the axis
  // makes sense for a SaaS topic (should be platforms / regions / features —
  // NOT metallurgy framings like "method" or "ore").
  console.log("\n[poc-saas] table titles:");
  for (const t of report.comparativeTables) {
    console.log(`  - "${t.title}" | cols: ${t.columns.slice(0, 6).join(" / ")}`);
  }

  if (passed < 5) {
    console.error("\n[poc-saas] FAIL — fewer than 5/7 gates passed");
    process.exit(1);
  }
  console.log("\n[poc-saas] PASS — universality holds across domains");
}

main().catch((e) => {
  console.error("[poc-saas] fatal", e);
  process.exit(1);
});
