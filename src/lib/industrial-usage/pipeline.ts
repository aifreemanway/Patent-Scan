// Industrial Usage — orchestrator combining all 6 stages of the spec into one
// pipeline call. Per Antepatent/specs/industrial-usage-spec-2026-05-30.md.
//
// MVP scope (PR-4):
//   Stage 1: assignee extraction          ✓ (harvest.fetchPatentMeta)
//   Stage 2: company / product / competitor harvest from Tavily  ✓ (harvest.harvestStage2)
//   Stage 3+4+6 collapsed into one Gemini synthesis call          ✓ (this file)
//   Stage 5 (licensing) — deferred, sparse public data, easy to add later
//   OpenCorporates              — deferred until API key budget approved
//
// Caller (route or POC) supplies the patent id + the patent title/year/country
// the user is already viewing; this avoids one PatSearch call when we already
// have that metadata in hand.

import { callGeminiJson } from "@/lib/gemini";
import { fetchPatentMeta, harvestStage2 } from "./harvest";
import type { IUReport, IUSource } from "./types";

const SYNTH_PROMPT = `Ты — отраслевой аналитик. На вход: метаданные патента + найденные web-страницы про компанию-патентообладателя, её продукты и конкурентов. Сформируй краткую коммерческую карту использования патента.

КРИТИЧЕСКОЕ ПРАВИЛО АНТИ-ФАБРИКАЦИИ: используй ТОЛЬКО данные из SOURCES. Никаких выдуманных компаний, продуктов, конкурентов или ссылок. Если данных нет — отметь это в caveats, не достраивай.

Верни СТРОГО валидный JSON:
{
  "assignee": {
    "description": "1-2 предложения о компании по доступным источникам (отрасль, масштаб). Если данных нет — пустая строка.",
    "website": "URL официального сайта компании ЕСЛИ найден в источниках; иначе опусти поле",
    "sourceRefs": [1, 2]
  },
  "products": [
    {
      "name": "название продукта / линейки",
      "description": "1-2 предложения о связи продукта с патентом",
      "sourceRefs": [3]
    }
    // 0-4 элемента; если связь продукта с патентом не подтверждена — НЕ включай
  ],
  "competitors": [
    {
      "name": "название компании-конкурента",
      "country": "2-буквенный код страны или null",
      "technology": "1 предложение: какая у конкурента аналогичная технология",
      "sourceRefs": [4, 5]
    }
    // 1-5 элементов. Если в bucket=competitor SOURCES упоминается компания, работающая в той же
    // технологической нише (металлургическое оборудование, аналогичный процесс) — это уже
    // достаточно для включения. Не требуй фразы «X — конкурент Y» дословно. Если конкретное
    // название не извлекается, но индустрия упомянута — отметь это в caveats.
  ],
  "caveats": [
    "честное замечание #1 о том, какие данные не нашлись",
    "честное замечание #2"
    // 0-4 пункта
  ]
}

Правила:
- sourceRefs — ТОЛЬКО номера из списка SOURCES, без выдумывания
- Пустые продукты/конкуренты — нормально; пиши о пробелах в caveats
- Не упоминай продукты/конкурентов без хотя бы одного source
- assignee.description: только факты из источников (страна, индустрия, размер) — без оценочных суждений
- Язык ответа — русский`;

type GeminiOutput = {
  assignee?: { description?: string; website?: string; sourceRefs?: number[] };
  products?: Array<{ name?: string; description?: string; sourceRefs?: number[] }>;
  competitors?: Array<{ name?: string; country?: string | null; technology?: string; sourceRefs?: number[] }>;
  caveats?: string[];
};

// Reachability probe. Corporate sites (pitchbook, zoominfo, danieli.com)
// commonly reject HEAD with 403/405 even when the page exists — switching to
// GET with a polite browser-shaped UA + Range to limit bytes fixes most false
// negatives. The Range header is advisory (servers may ignore it); the fetch
// itself caps body via the AbortController.
async function isReachable(url: string, timeoutMs = 5000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Patent-Scan/1.0; +https://patent-scan.com)",
        "Range": "bytes=0-1023",
        "Accept": "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
      },
      redirect: "follow",
    });
    // 200 OK or 206 Partial Content both mean the page exists.
    return resp.status === 200 || resp.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export type BuildIUOpts = {
  patentId: string;
  /** Title/country/year passed by the caller if already known; we still fetch
   *  PatSearch metadata for the canonical assignee. */
  patentTitle?: string;
  apiKey: string;
  patsearchToken: string;
  tavilyKey: string;
};

export async function buildIndustrialUsage(opts: BuildIUOpts): Promise<IUReport> {
  const meta = await fetchPatentMeta(opts.patsearchToken, opts.patentId);
  if (!meta || !meta.canonicalAssignee) {
    // Without a canonical assignee we can't do anything meaningful — return a
    // shell report with a caveat so the UI doesn't show a spinner forever.
    const fallbackTitle = meta?.title || opts.patentTitle || opts.patentId;
    return {
      patentId: opts.patentId,
      patentTitle: fallbackTitle,
      assignee: { original: "", canonical: "", country: "", description: "", sourceRefs: [] },
      products: [],
      competitors: [],
      caveats: ["Патентообладатель не определён в открытых источниках PatSearch — карта использования не построена."],
      sources: [],
    };
  }

  const harvest = await harvestStage2(opts.tavilyKey, meta);

  // Build the indexed SOURCES list the synth prompt will cite by number.
  const allPages = [
    ...harvest.companyPages.map((p) => ({ ...p, bucket: "company" as const })),
    ...harvest.productPages.map((p) => ({ ...p, bucket: "product" as const })),
    ...harvest.competitorPages.map((p) => ({ ...p, bucket: "competitor" as const })),
  ];
  // Dedupe by url (Tavily fans across queries — same page can repeat).
  const seenUrls = new Set<string>();
  const dedup = allPages.filter((p) => {
    if (seenUrls.has(p.url)) return false;
    seenUrls.add(p.url);
    return true;
  });
  const indexedSources = dedup.map((p, i) => ({
    ref: i + 1,
    bucket: p.bucket,
    title: p.title,
    url: p.url,
    snippet: p.snippet,
  }));

  if (indexedSources.length === 0) {
    return {
      patentId: opts.patentId,
      patentTitle: meta.title,
      assignee: {
        original: meta.patentees[0] ?? "",
        canonical: meta.canonicalAssignee,
        country: meta.country,
        description: "",
        sourceRefs: [],
      },
      products: [],
      competitors: [],
      caveats: ["Открытых веб-источников по компании и продуктам не найдено."],
      sources: [],
    };
  }

  const userText = [
    `ПАТЕНТ: ${meta.id} (${meta.country}, ${meta.year}) — ${meta.title}`,
    `ПАТЕНТООБЛАДАТЕЛЬ (canonical): ${meta.canonicalAssignee}`,
    meta.abstract ? `АБСТРАКТ: ${meta.abstract.slice(0, 800)}` : "",
    `SOURCES (${indexedSources.length}, разделены по bucket — company/product/competitor):\n${JSON.stringify(
      indexedSources.map((s) => ({ ref: s.ref, bucket: s.bucket, title: s.title, url: s.url, snippet: s.snippet })),
      null,
      2
    )}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { data } = await callGeminiJson<GeminiOutput>({
    apiKey: opts.apiKey,
    label: "iu/synth",
    systemPrompt: SYNTH_PROMPT,
    userText,
    reasoningEffort: "none",
    timeoutMs: 120_000,
  });

  // Filter sourceRefs to existing refs only (defensive; the prompt forbids
  // fabrication but a model may still output a stray index).
  const knownRefs = new Set(indexedSources.map((s) => s.ref));
  const filterRefs = (refs: number[] | undefined) =>
    Array.isArray(refs) ? refs.filter((r) => knownRefs.has(r)) : [];

  // Verify which source URLs are still reachable — sets the "(на момент проверки
  // недоступен)" footnote in the UI.
  const reachable = await Promise.all(
    indexedSources.map(async (s) => ({ ...s, reachedAt: (await isReachable(s.url)) ? new Date().toISOString() : null }))
  );

  const usedRefSet = new Set<number>();
  const products = (data.products ?? [])
    .filter((p) => p?.name && Array.isArray(p.sourceRefs) && p.sourceRefs.length > 0)
    .map((p) => {
      const refs = filterRefs(p.sourceRefs);
      refs.forEach((r) => usedRefSet.add(r));
      return { name: p.name!, description: p.description ?? "", sourceRefs: refs };
    });

  const competitors = (data.competitors ?? [])
    .filter((c) => c?.name && Array.isArray(c.sourceRefs) && c.sourceRefs.length > 0)
    .map((c) => {
      const refs = filterRefs(c.sourceRefs);
      refs.forEach((r) => usedRefSet.add(r));
      return {
        name: c.name!,
        country: c.country ?? undefined,
        technology: c.technology ?? "",
        sourceRefs: refs,
      };
    });

  const assigneeRefs = filterRefs(data.assignee?.sourceRefs);
  assigneeRefs.forEach((r) => usedRefSet.add(r));

  // Trim the §sources list to only the refs the synth actually cited — keeps
  // the UI compact (and reachable% honest, since unused noise pages don't
  // count toward the report's verifiable coverage).
  const finalSources: IUSource[] = reachable
    .filter((s) => usedRefSet.has(s.ref))
    .map((s) => ({ ref: s.ref, title: s.title, url: s.url, reachedAt: s.reachedAt }));

  return {
    patentId: opts.patentId,
    patentTitle: meta.title,
    assignee: {
      original: meta.patentees[0] ?? "",
      canonical: meta.canonicalAssignee,
      country: meta.country,
      description: data.assignee?.description ?? "",
      website: data.assignee?.website,
      sourceRefs: assigneeRefs,
    },
    products,
    competitors,
    caveats: Array.isArray(data.caveats) ? data.caveats : [],
    sources: finalSources,
  };
}
