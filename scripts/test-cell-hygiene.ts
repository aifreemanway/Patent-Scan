// Unit test for deterministic cell hygiene (design §3 «Гигиена §4A»).
// Run: npx tsx scripts/test-cell-hygiene.ts
//
// Anti-fab guardrails verified here:
//   - empty / whitespace / null / undefined → «—» (never a fabricated value)
//   - HTML tags + entities stripped, NEVER content added
//   - <br> becomes a space (no token fusion)

import assert from "node:assert";
import { stripHtml, cleanCell, EMPTY_CELL } from "@/lib/literature-review/cell-hygiene";

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  try {
    assert.strictEqual(got, want);
    console.log(`  ok   ${name} → ${JSON.stringify(got)}`);
    passed++;
  } catch {
    console.error(`  FAIL ${name} → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failed++;
  }
}

console.log("stripHtml:");
eq("plain text untouched", stripHtml("Sb2O3 завод"), "Sb2O3 завод");
eq("<sub> tag removed", stripHtml("Sb<sub>2</sub>O<sub>3</sub>"), "Sb2O3");
eq("<br> → space", stripHtml("Линия A<br>Линия B"), "Линия A Линия B");
eq("<br/> self-closing → space", stripHtml("A<br/>B"), "A B");
eq("&nbsp; → space, collapsed", stripHtml("90&nbsp;%"), "90 %");
eq("&amp; decoded", stripHtml("BHP&amp;Co"), "BHP&Co");
eq("&mdash; decoded", stripHtml("2018&mdash;2024"), "2018—2024");
eq("&lt;/&gt; decoded", stripHtml("&lt;5 т/год&gt;"), "<5 т/год>");
eq("numeric entity decoded", stripHtml("&#1052;осква"), "Москва");
eq("span with style removed", stripHtml('<span style="color:red">текст</span>'), "текст");
eq("nested tags removed, content kept", stripHtml("<b><i>важно</i></b>"), "важно");
eq("entity-of-entity stays literal", stripHtml("&amp;lt;"), "&lt;");
eq("whitespace collapsed + trimmed", stripHtml("  a   b  "), "a b");
eq("non-string → empty", stripHtml(123 as unknown as string), "");

console.log("\ncleanCell (empty → «—», anti-fab):");
eq("null → —", cleanCell(null), EMPTY_CELL);
eq("undefined → —", cleanCell(undefined), EMPTY_CELL);
eq("empty string → —", cleanCell(""), EMPTY_CELL);
eq("whitespace-only → —", cleanCell("   "), EMPTY_CELL);
eq("nbsp-only → —", cleanCell("&nbsp;"), EMPTY_CELL);
eq("tag-only → —", cleanCell("<br>"), EMPTY_CELL);
eq("real value kept + cleaned", cleanCell("CATL<sub>1</sub>"), "CATL1");
eq("existing — preserved", cleanCell("—"), "—");
eq("number coerced", cleanCell(2024), "2024");

console.log(`\ncell-hygiene: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
