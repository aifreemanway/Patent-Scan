// Renders any markdown file → PDF using the shared MarkdownDocument
// renderer. Built for the Sb₂O₃ outreach attachment first, but the same
// script generates PDFs for ad-hoc samples and (eventually) the worker's
// Stage 9 output.
//
// Usage:
//   npx tsx scripts/render-sample-pdf.ts <input.md> <output.pdf>
//
// Default: scripts/poc-gates/out/sample-literature-review-Sb2O3-source.md
//          → scripts/poc-gates/out/sample-literature-review-Sb2O3.pdf

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";
import { MarkdownDocument } from "../src/lib/pdf/render-markdown";

const FOOTER = "ПатентСкан · литературный обзор · patent-scan.ru";

async function main() {
  const argv = process.argv.slice(2);
  const inputPath = argv[0] ?? "scripts/poc-gates/out/sample-literature-review-Sb2O3-source.md";
  const outputPath =
    argv[1] ?? inputPath.replace(/\.md$/, ".pdf").replace("-source", "");

  const inputAbs = resolve(inputPath);
  const outputAbs = resolve(outputPath);

  console.log(`[render-pdf] input  : ${inputAbs}`);
  console.log(`[render-pdf] output : ${outputAbs}`);

  const md = await readFile(inputAbs, "utf-8");
  console.log(`[render-pdf] markdown bytes: ${md.length}`);

  const element = React.createElement(MarkdownDocument, {
    markdown: md,
    footerText: FOOTER,
  });
  const buffer = await renderToBuffer(element);

  await mkdir(dirname(outputAbs), { recursive: true });
  await writeFile(outputAbs, buffer);
  console.log(`[render-pdf] wrote ${buffer.length} bytes (${(buffer.length / 1024 / 1024).toFixed(2)} MB) to ${basename(outputAbs)}`);
  if (buffer.length > 2 * 1024 * 1024) {
    console.warn(`[render-pdf] ⚠ output > 2 MB — may hit spam filters on outreach`);
  }
}

main().catch((e) => {
  console.error("[render-pdf] fatal", e);
  process.exit(1);
});
