// Generic markdown → PDF renderer (React PDF + marked AST).
//
// Designed for the literature-review report shape (6 sections, numbered
// sources, comparative tables, technology blocks). Works on ANY markdown,
// but layout/typography were tuned against the Sb₂O₃ sample-NORD-эталон.
//
// Why a custom renderer (not pandoc / Chrome): brand consistency — same
// stack will eventually render Stage 9 of the worker pipeline, so paid
// reports look identical to the cold-outreach attachment. No system
// installs required (works inside `tsx scripts/...` from `web/`).
//
// Cyrillic note: React PDF default Helvetica lacks Cyrillic glyphs. We
// register Noto Sans (Google Fonts, free, full Cyrillic+Latin coverage)
// at module load. Font files are bundled in `web/public/fonts/` so the
// PDF is self-contained.

import * as React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Link as PDFLink,
} from "@react-pdf/renderer";
import { marked, type Tokens } from "marked";

// ── Font registration ────────────────────────────────────────
// Noto Sans Light + Regular + Bold + Italic from Google Fonts CDN.
// React PDF resolves URLs at render time (renderToBuffer awaits font
// load). For full offline render later, mirror into /public/fonts.
// URLs fetched live from Google Fonts CSS endpoint at module-load is fragile
// (CSS rotates filenames per version bump). Hardcoded v42 — bump if Google
// rotates. Italic uses 400-normal + style hint (React PDF synthesizes italic
// when no italic font is registered; acceptable for emphasis runs).
Font.register({
  family: "NotoSans",
  fonts: [
    {
      src: "https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf",
      fontWeight: 400,
    },
    {
      src: "https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyAaBN9d.ttf",
      fontWeight: 700,
    },
    {
      src: "https://fonts.gstatic.com/s/notosans/v42/o-0kIpQlx3QUlC5A4PNr4C5OaxRsfNNlKbCePevHtVtX57DGjDU1QDce6Vc.ttf",
      fontWeight: 400,
      fontStyle: "italic",
    },
  ],
});

const COLORS = {
  ink: "#0f172a",       // slate-900
  muted: "#475569",     // slate-600
  faint: "#94a3b8",     // slate-400
  accent: "#2563eb",    // blue-600
  rule: "#e2e8f0",      // slate-200
  bg: "#f8fafc",        // slate-50
};

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: "NotoSans",
    fontSize: 10.5,
    color: COLORS.ink,
    lineHeight: 1.55,
  },
  h1: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 10,
    color: COLORS.ink,
  },
  h2: {
    fontSize: 16,
    fontWeight: 700,
    marginTop: 18,
    marginBottom: 8,
    color: COLORS.ink,
    paddingBottom: 4,
  },
  h3: {
    fontSize: 13,
    fontWeight: 700,
    marginTop: 12,
    marginBottom: 6,
    color: COLORS.ink,
  },
  h4: {
    fontSize: 11.5,
    fontWeight: 700,
    marginTop: 8,
    marginBottom: 4,
    color: COLORS.ink,
  },
  paragraph: {
    marginBottom: 6,
  },
  italic: {
    fontStyle: "italic",
    color: COLORS.muted,
    marginBottom: 8,
  },
  list: {
    marginBottom: 6,
    paddingLeft: 0,
  },
  listItem: {
    flexDirection: "row",
    marginBottom: 3,
  },
  bullet: {
    width: 14,
    color: COLORS.muted,
  },
  listItemText: {
    flex: 1,
  },
  // Borders removed — React PDF's border-clip math overflows (Error
  // "unsupported number: -3.87e+22") on tables with >6 cols + tall rows
  // typical of literature-review comparison tables. Visual structure
  // comes from header background + row striping instead.
  table: {
    marginVertical: 8,
  },
  tableRow: {
    flexDirection: "row",
  },
  tableRowAlt: {
    flexDirection: "row",
    backgroundColor: COLORS.bg,
  },
  tableHeaderCell: {
    flex: 1,
    padding: 5,
    backgroundColor: "#e2e8f0",
    fontWeight: 700,
    fontSize: 9,
  },
  tableCell: {
    flex: 1,
    padding: 5,
    fontSize: 9,
  },
  link: {
    color: COLORS.accent,
    textDecoration: "none",
  },
  code: {
    fontSize: 9.5,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 3,
  },
  hr: {
    height: 1,
    backgroundColor: COLORS.rule,
    marginVertical: 10,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8.5,
    color: COLORS.faint,
    textAlign: "center",
    paddingTop: 6,
  },
  pageNum: {
    position: "absolute",
    bottom: 8,
    right: 48,
    fontSize: 8,
    color: COLORS.faint,
  },
});

// ── Inline-token rendering ───────────────────────────────────
// marked tokenizes paragraphs/headings/list items into a `tokens` array of
// inline parts (text, strong, em, codespan, link, br). We map each to a
// React-PDF <Text> with appropriate style. Concatenation works because
// React-PDF allows nesting <Text> inside <Text>.

function renderInlineTokens(tokens: Tokens.Generic[], keyPrefix = ""): React.ReactNode[] {
  return tokens.map((t, i) => {
    const k = `${keyPrefix}${i}`;
    switch (t.type) {
      case "text":
        return <Text key={k}>{decodeEntities((t as Tokens.Text).text)}</Text>;
      case "strong":
        return (
          <Text key={k} style={{ fontWeight: 700 }}>
            {renderInlineTokens((t as Tokens.Strong).tokens ?? [], `${k}-`)}
          </Text>
        );
      case "em":
        return (
          <Text key={k} style={{ fontStyle: "italic" }}>
            {renderInlineTokens((t as Tokens.Em).tokens ?? [], `${k}-`)}
          </Text>
        );
      case "codespan":
        return (
          <Text key={k} style={styles.code}>
            {(t as Tokens.Codespan).text}
          </Text>
        );
      case "link": {
        const link = t as Tokens.Link;
        return (
          <PDFLink key={k} src={link.href} style={styles.link}>
            {renderInlineTokens(link.tokens ?? [], `${k}-`)}
          </PDFLink>
        );
      }
      case "br":
        return <Text key={k}>{"\n"}</Text>;
      case "del":
        return (
          <Text key={k} style={{ textDecoration: "line-through" }}>
            {renderInlineTokens((t as Tokens.Del).tokens ?? [], `${k}-`)}
          </Text>
        );
      case "image":
        // Images intentionally rendered as text — we don't fetch remote
        // images for a synth report (privacy + render cost). Show alt.
        return <Text key={k}>[{(t as Tokens.Image).text}]</Text>;
      case "html":
        // Drop inline HTML — Sonnet/Flash occasionally emit <em> tags.
        return <Text key={k}>{stripHtml((t as Tokens.HTML).text)}</Text>;
      default:
        if ("text" in t && typeof t.text === "string") {
          return <Text key={k}>{t.text}</Text>;
        }
        return null;
    }
  });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(s: string): string {
  return s.replace(/<\/?[^>]+>/g, "");
}

// ── Block-token rendering ────────────────────────────────────
type RenderOpts = { footerText?: string };

function renderBlocks(tokens: Tokens.Generic[], opts: RenderOpts): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  tokens.forEach((t, i) => {
    const k = `b${i}`;
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        const styleByDepth = [styles.h1, styles.h1, styles.h2, styles.h3, styles.h4, styles.h4, styles.h4];
        const style = styleByDepth[h.depth] ?? styles.h4;
        out.push(
          <Text key={k} style={style}>
            {renderInlineTokens(h.tokens ?? [], `${k}-`)}
          </Text>
        );
        break;
      }
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        // Italic-only paragraph (scope line «*This report covers…*») → muted.
        const onlyEm =
          (p.tokens ?? []).length === 1 && p.tokens?.[0]?.type === "em";
        out.push(
          <Text key={k} style={onlyEm ? styles.italic : styles.paragraph}>
            {renderInlineTokens(p.tokens ?? [], `${k}-`)}
          </Text>
        );
        break;
      }
      case "list": {
        const l = t as Tokens.List;
        // Flat rendering: marker as a leading <Text> in the same paragraph
        // <Text>. The previous nested View/View/Text+Text layout overflowed
        // React-PDF's layout math on long Cyrillic items (error «unsupported
        // number: -3.87e+22» at line ~263 of Sb₂O₃ sample). Indent simulated
        // by a leading spacer in the text — visually identical, layout-safe.
        out.push(
          <View key={k} style={styles.list}>
            {l.items.map((item, j) => {
              const marker = l.ordered ? `${(l.start ?? 1) + j}.` : "•";
              const itemTokens = item.tokens ?? [];
              const inlineForFirstLine = (() => {
                const first = itemTokens[0];
                if (first && (first.type === "text" || first.type === "paragraph")) {
                  return (first as Tokens.Text | Tokens.Paragraph).tokens ?? null;
                }
                return null;
              })();
              const restTokens = inlineForFirstLine ? itemTokens.slice(1) : itemTokens;
              return (
                <View key={`${k}-${j}`}>
                  <Text style={{ marginBottom: 3 }}>
                    <Text style={{ color: COLORS.muted }}>{marker}  </Text>
                    {inlineForFirstLine
                      ? renderInlineTokens(inlineForFirstLine, `${k}-${j}-`)
                      : null}
                  </Text>
                  {restTokens.length > 0 ? (
                    <View style={{ paddingLeft: 14 }}>
                      {renderBlocks(restTokens, opts)}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
        break;
      }
      case "table": {
        const tb = t as Tokens.Table;
        out.push(
          <View key={k} style={styles.table} wrap={false}>
            <View style={styles.tableRow}>
              {tb.header.map((h, j) => (
                <Text key={j} style={styles.tableHeaderCell}>
                  {renderInlineTokens(h.tokens ?? [], `${k}-h${j}-`)}
                </Text>
              ))}
            </View>
            {tb.rows.map((row, ri) => (
              <View key={`${k}-r${ri}`} style={ri % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                {row.map((cell, ci) => (
                  <Text key={ci} style={styles.tableCell}>
                    {renderInlineTokens(cell.tokens ?? [], `${k}-r${ri}-c${ci}-`)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        );
        break;
      }
      case "blockquote": {
        const bq = t as Tokens.Blockquote;
        out.push(
          <View
            key={k}
            style={{
              backgroundColor: COLORS.bg,
              paddingLeft: 10,
              paddingVertical: 4,
              marginVertical: 6,
            }}
          >
            {renderBlocks(bq.tokens ?? [], opts)}
          </View>
        );
        break;
      }
      case "code": {
        const c = t as Tokens.Code;
        out.push(
          <View
            key={k}
            style={{
              backgroundColor: COLORS.bg,
              padding: 8,
              marginVertical: 6,
              borderRadius: 3,
            }}
          >
            <Text style={{ fontSize: 9, color: COLORS.ink }}>{c.text}</Text>
          </View>
        );
        break;
      }
      case "hr":
        out.push(<View key={k} style={styles.hr} />);
        break;
      case "space":
        // marked emits an empty "space" between blocks — handled by margins.
        break;
      case "html":
        out.push(
          <Text key={k} style={styles.paragraph}>
            {stripHtml((t as Tokens.HTML).text)}
          </Text>
        );
        break;
    }
  });
  return out;
}

// Split tokens into chunks separated by h1/h2 headings. Rendering each
// chunk as its own <Page wrap> sidesteps a React-PDF layout overflow we hit
// on the Sb₂O₃ sample (cumulative Cyrillic content past ~263 lines pushes
// layout math to NaN: «unsupported number: -3.87e+22»). Each section's
// page-break math is independent and small, so the overflow never accrues.
function splitBySection(tokens: Tokens.Generic[]): Tokens.Generic[][] {
  const sections: Tokens.Generic[][] = [];
  let current: Tokens.Generic[] = [];
  for (const t of tokens) {
    const isSectionStart =
      t.type === "heading" && ((t as Tokens.Heading).depth ?? 99) <= 2;
    if (isSectionStart && current.length > 0) {
      sections.push(current);
      current = [];
    }
    current.push(t);
  }
  if (current.length > 0) sections.push(current);
  return sections;
}

// ── Public renderer ──────────────────────────────────────────
export function MarkdownDocument({
  markdown,
  footerText,
}: {
  markdown: string;
  footerText?: string;
}): React.ReactElement {
  const tokens = marked.lexer(markdown);
  const sections = splitBySection(tokens);
  return (
    <Document>
      {sections.map((sectionTokens, i) => (
        <Page key={i} size="A4" style={styles.page} wrap>
          {renderBlocks(sectionTokens, { footerText })}
          {footerText && (
            <Text
              style={styles.footer}
              fixed
              render={({ pageNumber, totalPages }) =>
                `${footerText}  ·  стр. ${pageNumber} из ${totalPages}`
              }
            />
          )}
        </Page>
      ))}
    </Document>
  );
}
