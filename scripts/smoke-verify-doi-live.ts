// Live smoke for §4 verify-DOI (stage 7) — the gate the code asks for before
// enabling LITREVIEW_VERIFY_DOI=1 on prod: "timings + transient 403/timeout rate
// on live FIPS/DOI links".
//
// Faithful: builds a REAL source corpus via the production harvest (stage2 +
// harvestToSources) for several real topics — NO LLM (stage1 is hand-crafted,
// no synth/relevance filter) — then runs the REAL stage7VerifySources with §4
// force-enabled (opts.probe present) and instruments the real probeUrl /
// rerollOaUrl to capture per-call timings. Measures the actual added review
// latency + the anti-fab correction (harvest=open → verified=unreachable).
//
// Run:  npx tsx scripts/smoke-verify-doi-live.ts

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { stage2, harvestToSources, stage7VerifySources } from "../src/worker/literature-review/stages";
import {
  probeUrl,
  rerollOaUrl,
  type ProbeOutcome,
} from "../src/lib/literature-review/verify-doi";
import type { LitReviewParams, LitReviewSource } from "../src/lib/literature-review/types";

// Hand-crafted query plans — REAL dense technical terms + REAL IPC subgroup codes
// (verbatim from the Stage-1 prompt's own domain examples). No LLM call.
type S1 = {
  queriesRu: string[];
  queriesEn: string[];
  ipcSubclasses: string[];
  workingTitle: string;
  seedCompanies?: string[];
};

const TOPICS: Array<{ slug: string; params: LitReviewParams; s1: S1 }> = [
  {
    slug: "hydrogen-electrolyzers",
    params: {
      topic:
        "Электролизеры для производства водорода (PEM и щёлочные): производители, эффективность, мощностные диапазоны 2020-2026.",
      industry: "energy",
      regions: ["RU", "CIS", "CN", "US", "EU", "WORLD"],
      periodFrom: 2020,
      periodTo: 2026,
      hypotheses: "",
    },
    s1: {
      queriesRu: [
        "электролизер водород PEM протонообменная мембрана производство",
        "щелочной электролизер водород эффективность мощность стек",
        "электролиз воды водородная энергетика катализатор",
      ],
      queriesEn: [
        "PEM electrolyzer hydrogen proton exchange membrane production",
        "alkaline water electrolysis hydrogen efficiency capacity stack",
        "green hydrogen electrolyzer manufacturer stack degradation",
      ],
      ipcSubclasses: ["C25B 1/04", "C25B 9/19", "C25B 11/00", "H01M 8/10"],
      workingTitle: "Водородные электролизёры PEM и щелочные",
    },
  },
  {
    slug: "antimony-trioxide",
    params: {
      topic:
        "Триоксид сурьмы (Sb2O3): производство, пирометаллургия, обжиг, очистка газов 2015-2026.",
      industry: "metallurgy",
      regions: ["RU", "CIS", "CN", "WORLD"],
      periodFrom: 2015,
      periodTo: 2026,
      hypotheses: "",
    },
    s1: {
      queriesRu: [
        "триоксид сурьмы получение пирометаллургия обжиг",
        "сурьма металлургия очистка отходящих газов производство",
      ],
      queriesEn: [
        "antimony trioxide production pyrometallurgy roasting",
        "antimony smelting flue gas Sb2O3 manufacturing",
      ],
      ipcSubclasses: ["C22B 30/02", "C22B 7/00", "C01G 30/00"],
      workingTitle: "Триоксид сурьмы — производство и металлургия",
    },
  },
  {
    slug: "lfp-batteries",
    params: {
      topic:
        "Литий-железо-фосфатные аккумуляторы (LFP): катодный материал, деградация, циклирование 2018-2026.",
      industry: "energy",
      regions: ["CN", "US", "EU", "WORLD"],
      periodFrom: 2018,
      periodTo: 2026,
      hypotheses: "",
    },
    s1: {
      queriesRu: [
        "литий-железо-фосфат аккумулятор катод LiFePO4 деградация",
        "LFP батарея циклирование ёмкость катодный материал",
      ],
      queriesEn: [
        "lithium iron phosphate battery LiFePO4 cathode capacity fade",
        "LFP cell cycling degradation cathode material",
      ],
      ipcSubclasses: ["H01M 4/58", "H01M 4/136", "H01M 10/0525"],
      workingTitle: "LFP аккумуляторы — катод и деградация",
    },
  },
];

function hostType(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("fips.ru")) return "ФИПС (RU patent)";
    if (h === "doi.org" || h === "dx.doi.org") return "doi.org";
    if (h.includes("patents.google")) return "Google Patents";
    if (h.includes("openalex")) return "OpenAlex";
    if (h.includes("wikipedia")) return "Wikipedia";
    return "web/other";
  } catch {
    return "invalid";
  }
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return Math.round(s[idx]);
}

async function main() {
  const probeLog: Array<{ url: string; ms: number; outcome: ProbeOutcome }> = [];
  const rerollLog: Array<{ doi: string; ms: number; found: boolean }> = [];

  const instrProbe = async (url: string): Promise<ProbeOutcome> => {
    const t0 = performance.now();
    const out = await probeUrl(url); // REAL probe (GET, 7s timeout, fail-open)
    probeLog.push({ url, ms: performance.now() - t0, outcome: out });
    return out;
  };
  const instrReroll = async (doi: string): Promise<string | null> => {
    const t0 = performance.now();
    const out = await rerollOaUrl(doi); // REAL reroll (OpenAlex→Crossref)
    rerollLog.push({ doi, ms: performance.now() - t0, found: out != null });
    return out;
  };

  // 1) Build the REAL corpus via production harvest (no LLM).
  const allSources: LitReviewSource[] = [];
  const perTopic: Array<{ slug: string; harvested: number }> = [];
  for (const t of TOPICS) {
    process.stderr.write(`[smoke] harvest: ${t.slug}\n`);
    try {
      const harvest = await stage2(t.params, t.s1 as never);
      const hs = harvestToSources(harvest);
      perTopic.push({ slug: t.slug, harvested: hs.sources.length });
      // Re-ref to keep unique refs across the pooled corpus.
      for (const s of hs.sources) allSources.push({ ...s, ref: allSources.length + 1 });
      process.stderr.write(
        `  patents=${harvest.patents.length} scholar=${harvest.scholar.length} web=${harvest.web.length} wiki=${harvest.wiki.length} → kept ${hs.sources.length}\n`
      );
    } catch (e) {
      process.stderr.write(`  HARVEST FAILED: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  const harvestAccessByUrl = new Map(allSources.map((s) => [s.url, s.accessLevel]));
  const hasDoiByUrl = new Map(allSources.map((s) => [s.url, !!s.doi]));

  // 2) Run the REAL stage7 with §4 force-enabled (opts.probe present) — this is
  //    the exact production verify pass. Wall-clock = the latency it adds.
  process.stderr.write(`[smoke] stage7 verify (§4 ON) on ${allSources.length} sources…\n`);
  const wall0 = performance.now();
  const verified = await stage7VerifySources(allSources, {
    probe: instrProbe,
    reroll: instrReroll,
  });
  const wallMs = Math.round(performance.now() - wall0);

  // 3) Aggregate.
  const probeMs = probeLog.map((p) => p.ms);
  const networkCount = probeLog.filter((p) => p.outcome.kind === "network").length;
  const statusDist: Record<string, number> = {};
  for (const p of probeLog) {
    const k = p.outcome.kind === "network" ? "network/timeout" : String(p.outcome.status);
    statusDist[k] = (statusDist[k] ?? 0) + 1;
  }

  const finalAccessDist: Record<string, number> = {};
  let antifabFixes = 0; // harvest said open/unknown, verify found unreachable
  let openToAbstract = 0;
  for (const s of verified.sources) {
    finalAccessDist[s.accessLevel] = (finalAccessDist[s.accessLevel] ?? 0) + 1;
    const before = harvestAccessByUrl.get(s.url);
    if (s.accessLevel === "unreachable" && (before === "open" || before === "unknown")) antifabFixes++;
    if (s.accessLevel === "abstract_only" && before === "open") openToAbstract++;
  }

  // by host-type
  const byHost: Record<string, { n: number; ms: number[]; unreachable: number }> = {};
  for (const p of probeLog) {
    const ht = hostType(p.url);
    byHost[ht] ??= { n: 0, ms: [], unreachable: 0 };
    byHost[ht].n++;
    byHost[ht].ms.push(p.ms);
    if (p.outcome.kind === "network" || (p.outcome.kind === "status" && (p.outcome.status >= 400)))
      byHost[ht].unreachable++;
  }
  const byHostSummary = Object.fromEntries(
    Object.entries(byHost).map(([k, v]) => [
      k,
      { n: v.n, medianMs: pct(v.ms, 50), maxMs: Math.max(...v.ms, 0), unreachableOr4xx: v.unreachable },
    ])
  );

  const summary = {
    topics: perTopic,
    corpusSize: allSources.length,
    withDoi: [...hasDoiByUrl.values()].filter(Boolean).length,
    stage7: {
      wallClockMs: wallMs,
      wallClockSec: +(wallMs / 1000).toFixed(1),
      unreachableCount: verified.unreachableCount,
      rerolledCount: verified.rerolledCount,
    },
    probeTimings: {
      count: probeMs.length,
      p50: pct(probeMs, 50),
      p95: pct(probeMs, 95),
      max: Math.max(...probeMs, 0),
      meanMs: probeMs.length ? Math.round(probeMs.reduce((a, b) => a + b, 0) / probeMs.length) : 0,
    },
    transient: {
      networkOrTimeout: networkCount,
      rate: probeMs.length ? +(networkCount / probeMs.length).toFixed(3) : 0,
    },
    httpStatusDistribution: statusDist,
    rerollAttempts: rerollLog.length,
    rerollFound: rerollLog.filter((r) => r.found).length,
    rerollMaxMs: Math.max(0, ...rerollLog.map((r) => Math.round(r.ms))),
    antifab: {
      // sources the harvest would have shown as accessible but are actually dead:
      correctedOpenOrUnknownToUnreachable: antifabFixes,
      openDowngradedToAbstractOnly: openToAbstract,
    },
    finalAccessDistribution: finalAccessDist,
    byHostType: byHostSummary,
  };

  const outPath =
    "C:/Users/kobzar/AppData/Local/Temp/claude/c--Users-kobzar-OneDrive-------NDIGITAL-VK-VK-Claude-SaaS-Antepatent/78bcbb1c-59e6-4c53-80c0-2bfd42f0a16a/scratchpad/smoke-verify-doi.json";
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify({ summary, probeLog: probeLog.map((p) => ({ url: p.url, ms: Math.round(p.ms), outcome: p.outcome })) }, null, 2),
    "utf-8"
  );

  // Human summary to stdout.
  console.log("\n========== §4 VERIFY-DOI LIVE SMOKE ==========");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n[full per-URL log written to ${outPath}]`);
}

main().catch((e) => {
  console.error("[smoke] fatal", e);
  process.exit(1);
});
