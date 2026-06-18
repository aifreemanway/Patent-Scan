// Unit test for §4 verify-strategy (design source-tier §4).
// Run: npx tsx scripts/test-verify-doi.ts
//
// HARD FAIL-OPEN is the headline invariant: a thrown probe/reroll NEVER drops a
// source and NEVER downgrades accessLevel below its current value. Network is
// fully mocked — this test does NOT hit the wire.

import assert from "node:assert";
import { classifyAccess, type ProbeOutcome } from "@/lib/literature-review/verify-doi";
import { stage7VerifySources } from "@/worker/literature-review/stages";
import type { LitReviewSource } from "@/lib/literature-review/types";

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  try {
    assert.deepStrictEqual(got, want);
    console.log(`  ok   ${name} → ${JSON.stringify(got)}`);
    passed++;
  } catch {
    console.error(`  FAIL ${name} → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failed++;
  }
}

// ── 1. classifyAccess — pure HTTP-code classification ────────────────────────
console.log("classifyAccess:");
eq("200 → open", classifyAccess({ kind: "status", status: 200 }), "open");
eq("204 → open", classifyAccess({ kind: "status", status: 204 }), "open");
eq("401 → abstract_only", classifyAccess({ kind: "status", status: 401 }), "abstract_only");
eq("403 → abstract_only", classifyAccess({ kind: "status", status: 403 }), "abstract_only");
eq("451 (paywall) → abstract_only", classifyAccess({ kind: "status", status: 451 }), "abstract_only");
eq("404 → unreachable", classifyAccess({ kind: "status", status: 404 }), "unreachable");
eq("410 → unreachable", classifyAccess({ kind: "status", status: 410 }), "unreachable");
eq("500 → unreachable", classifyAccess({ kind: "status", status: 500 }), "unreachable");
eq("network/timeout → unreachable", classifyAccess({ kind: "network" }), "unreachable");

// helper to build a minimal source
function src(over: Partial<LitReviewSource>): LitReviewSource {
  return {
    ref: 1,
    title: "T",
    url: "https://example.org/x",
    reachedAt: null,
    accessLevel: "unknown",
    provenance: "crossref",
    tier: 1,
    ...over,
  };
}

async function run() {
  // ── 2. stage7 classification wiring ────────────────────────────────────────
  console.log("\nstage7 — classification:");
  {
    const sources = [
      src({ ref: 1, url: "https://a/200" }),
      src({ ref: 2, url: "https://a/403" }),
      src({ ref: 3, url: "https://a/404" }),
    ];
    const probe = async (url: string): Promise<ProbeOutcome> => {
      if (url.endsWith("/200")) return { kind: "status", status: 200 };
      if (url.endsWith("/403")) return { kind: "status", status: 403 };
      return { kind: "status", status: 404 };
    };
    const reroll = async () => null; // no DOI on these anyway
    const out = await stage7VerifySources(sources, { probe, reroll });
    eq("200 source → open", out.sources[0].accessLevel, "open");
    eq("403 source → abstract_only", out.sources[1].accessLevel, "abstract_only");
    eq("404 source → unreachable", out.sources[2].accessLevel, "unreachable");
    eq("unreachableCount = 1", out.unreachableCount, 1);
    eq("rerolledCount = 0", out.rerolledCount, 0);
    eq("no source dropped", out.sources.length, 3);
  }

  // ── 3. reroll an unreachable DOI to an OA mirror (tier kept) ────────────────
  console.log("\nstage7 — reroll:");
  {
    const sources = [src({ ref: 1, url: "https://doi.org/10.x/dead", doi: "10.x/dead", tier: 1 })];
    const probe = async (): Promise<ProbeOutcome> => ({ kind: "status", status: 404 });
    const reroll = async (doi: string) =>
      doi === "10.x/dead" ? "https://oa.mirror.org/full.pdf" : null;
    const out = await stage7VerifySources(sources, { probe, reroll });
    eq("url swapped to OA copy", out.sources[0].url, "https://oa.mirror.org/full.pdf");
    eq("accessLevel → open", out.sources[0].accessLevel, "open");
    eq("tier PRESERVED (same source)", out.sources[0].tier, 1);
    eq("rerolledCount = 1", out.rerolledCount, 1);
    eq("not counted as unreachable", out.unreachableCount, 0);
    eq("reachedAt set", typeof out.sources[0].reachedAt, "string");
  }

  // ── 4. unreachable + NO DOI → KEPT and marked (non-deletion / anti-fab) ──────
  console.log("\nstage7 — non-deletion:");
  {
    const sources = [src({ ref: 1, url: "https://dead.example/x", doi: null, accessLevel: "open" })];
    const probe = async (): Promise<ProbeOutcome> => ({ kind: "status", status: 410 });
    const reroll = async () => null;
    const out = await stage7VerifySources(sources, { probe, reroll });
    eq("source NOT dropped", out.sources.length, 1);
    eq("marked unreachable", out.sources[0].accessLevel, "unreachable");
    eq("unreachableCount = 1", out.unreachableCount, 1);
  }

  // ── 5. reroll finds nothing → stays unreachable, kept ───────────────────────
  console.log("\nstage7 — reroll misses:");
  {
    const sources = [src({ ref: 1, url: "https://doi.org/10.x/dead", doi: "10.x/dead" })];
    const probe = async (): Promise<ProbeOutcome> => ({ kind: "status", status: 404 });
    const reroll = async () => null;
    const out = await stage7VerifySources(sources, { probe, reroll });
    eq("kept", out.sources.length, 1);
    eq("stays unreachable", out.sources[0].accessLevel, "unreachable");
    eq("url unchanged", out.sources[0].url, "https://doi.org/10.x/dead");
  }

  // ── 6. HARD FAIL-OPEN — probe throws → source survives UNCHANGED ────────────
  console.log("\nstage7 — fail-open (probe throws):");
  {
    const original = src({ ref: 1, url: "https://x/throw", accessLevel: "open", tier: 2 });
    const probe = async (): Promise<ProbeOutcome> => {
      throw new Error("boom");
    };
    const reroll = async () => null;
    const out = await stage7VerifySources([original], { probe, reroll });
    eq("source survives", out.sources.length, 1);
    eq("accessLevel NOT worsened (stays open)", out.sources[0].accessLevel, "open");
    eq("url untouched", out.sources[0].url, "https://x/throw");
    eq("tier untouched", out.sources[0].tier, 2);
    eq("not counted unreachable", out.unreachableCount, 0);
  }

  // ── 7. FAIL-OPEN — reroll throws → stays unreachable, not crashed ───────────
  console.log("\nstage7 — fail-open (reroll throws):");
  {
    const sources = [src({ ref: 1, url: "https://doi.org/10.x/y", doi: "10.x/y", accessLevel: "abstract_only" })];
    const probe = async (): Promise<ProbeOutcome> => ({ kind: "status", status: 404 });
    const reroll = async (): Promise<string | null> => {
      throw new Error("reroll boom");
    };
    const out = await stage7VerifySources(sources, { probe, reroll });
    eq("kept (no crash)", out.sources.length, 1);
    eq("marked unreachable", out.sources[0].accessLevel, "unreachable");
  }

  console.log(`\nverify-doi: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
