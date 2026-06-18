// Calibration batch — 4 metallurgy literature reviews, blind-run through the
// production v2.2 pipeline EXACTLY as if a user typed the topic into the
// /literature-review cabinet form. ZERO manual edits / enrichment (cofounder
// spec specs/2026-06-01-calibration-batch-spec.md). Output: HTML (self-
// contained, for Vsevolod) + markdown source (for ba head-to-head diff).
//
// Smoke protocol: run theme 1 (crude lead) FIRST. If it HARD-errors (throws,
// or harvests 0 sources) → STOP + escalate (don't burn the batch on a break).
// If theme 1 technically completes → run all 4 with NO tuning between runs.
// Smoke is about hard-error ONLY, not quality (quality = ba head-to-head later).

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
  applyRelevanceFilter,
} from "../../src/worker/literature-review/stages";
import { renderReportMarkdown } from "../../src/worker/literature-review/markdown";
import { renderReportHtml } from "../../src/lib/literature-review/render-html";
import type { LitReviewParams } from "../../src/lib/literature-review/types";

// Run date is parameterized so the banner + filenames don't go stale on reruns.
// Override with CALIB_DATE=YYYY-MM-DD; defaults to today.
const RUN_DATE = process.env.CALIB_DATE ?? new Date().toISOString().slice(0, 10);
const CALIB_BANNER =
  `Калибровочный прогон пайплайна (v2.2) — сырой автоматический вывод, ${RUN_DATE}.`;

// Themes verbatim from the spec §2 (as a client would type them).
const THEMES: Array<{ slug: string; topic: string }> = [
  {
    slug: "crude-lead-smelting",
    topic: "Обзор мировых технологий получения чернового свинца из свинецсодержащего сырья",
  },
  {
    slug: "copper-slag-depletion",
    topic: "Обзор и анализ технологий обеднения медных шлаков",
  },
  {
    slug: "cu-ni-matte-fineshtein",
    topic: "Данные мировых технологий получения файнштейна из сульфидного медно-никелевого сырья",
  },
  {
    slug: "direct-to-blister-copper",
    topic: "Обзор и анализ мировых технологий прямой плавки на черновую медь",
  },
];

// Intake exactly as the cabinet form would submit it for a "world technologies"
// metallurgy review: industry=metallurgy, world-spanning regions, the form's
// default period (2010–CURRENT), NO hypotheses (a user submitting just a topic —
// 0 enrichment per the spec's hard rule).
function paramsFor(topic: string): LitReviewParams {
  return {
    topic,
    industry: "metallurgy",
    regions: ["RU", "CIS", "CN", "EU", "US", "WORLD"],
    periodFrom: 2010,
    periodTo: 2026,
    // hypotheses intentionally omitted — raw topic-only submission.
  };
}

const OUT_DIR = "scripts/poc-gates/out";

async function runOne(
  apiKey: string,
  theme: { slug: string; topic: string }
): Promise<{ sources: number; techs: number; tables: number; patents: number }> {
  const params = paramsFor(theme.topic);
  const tag = `calib:${theme.slug}`;

  console.log(`\n========== ${tag} ==========`);
  console.log(`[${tag}] Stage 1: query expansion`);
  const s1 = await stage1(apiKey, params);
  console.log(`  ${s1.queriesRu.length} RU + ${s1.queriesEn.length} EN queries, seedCompanies=${(s1.seedCompanies ?? []).length}`);

  console.log(`[${tag}] Stage 2: harvesting`);
  const harvest = await stage2(params, s1);
  console.log(`  patents=${harvest.patents.length} scholar=${harvest.scholar.length} web=${harvest.web.length} wiki=${harvest.wiki.length}`);

  console.log(`[${tag}] Stage 3 prep: blacklist + relevance filter`);
  const initial = harvestToSources(harvest);
  console.log(`  blacklist dropped ${initial.blacklistedCount}, kept ${initial.sources.length}`);
  if (initial.sources.length === 0) {
    throw new Error(`HARD: 0 sources harvested for «${theme.topic}» — pipeline non-deliverable`);
  }
  const filtered = await applyRelevanceFilter({
    apiKey,
    topic: params.topic,
    sources: initial.sources,
    snippets: initial.snippets,
  });
  console.log(`  relevance filter dropped ${filtered.droppedCount}, kept ${filtered.sources.length}`);
  if (filtered.sources.length === 0) {
    throw new Error(`HARD: 0 sources after relevance filter for «${theme.topic}»`);
  }

  console.log(`[${tag}] Stage 3-8: synthesis (+ source-augmentation)`);
  const report = await stage3to8(
    apiKey,
    params,
    filtered.sources,
    filtered.snippets,
    process.env.TAVILY_API_KEY ?? "",
    s1.seedCompanies ?? [],
    [...(s1.queriesRu ?? []), ...(s1.queriesEn ?? [])]
  );
  if (!report.title) report.title = s1.workingTitle;

  console.log(`[${tag}] Stage 7: verifying sources`);
  report.sources = (await stage7VerifySources(report.sources)).sources;
  const reachable = report.sources.filter((s) => s.reachedAt !== null).length;
  console.log(`  ${reachable}/${report.sources.length} reachable`);

  const md = renderReportMarkdown(report);
  const html = renderReportHtml(md, report.title || theme.topic, { banner: CALIB_BANNER });

  const mdPath = resolve(`${OUT_DIR}/sample-${theme.slug}-${RUN_DATE}-calib.md`);
  const htmlPath = resolve(`${OUT_DIR}/sample-${theme.slug}-${RUN_DATE}-calib.html`);
  await mkdir(dirname(mdPath), { recursive: true });
  await writeFile(mdPath, md, "utf-8");
  await writeFile(htmlPath, html, "utf-8");

  console.log(`[${tag}] wrote md (${md.length}b) + html (${html.length}b)`);
  console.log(`[${tag}] tables=${report.comparativeTables.length} techs=${report.technologies.length} concl=${report.conclusions.length} caveats=${report.caveats.length} sources=${report.sources.length}`);
  return {
    sources: report.sources.length,
    techs: report.technologies.length,
    tables: report.comparativeTables.length,
    patents: harvest.patents.length,
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.TIMEWEB_AI_KEY;
  if (!apiKey) {
    console.error("Missing TIMEWEB_AI_KEY");
    process.exit(1);
  }

  // ── SMOKE: theme 1 first. Hard-error → stop + escalate (don't burn batch).
  console.log("=== SMOKE: theme 1 (crude lead) — hard-error check only ===");
  try {
    await runOne(apiKey, THEMES[0]);
  } catch (e) {
    console.error("\n🛑 SMOKE FAILED on theme 1 — HARD ERROR. Stopping batch, escalate to ap-cofounder.");
    console.error(e instanceof Error ? e.stack || e.message : String(e));
    process.exit(2);
  }
  console.log("\n✅ SMOKE PASSED (theme 1 technically completed). Running themes 2-4 without tuning.\n");

  // ── Remaining themes. Per-theme failures are logged but DON'T abort the
  // batch (theme 1 already proved the pipeline runs on metallurgy).
  const summary: Array<{ slug: string; ok: boolean; note: string }> = [
    { slug: THEMES[0].slug, ok: true, note: "smoke ok" },
  ];
  for (const theme of THEMES.slice(1)) {
    try {
      const r = await runOne(apiKey, theme);
      summary.push({
        slug: theme.slug,
        ok: true,
        note: `sources=${r.sources} techs=${r.techs} tables=${r.tables} patents=${r.patents}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[calib:${theme.slug}] FAILED (non-fatal for batch): ${msg}`);
      summary.push({ slug: theme.slug, ok: false, note: msg });
    }
  }

  console.log("\n========== CALIBRATION BATCH SUMMARY ==========");
  for (const s of summary) {
    console.log(`${s.ok ? "✅" : "❌"} ${s.slug} — ${s.note}`);
  }
}

main().catch((e) => {
  console.error("[calib] fatal", e);
  process.exit(1);
});
