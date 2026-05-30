// The 9-stage literature-review pipeline. Each stage is an idempotent unit:
// given the same input (or partial-progress checkpoint), it produces the same
// output and writes its slice into the in-memory `LitReviewReport`. The worker
// caller (./index.ts) sequences them, persists progress after each, and on
// error retries by re-running from Stage 1 (cost is small relative to the
// alternative of patching arbitrary mid-pipeline state).
//
// Anti-fabrication is enforced at the prompt level (Sonnet is told «cite only
// from the provided harvest») and structurally — Stage 4 / 5 / 6 reference
// sources by their `ref` index from the §5 list, so any made-up number stands
// out (we filter unknown refs before rendering).

import { callTimewebJson } from "@/lib/timeweb";
import { DEEP_ANALYSIS_MODEL, DEEP_ANALYSIS_TIMEOUT_MS, LIT_REVIEW_SYNTH_MODEL } from "@/lib/config";
import {
  harvestPatSearch,
  harvestCrossref,
  harvestOpenAlex,
  harvestTavily,
  harvestWikipedia,
  isUrlReachable,
  patsearchDatasetsRuForRegions,
  patsearchDatasetsEnForRegions,
} from "@/lib/literature-review/sources";
import type {
  LitReviewParams,
  LitReviewReport,
  LitReviewHarvest,
  LitReviewSource,
  LitReviewWebHit,
} from "@/lib/literature-review/types";

// ─────────────────────────────────────────────────────────────
// Stage 1 — query expansion
// ─────────────────────────────────────────────────────────────
type Stage1Output = {
  queriesRu: string[];
  queriesEn: string[];
  ipcSubclasses: string[];
  workingTitle: string;
};

const STAGE1_PROMPT = `Ты — эксперт по составлению поисковых запросов для патентных и научных баз. На вход — тема обзора, отрасль, регионы, период. Сгенерируй пул запросов для глубокого литобзора.

Верни СТРОГО валидный JSON:
{
  "queriesRu": ["6-8 коротких плотных запросов на русском: 5-15 слов через пробел, ключевые технические термины"],
  "queriesEn": ["6-8 английских аналогов того же смысла, 5-15 слов через пробел"],
  "ipcSubclasses": ["3-5 МПК-классов уровня subclass (C22B / B22F / ...)"],
  "workingTitle": "Рабочий заголовок для обзора, 6-12 слов, формальный"
}

КРИТИЧНО — формат queriesRu / queriesEn:
- Это семантический neural-search по полю qn в PatSearch / Crossref / Tavily. Длинные фразы и вопросы выдают мусор; плотные термы — релевантные хиты.
- Только существительные и ключевые прилагательные через пробел или запятую
- НЕ предложения, НЕ вопросы, НЕ глаголы-сказуемые
- Включи: тип объекта/материала, метод/процесс, отличительные технические признаки, синонимы

Примеры правильного формата:
- "диагностика асинхронного электродвигателя сигнатурный анализ тока MCSA"
- "asynchronous motor diagnostics current signature analysis MCSA"
- "переработка триоксид сурьмы пирометаллургия гидрометаллургия стибнит"
- "antimony trioxide processing pyrometallurgy hydrometallurgy stibnite leaching"

Правила queriesRu vs queriesEn:
- queriesRu — для русскоязычных баз (PatSearch RU/CIS, Wikipedia RU)
- queriesEn — для англоязычных баз (PatSearch US/EP/CN/JP, Crossref, Tavily web)
- Оба покрывают одну тему, разной формулировкой и синонимами

Правила ipcSubclasses:
- Только реально существующие subclass-коды (4 символа: буква-2цифры-буква, например C22B, B22F, G01R)
- Если темa не патентная или нет очевидных классов — пустой массив`;

export async function stage1(
  apiKey: string,
  params: LitReviewParams
): Promise<Stage1Output> {
  const userText = JSON.stringify({
    topic: params.topic,
    industry: params.industry,
    regions: params.regions,
    period: `${params.periodFrom}-${params.periodTo}`,
    hypotheses: params.hypotheses || "(не задано)",
  });

  const { data } = await callTimewebJson<Stage1Output>({
    apiKey,
    label: "litreview/stage1",
    model: DEEP_ANALYSIS_MODEL,
    systemPrompt: STAGE1_PROMPT,
    userText,
    timeoutMs: DEEP_ANALYSIS_TIMEOUT_MS,
  });

  return {
    queriesRu: Array.isArray(data.queriesRu) ? data.queriesRu.slice(0, 8) : [],
    queriesEn: Array.isArray(data.queriesEn) ? data.queriesEn.slice(0, 8) : [],
    ipcSubclasses: Array.isArray(data.ipcSubclasses) ? data.ipcSubclasses.slice(0, 5) : [],
    workingTitle: typeof data.workingTitle === "string" ? data.workingTitle : params.topic,
  };
}

// ─────────────────────────────────────────────────────────────
// Stage 2 — parallel data harvesting
// ─────────────────────────────────────────────────────────────
// Topical keywords for the Crossref relevance filter. Pulls distinctive nouns
// from Stage 1's tightest query (which Sonnet generated as plain technical
// terms per the updated prompt). Drops short/connective words; everything ≥4
// chars and not in the stoplist counts as a topical term.
const KEYWORD_STOPLIST = new Set([
  "and", "the", "for", "with", "from", "this", "that", "into", "over",
  "которые", "который", "технологии", "технология", "методы", "метод",
  "анализ", "review", "study", "based",
]);
function extractTopicalKeywords(s1: Stage1Output, topic: string): string[] {
  const pool = [s1.queriesRu[0] ?? "", s1.queriesEn[0] ?? "", topic].join(" ");
  const words = pool
    .toLowerCase()
    .split(/[\s,.;:()\[\]"']+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !KEYWORD_STOPLIST.has(w));
  return Array.from(new Set(words)).slice(0, 12);
}

export async function stage2(
  params: LitReviewParams,
  s1: Stage1Output
): Promise<LitReviewHarvest> {
  const patsearchToken = process.env.PATSEARCH_TOKEN ?? "";
  const tavilyKey = process.env.TAVILY_API_KEY ?? "";
  const datasetsRu = patsearchDatasetsRuForRegions(params.regions);
  const datasetsEn = patsearchDatasetsEnForRegions(params.regions);
  const topicalTerms = extractTopicalKeywords(s1, params.topic);

  // PatSearch: RU queries → RU datasets, EN queries → EN datasets.
  // Mixing (a RU phrase against `us`/`ep`/`cn`/`jp`) gives 0 hits — that was the
  // bug that produced patents=0 on the v1 POC. Same pattern as novelty's
  // /api/search-rospatent split branches.
  const ruPatentPromises = s1.queriesRu
    .slice(0, 4)
    .map((q) =>
      harvestPatSearch({
        token: patsearchToken,
        query: q,
        datasets: datasetsRu,
        limit: 15,
        ipcCodes: s1.ipcSubclasses,
      })
    );
  const enPatentPromises = s1.queriesEn
    .slice(0, 4)
    .map((q) =>
      harvestPatSearch({
        token: patsearchToken,
        query: q,
        datasets: datasetsEn,
        limit: 15,
        ipcCodes: s1.ipcSubclasses,
      })
    );

  // Scholarly harvest: Crossref + OpenAlex in parallel. Crossref skews to
  // publisher metadata, OpenAlex to broader academic coverage (200M+ works);
  // overlap is deduped downstream by DOI. Both apply the relevance filter so
  // single-keyword noise (e.g. "share market" for "antimony market share")
  // doesn't reach the synth stage.
  const scholarPromises = [
    ...s1.queriesEn.slice(0, 4).map((q) =>
      harvestCrossref({
        query: q,
        rows: 10,
        periodFrom: params.periodFrom,
        periodTo: params.periodTo,
        requireTerms: topicalTerms,
      })
    ),
    ...s1.queriesEn.slice(0, 4).map((q) =>
      harvestOpenAlex({
        query: q,
        perPage: 15,
        periodFrom: params.periodFrom,
        periodTo: params.periodTo,
        requireTerms: topicalTerms,
      })
    ),
  ];

  const webPromises = s1.queriesRu
    .concat(s1.queriesEn)
    .slice(0, 4)
    .map((q) => harvestTavily({ apiKey: tavilyKey, query: q, maxResults: 6 }));

  // Wikipedia REST API rate-limits at ~10 req/s; running 3 in parallel triggered
  // 429 on the POC. Run sequentially with a small gap and a polite UA (set in
  // harvestWikipedia).
  const wikiQueries = [params.topic, ...s1.queriesRu.slice(0, 2)];
  const wikiBatches: LitReviewWebHit[][] = [];
  for (const q of wikiQueries) {
    wikiBatches.push(await harvestWikipedia(q));
    await new Promise((r) => setTimeout(r, 300));
  }

  const [patentRuBatches, patentEnBatches, scholarBatches, webBatches] = await Promise.all([
    Promise.all(ruPatentPromises),
    Promise.all(enPatentPromises),
    Promise.all(scholarPromises),
    Promise.all(webPromises),
  ]);
  const patentBatches = [...patentRuBatches, ...patentEnBatches];

  // Dedupe by primary key per source
  const dedupBy = <T,>(arr: T[], key: (x: T) => string): T[] => {
    const seen = new Set<string>();
    return arr.filter((x) => {
      const k = key(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  return {
    patents: dedupBy(patentBatches.flat(), (p) => p.id),
    scholar: dedupBy(scholarBatches.flat(), (s) => s.doi || s.url),
    web: dedupBy(webBatches.flat(), (w) => w.url),
    wiki: dedupBy(wikiBatches.flat(), (w) => w.url),
  };
}

// ─────────────────────────────────────────────────────────────
// Stages 3-8 — synthesis, split into two parallel Sonnet calls
// ─────────────────────────────────────────────────────────────
// One combined call kept hitting the Timeweb gateway's ~300-400s ceiling on
// ≥16k-output workloads (verified across POC #2/#3/#5: Sonnet returns 408,
// Opus returns 500 — both upstream caps). Splitting the synthesis into two
// independent calls — one for the structured prose (overview + classification
// + technologies + conclusions + caveats), one for the comparative tables —
// keeps each output ≤8k, runs in parallel, and totals ~150-200s wall-clock.
// They share the same SOURCES list and are merged client-side.

const COMMON_PROMPT_PREFIX = `Ты — отраслевой аналитик, готовишь литературный обзор по заданной теме на основе предоставленных открытых источников (патенты, научные статьи, web, Wikipedia). Каждый источник в списке SOURCES имеет порядковый номер ref — используй его для цитирования.

КРИТИЧЕСКОЕ ПРАВИЛО АНТИ-ФАБРИКАЦИИ: используй ТОЛЬКО данные из SOURCES. Никаких выдуманных компаний, технологий, цифр, ссылок. Если в источниках нет ответа на пункт — отметь это явно в caveats (если они есть в твоей задаче), не достраивай.

`;

const SYNTH_REST_PROMPT = COMMON_PROMPT_PREFIX + `Твоя задача в этом вызове — структурная часть отчёта БЕЗ таблиц.

Верни СТРОГО валидный JSON:
{
  "title": "формальный заголовок обзора, 6-12 слов",
  "scope": "1 предложение: что охватили (период, регионы, тип данных)",
  "overview": "3-4 предложения: общая картина по теме на основе SOURCES",
  "classification": [
    {
      "name": "название класса/группы (например 'Пирометаллургические методы')",
      "description": "1-2 предложения",
      "sourceRefs": [1, 5, 12]
    }
    // 4-8 элементов
  ],
  "technologies": [
    {
      "name": "название технологии",
      "description": "2-3 предложения",
      "pros": ["плюс 1", "плюс 2"],
      "cons": ["минус 1", "минус 2"],
      "sourceRefs": [4, 9]
    }
    // 6-10 элементов (это самая весомая часть отчёта)
  ],
  "conclusions": [
    {
      "text": "1-2 предложения вывода или тренда",
      "sourceRefs": [1, 7]
    }
    // 5-7 элементов
  ],
  "caveats": [
    "честное замечание #1 — что не покрыли, где данные неполны",
    "честное замечание #2"
    // 3-6 пунктов
  ]
}

Правила:
- sourceRefs: ТОЛЬКО числа из списка SOURCES, без выдумывания.
- Не используй маркеры markdown в тексте — это будет рендерить worker.
- ЁМКОСТЬ: 1-2 коротких предложения на пункт, БЕЗ воды. Это критично — общий объём ответа должен влезть в 8000 токенов.
- НЕ генерируй таблицы — они идут отдельным вызовом.`;

const SYNTH_TABLES_PROMPT = COMMON_PROMPT_PREFIX + `Твоя задача — сгенерировать ТОЛЬКО сравнительные таблицы для отчёта.

Верни СТРОГО валидный JSON:
{
  "comparativeTables": [
    {
      "title": "Заголовок группы — БЕЗ префикса 'Таблица N.' (нумерацию добавит рендерер)",
      "columns": ["Параметр", "Колонка A", "Колонка B", "Колонка C"],
      "rows": [
        {
          "label": "Местоположение",
          "cells": ["—", "Финляндия", "Канада", "Китай"],
          "sourceRefs": [3, 8]
        }
        // 5-9 строк характеристик
      ]
    }
    // 3-5 таблиц
  ]
}

Правила axis of comparison — выбирай ось сравнения исходя из topic'а:
- если topic упоминает производителей / компании / предприятия / поставщиков → колонки = КОМПАНИИ (Параметр × Outokumpu × Hindustan Zinc × China Minmetals)
- если topic про методы / технологии / процессы → колонки = МЕТОДЫ (Параметр × Пирометаллургия × Гидрометаллургия × Электролиз)
- если про материалы / продукты → колонки = МАТЕРИАЛЫ
- если про регионы / рынки / страны → колонки = РЕГИОНЫ

Целься в 3-5 таблиц, разрезающих тему с разных сторон. Например для «производители Sb₂O₃ в РФ и КНР»:
  1) Крупнейшие производители (компании × характеристики)
  2) Производственные мощности по странам (страна × объём, динамика, доля)
  3) Технологические схемы переработки (метод × сырьё, выход, цена)
  4) Патентная активность (страна/держатель × число патентов, ключевые направления)

Правила в целом:
- sourceRefs: ТОЛЬКО числа из списка SOURCES, без выдумывания.
- Если в SOURCES менее 5 источников для какой-то таблицы — пропусти именно эту таблицу; постарайся набрать ≥3 таблиц в сумме за счёт других разрезов.
- title таблицы: краткий заголовок группы БЕЗ префикса «Таблица N.» (нумерация добавится автоматически).
- Не используй маркеры markdown в тексте — это будет рендерить worker.
- Сохраняй ёмкость: каждый текст 1-3 предложения, не "вода".`;

type SynthSourceInput = { ref: number; title: string; url: string; snippet?: string };

// Cap synthesis input. 130 sources × 800-char snippets = ~150k input + ~15k
// output → Sonnet hit Timeweb's 408 ceiling. Capped at 80 + 500-char snippets
// the prompt fits comfortably for each of the two parallel synth calls.
const SYNTH_MAX_SOURCES = 80;
const SYNTH_SNIPPET_CHARS = 500;

function buildSynthUserText(
  params: LitReviewParams,
  sources: SynthSourceInput[]
): string {
  return [
    `ТЕМА: ${params.topic}`,
    `ОТРАСЛЬ: ${params.industry}`,
    `РЕГИОНЫ: ${params.regions.join(", ")}`,
    `ПЕРИОД: ${params.periodFrom}-${params.periodTo}`,
    params.hypotheses ? `ГИПОТЕЗЫ ПОЛЬЗОВАТЕЛЯ: ${params.hypotheses}` : "",
    `SOURCES (${sources.length} штук):\n${JSON.stringify(sources, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

type RestPayload = Omit<LitReviewReport, "comparativeTables" | "sources">;
type TablesPayload = Pick<LitReviewReport, "comparativeTables">;

export async function stage3to8(
  apiKey: string,
  params: LitReviewParams,
  sources: LitReviewSource[],
  enrichmentSnippets: Map<string, string>
): Promise<LitReviewReport> {
  const synthSources: SynthSourceInput[] = sources.slice(0, SYNTH_MAX_SOURCES).map((s) => ({
    ref: s.ref,
    title: s.title.slice(0, 300),
    url: s.url,
    snippet: enrichmentSnippets.get(s.url)?.slice(0, SYNTH_SNIPPET_CHARS),
  }));
  const userText = buildSynthUserText(params, synthSources);

  // Two parallel calls — see comment block above for the rationale on why this
  // was split. Both use Sonnet 4.6 (Opus on Timeweb 500's at this size); each
  // emits ≤8k output so neither hits the gateway ceiling.
  const [restResult, tablesResult] = await Promise.all([
    // Both calls capped at 8k output tokens — POC #6 showed tables (5k output)
    // succeeded at 18₽ in <280s, but rest at 12k output hit 408. The Timeweb
    // ceiling is on think-time-per-call, and think-time scales with output
    // size. 8k output forces Sonnet to be tighter (1-2 sentences per item
    // instead of 2-3) and clears the gateway timeout.
    callTimewebJson<RestPayload>({
      apiKey,
      label: "litreview/synth-rest",
      model: DEEP_ANALYSIS_MODEL,
      systemPrompt: SYNTH_REST_PROMPT,
      userText,
      maxTokens: 8_000,
      timeoutMs: 280_000,
    }),
    callTimewebJson<TablesPayload>({
      apiKey,
      label: "litreview/synth-tables",
      model: DEEP_ANALYSIS_MODEL,
      systemPrompt: SYNTH_TABLES_PROMPT,
      userText,
      maxTokens: 8_000,
      timeoutMs: 280_000,
    }),
  ]);
  const rest = restResult.data;
  const tables = tablesResult.data;

  // Validate sourceRefs against the actual source list to drop any fabricated
  // numbers (defensive — the prompt forbids this, but a model may slip).
  const knownRefs = new Set(sources.map((s) => s.ref));
  const filterRefs = (refs: number[] | undefined) =>
    Array.isArray(refs) ? refs.filter((r) => knownRefs.has(r)) : [];

  return {
    title: typeof rest.title === "string" ? rest.title : params.topic,
    scope: typeof rest.scope === "string" ? rest.scope : "",
    overview: typeof rest.overview === "string" ? rest.overview : "",
    classification: (Array.isArray(rest.classification) ? rest.classification : []).map((c) => ({
      name: c.name ?? "",
      description: c.description ?? "",
      sourceRefs: filterRefs(c.sourceRefs),
    })),
    comparativeTables: (Array.isArray(tables.comparativeTables) ? tables.comparativeTables : []).map(
      (t) => ({
        title: t.title ?? "",
        columns: Array.isArray(t.columns) ? t.columns : [],
        rows: (Array.isArray(t.rows) ? t.rows : []).map((r) => ({
          label: r.label ?? "",
          cells: Array.isArray(r.cells) ? r.cells : [],
          sourceRefs: filterRefs(r.sourceRefs),
        })),
      })
    ),
    technologies: (Array.isArray(rest.technologies) ? rest.technologies : []).map((t) => ({
      name: t.name ?? "",
      description: t.description ?? "",
      pros: Array.isArray(t.pros) ? t.pros : [],
      cons: Array.isArray(t.cons) ? t.cons : [],
      sourceRefs: filterRefs(t.sourceRefs),
    })),
    conclusions: (Array.isArray(rest.conclusions) ? rest.conclusions : []).map((c) => ({
      text: c.text ?? "",
      sourceRefs: filterRefs(c.sourceRefs),
    })),
    sources,
    caveats: Array.isArray(rest.caveats) ? rest.caveats : [],
  };
}

// ─────────────────────────────────────────────────────────────
// Stage 7 — source verification (HEAD checks, in parallel batches)
// ─────────────────────────────────────────────────────────────
export async function stage7VerifySources(sources: LitReviewSource[]): Promise<LitReviewSource[]> {
  // Cap parallelism — public APIs can rate-limit on bursts. 10-at-a-time is conservative.
  const batchSize = 10;
  const verified: LitReviewSource[] = [];
  for (let i = 0; i < sources.length; i += batchSize) {
    const batch = sources.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (s) => ({
        ...s,
        reachedAt: (await isUrlReachable(s.url)) ? new Date().toISOString() : null,
      }))
    );
    verified.push(...results);
  }
  return verified;
}

// ─────────────────────────────────────────────────────────────
// Build the §5 source list from the harvest (numbered, deduped)
// ─────────────────────────────────────────────────────────────
export function harvestToSources(harvest: LitReviewHarvest): {
  sources: LitReviewSource[];
  snippets: Map<string, string>;
} {
  const sources: LitReviewSource[] = [];
  const snippets = new Map<string, string>();
  const seenUrl = new Set<string>();

  const push = (
    title: string,
    url: string,
    provenance: LitReviewSource["provenance"],
    snippet?: string
  ) => {
    if (!url || seenUrl.has(url)) return;
    seenUrl.add(url);
    sources.push({
      ref: sources.length + 1,
      title: title.slice(0, 300),
      url,
      reachedAt: null, // filled by stage 7
      provenance,
    });
    if (snippet) snippets.set(url, snippet);
  };

  for (const p of harvest.patents) {
    push(`${p.id} — ${p.title || "(без названия)"} (${p.country} ${p.year})`, p.url, "patsearch", p.abstract);
  }
  for (const s of harvest.scholar) {
    const authors = s.authors.slice(0, 3).join(", ");
    push(`${authors ? authors + ". " : ""}${s.title}${s.year ? " (" + s.year + ")" : ""}`, s.url, s.doi ? "crossref" : "openalex", s.abstract);
  }
  for (const w of harvest.web) {
    push(w.title, w.url, "tavily", w.snippet);
  }
  for (const w of harvest.wiki) {
    push(w.title, w.url, "wikipedia", w.snippet);
  }

  return { sources, snippets };
}
