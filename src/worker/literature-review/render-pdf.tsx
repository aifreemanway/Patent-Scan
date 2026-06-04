// Stage 9 PDF render helper. Kept as a SEPARATE .tsx so the worker entry
// (index.ts) can import a plain async function — index.ts is .ts (no JSX), and
// renderToBuffer requires the JSX form to narrow the element type to
// ReactElement<DocumentProps> (PR #70 build-failure root cause: the
// non-JSX/createElement form is rejected by renderToBuffer's signature).
//
// Reuses the shared brand renderer in lib/pdf/render-markdown.tsx — the SAME
// component used for cold-outreach attachments, so paid Stage 9 reports look
// identical. Fonts (Noto Sans, full Cyrillic) load from gstatic at render time;
// if that fetch ever fails on the VPS, Stage 9 catches the throw and degrades
// to the markdown artefact (see index.ts), so a paid review never hard-errors.

import { renderToBuffer } from "@react-pdf/renderer";
import { MarkdownDocument } from "@/lib/pdf/render-markdown";

const FOOTER = "ПатентСкан · литературный обзор · patent-scan.ru";

export async function renderReportPdf(markdown: string): Promise<Buffer> {
  return renderToBuffer(<MarkdownDocument markdown={markdown} footerText={FOOTER} />);
}
