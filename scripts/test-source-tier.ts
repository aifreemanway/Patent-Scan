// Unit test for source-tier scoring (deterministic, no network/LLM).
// Run: npx tsx scripts/test-source-tier.ts
//
// Guardrail regression: niche industry domains (glencore/outotec/…) MUST stay
// T3 (survive the default THRESHOLD=4 drop). T4 is an explicit list only.

import assert from "node:assert";
import { scoreTier } from "@/lib/literature-review/source-tier";

let passed = 0;
let failed = 0;

function check(name: string, got: number, want: number) {
  try {
    assert.strictEqual(got, want);
    console.log(`  ok   ${name} → T${got}`);
    passed++;
  } catch {
    console.error(`  FAIL ${name} → got T${got}, want T${want}`);
    failed++;
  }
}

console.log("source-tier scoring:");

// ── T4 — low authority, dropped at THRESHOLD=4 ──────────────────
check("studfile.net", scoreTier("https://studfile.net/preview/12345/", "tavily"), 4);
check("x.narod.ru", scoreTier("http://metallurg.narod.ru/page.html", "tavily"), 4);
check("dic.academic.ru", scoreTier("https://dic.academic.ru/dic.nsf/ruwiki/123", "tavily"), 4);
check("forum path marker", scoreTier("https://somesite.ru/forum/topic-42", "tavily"), 4);

// ── T3 GUARDRAIL — niche industry sources MUST survive ──────────
check("glencore.com (guardrail)", scoreTier("https://www.glencore.com/who-we-are", "tavily"), 3);
check("www.outotec.com (guardrail)", scoreTier("https://www.outotec.com/products/smelting/", "tavily"), 3);
check("niche industry .ru (guardrail)", scoreTier("https://www.sibran.ru/catalog/furnace-x", "tavily"), 3);
check("metso.com (guardrail)", scoreTier("https://www.metso.com/portfolio/flash-smelting/", "tavily"), 3);
// Regression: "gov" must NOT substring-match a host that merely contains it.
check("novgorod.ru NOT gov→T2", scoreTier("https://metallurg.novgorod.ru/about", "tavily"), 3);

// ── T1 — primary / verified ─────────────────────────────────────
check("doi.org host", scoreTier("https://doi.org/10.1016/j.hydromet.2020.105", "tavily"), 1);
check("DOI in path (non-doi host)", scoreTier("https://pubs.acs.org/doi/10.1021/abc", "tavily"), 1);
check("patsearch provenance", scoreTier("https://searchplatform.rospatent.gov.ru/docs/RU123C1", "patsearch"), 1);
check("crossref + DOI", scoreTier("https://link.springer.com/article/x", "crossref", { doi: "10.1007/x" }), 1);
check("elibrary.ru", scoreTier("https://elibrary.ru/item.asp?id=12345", "tavily"), 1);

// ── T2 — authoritative secondary ────────────────────────────────
check("wikipedia", scoreTier("https://ru.wikipedia.org/wiki/Медь", "wikipedia"), 2);
check("crossref without DOI", scoreTier("https://example-journal.org/x", "crossref", { doi: null }), 2);
check("iea.org", scoreTier("https://www.iea.org/reports/x", "tavily"), 2);
check("gov suffix", scoreTier("https://www.usgs.gov/centers/x", "tavily"), 2);
check("edu suffix", scoreTier("https://chem.mit.edu/lab", "tavily"), 2);
check("ras.ru", scoreTier("https://www.ras.ru/news/x", "tavily"), 2);
check("NEWS_WHITELIST (reuters)", scoreTier("https://www.reuters.com/markets/x", "tavily"), 2);

console.log(`\nsource-tier: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
