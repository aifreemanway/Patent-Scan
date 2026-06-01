// Re-render the calibration-batch HTML from the EXISTING .md files using the
// print-safe renderer (lib/literature-review/render-html). Content is NOT
// re-run through the pipeline — the markdown is byte-identical, so blind-run
// integrity holds; only the table-overflow-on-PDF CSS bug is fixed
// (ap-cofounder 2026-06-01).

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderReportHtml } from "../../src/lib/literature-review/render-html";

const OUT_DIR = "scripts/poc-gates/out";
const BANNER =
  "Калибровочный прогон пайплайна (v2.2) — сырой автоматический вывод, 2026-06-01.";

const SLUGS = [
  "crude-lead-smelting",
  "copper-slag-depletion",
  "cu-ni-matte-fineshtein",
  "direct-to-blister-copper",
];

function titleFromMd(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

async function main(): Promise<void> {
  for (const slug of SLUGS) {
    const mdPath = resolve(`${OUT_DIR}/sample-${slug}-2026-06-01-calib.md`);
    const htmlPath = resolve(`${OUT_DIR}/sample-${slug}-2026-06-01-calib.html`);
    const md = await readFile(mdPath, "utf-8");
    const html = renderReportHtml(md, titleFromMd(md, slug), { banner: BANNER });
    await writeFile(htmlPath, html, "utf-8");
    console.log(`re-rendered ${slug}: md ${md.length}b → html ${html.length}b`);
  }
  console.log("done — content unchanged, print-safe table CSS applied");
}

main().catch((e) => {
  console.error("[rerender] fatal", e);
  process.exit(1);
});
