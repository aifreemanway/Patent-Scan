// Render the structured LitReviewReport into the canonical Sb₂O₃-shaped
// markdown (spec §4). PR-3 ships markdown only; PR-3.5 will pipe this through
// @react-pdf/renderer for the PDF artefact. The file is stored in Supabase
// Storage as .md for now and the "result_pdf_url" column gets a signed URL
// to it — the email template doesn't care about extension.

import type { LitReviewReport } from "@/lib/literature-review/types";

function refs(refs: number[]): string {
  if (!refs.length) return "";
  return ` [${refs.join(", ")}]`;
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderReportMarkdown(report: LitReviewReport): string {
  const lines: string[] = [];

  lines.push(`# ${report.title}`);
  lines.push("");
  if (report.scope) {
    lines.push(`*${report.scope}*`);
    lines.push("");
  }

  // §1
  lines.push("## 1. Общие сведения и классификация");
  lines.push("");
  if (report.overview) {
    lines.push(report.overview);
    lines.push("");
  }
  for (const c of report.classification) {
    lines.push(`- **${c.name}** — ${c.description}${refs(c.sourceRefs)}`);
  }
  lines.push("");

  // §2
  lines.push(`## 2. Сравнительные таблицы`);
  lines.push("");
  if (report.comparativeTables.length === 0) {
    lines.push("_Сравнительных таблиц в этом обзоре нет — см. раздел «Оговорки»._");
    lines.push("");
  }
  report.comparativeTables.forEach((t, i) => {
    // Sonnet often returns titles that already start with "Таблица N." (the
    // SYNTH_PROMPT example shows that shape). Strip a leading "Таблица <num>."
    // so we don't double-prefix to "Таблица 1. Таблица 1. …".
    const cleanTitle = t.title.replace(/^\s*Таблица\s*\d+\.\s*/i, "").trim();
    lines.push(`### Таблица ${i + 1}. ${cleanTitle}`);
    lines.push("");
    if (t.columns.length > 0) {
      lines.push(`| ${t.columns.map(escapePipe).join(" | ")} |`);
      lines.push(`| ${t.columns.map(() => "---").join(" | ")} |`);
      for (const row of t.rows) {
        const cells = [row.label, ...row.cells].map(escapePipe);
        const trailing = row.sourceRefs.length ? `${refs(row.sourceRefs)}` : "";
        lines.push(`| ${cells.join(" | ")} |${trailing}`);
      }
    }
    lines.push("");
  });

  // §3
  lines.push("## 3. Технологии: краткий обзор с плюсами и минусами");
  lines.push("");
  for (const tech of report.technologies) {
    lines.push(`### ${tech.name}`);
    lines.push("");
    if (tech.description) {
      lines.push(tech.description + refs(tech.sourceRefs));
      lines.push("");
    }
    if (tech.pros.length) {
      lines.push("**Плюсы:**");
      for (const p of tech.pros) lines.push(`- ${p}`);
      lines.push("");
    }
    if (tech.cons.length) {
      lines.push("**Минусы:**");
      for (const c of tech.cons) lines.push(`- ${c}`);
      lines.push("");
    }
  }

  // §4
  lines.push("## 4. Общие выводы");
  lines.push("");
  report.conclusions.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.text}${refs(c.sourceRefs)}`);
  });
  lines.push("");

  // §5
  lines.push("## 5. Источники");
  lines.push("");
  for (const s of report.sources) {
    const archived = s.reachedAt === null ? " *(на момент проверки недоступен)*" : "";
    // Honest access marking (NORD feedback): flag paywalled sources we could
    // only read in abstract. open/unknown stay unmarked — never claim full text.
    const access = s.accessLevel === "abstract_only" ? " *(только аннотация)*" : "";
    lines.push(`${s.ref}. ${s.title} — ${s.url}${archived}${access}`);
  }
  lines.push("");

  // §6
  lines.push("## 6. Оговорки и ограничения обзора");
  lines.push("");
  for (const c of report.caveats) {
    lines.push(`- ${c}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "_Этот обзор сформирован автоматически на основе открытых источников. " +
      "Он не является юридическим заключением и не заменяет работу патентного " +
      "поверенного или отраслевого эксперта при принятии бизнес-решений._"
  );
  lines.push("");

  return lines.join("\n");
}
