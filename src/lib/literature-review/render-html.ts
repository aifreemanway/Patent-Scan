// Self-contained HTML renderer for literature-review markdown — used for the
// calibration batch, the /sample-{slug} published pages, and any HTML artefact
// Vsevolod views or prints to PDF.
//
// PRINT-SAFETY is the whole point of this module (ap-cofounder bug 2026-06-01):
// the Sb₂O₃-template comparative tables have 4-6 columns and OVERFLOW the page
// width on PDF export → right columns get clipped (the "Отстойник" column was
// cut off a 5-column copper-smelting table). On SCREEN we let a wide table
// scroll horizontally; on PRINT a scroll container just clips on paper, so we
// switch to a fixed table layout that distributes width across all columns and
// wraps long cell text instead of forcing overflow. Result: every column is
// visible on the PDF, content wraps, readable at 4-6 columns.

import { marked } from "marked";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type RenderHtmlOpts = {
  /** Optional banner line above the content (e.g. calibration disclaimer). */
  banner?: string;
};

export function renderReportHtml(
  md: string,
  title: string,
  opts: RenderHtmlOpts = {}
): string {
  const body = marked.parse(md, { async: false }) as string;
  const bannerHtml = opts.banner
    ? `<div class="banner">${escapeHtml(opts.banner)}</div>`
    : "";

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.65; color: #0f172a; background: #f8fafc;
    margin: 0; padding: 32px 16px;
  }
  .doc {
    max-width: 920px; margin: 0 auto; background: #fff;
    border: 1px solid #e2e8f0; border-radius: 14px;
    padding: 48px 56px; box-shadow: 0 1px 3px rgba(0,0,0,.04);
  }
  h1 { font-size: 26px; line-height: 1.25; margin: 0 0 8px; letter-spacing: -.01em; }
  h2 { font-size: 20px; margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #2563EB; color: #1e293b; }
  h3 { font-size: 16px; margin: 24px 0 8px; color: #334155; }
  p { margin: 10px 0; }
  ul, ol { margin: 10px 0; padding-left: 22px; }
  li { margin: 4px 0; }
  a { color: #2563EB; word-break: break-word; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 28px 0; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  .banner {
    background: #fffbeb; border: 1px solid #fde68a; color: #92400e;
    border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-bottom: 24px;
  }

  /* ── Tables ─────────────────────────────────────────────────
     Base: full-width, collapsed borders, empty "—" cells stay visible. */
  table {
    border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px;
  }
  th, td {
    border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left;
    vertical-align: top; overflow-wrap: anywhere; word-break: break-word;
  }
  th { background: #f1f5f9; font-weight: 600; color: #1e293b; }
  tr:nth-child(even) td { background: #f8fafc; }

  /* SCREEN: allow a very wide table to scroll horizontally (no clipping in a
     browser, the reader just scrolls). */
  @media screen {
    .table-wrap, table { display: block; overflow-x: auto; }
  }

  /* PRINT / PDF: a scroll container clips on paper, so use a FIXED layout that
     spreads the available page width across all columns and wraps cell text.
     This guarantees every column is on the page — nothing is cut off. */
  @media print {
    body { padding: 0; background: #fff; }
    .doc {
      max-width: none; border: none; border-radius: 0; box-shadow: none;
      padding: 0;
    }
    .banner { background: #fff; border: 1px solid #e2e8f0; color: #475569; }
    h2 { margin-top: 22px; }
    table {
      display: table; table-layout: fixed; width: 100%;
      font-size: 10.5px; overflow: visible; page-break-inside: auto;
    }
    th, td { padding: 5px 6px; }
    /* Slightly narrower first column (the "Параметр" labels) so the entity
       columns get more room; hyphenate to keep long terms from overflowing. */
    td:first-child, th:first-child { width: 18%; }
    th, td { hyphens: auto; }
    tr { page-break-inside: avoid; }
    a { color: #0f172a; text-decoration: none; }
  }
  @page { size: A4; margin: 14mm 12mm; }
</style>
</head>
<body>
<div class="doc">
${bannerHtml}
${body}
</div>
</body>
</html>`;
}
