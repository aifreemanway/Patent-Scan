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
import { DEEP_ANALYSIS_MODEL, DEEP_ANALYSIS_TIMEOUT_MS } from "@/lib/config";
import {
  harvestPatSearch,
  harvestCrossref,
  harvestTavily,
  harvestWikipedia,
  isUrlReachable,
  patsearchDatasetsForRegions,
} from "@/lib/literature-review/sources";
import type {
  LitReviewParams,
  LitReviewReport,
  LitReviewHarvest,
  LitReviewSource,
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
  "queriesRu": ["6-8 точных поисковых запросов на русском, разной формулировки одной темы"],
  "queriesEn": ["6-8 английских запросов параллельно для US/EP/CN/JP-баз"],
  "ipcSubclasses": ["3-5 МПК-классов уровня subclass (C22B / B22F / ...)"],
  "workingTitle": "Рабочий заголовок для обзора, 6-12 слов, формальный"
}

Правила:
- Запросы — точные термины, не вопросы. Используй синонимы, иностранные эквиваленты.
- IPC: только реально существующие subclass-коды. Если темa не патентная — пустой массив.`;

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
export async function stage2(
  params: LitReviewParams,
  s1: Stage1Output
): Promise<LitReviewHarvest> {
  const patsearchToken = process.env.PATSEARCH_TOKEN ?? "";
  const tavilyKey = process.env.TAVILY_API_KEY ?? "";
  const datasets = patsearchDatasetsForRegions(params.regions);

  // Cap the breadth — Sonnet's context for Stage 3 has a budget. We're after
  // the most relevant hits per source, not exhaustive scrapes.
  const patentPromises = s1.queriesRu
    .concat(s1.queriesEn)
    .slice(0, 6)
    .map((q) =>
      harvestPatSearch({
        token: patsearchToken,
        query: q,
        datasets,
        limit: 15,
        periodFrom: params.periodFrom,
        periodTo: params.periodTo,
      })
    );

  const scholarPromises = s1.queriesEn
    .slice(0, 4)
    .map((q) =>
      harvestCrossref({
        query: q,
        rows: 10,
        periodFrom: params.periodFrom,
        periodTo: params.periodTo,
      })
    );

  const webPromises = s1.queriesRu
    .concat(s1.queriesEn)
    .slice(0, 4)
    .map((q) => harvestTavily({ apiKey: tavilyKey, query: q, maxResults: 6 }));

  const wikiPromises = [params.topic, ...s1.queriesRu.slice(0, 2)].map((q) =>
    harvestWikipedia(q)
  );

  const [patentBatches, scholarBatches, webBatches, wikiBatches] = await Promise.all([
    Promise.all(patentPromises),
    Promise.all(scholarPromises),
    Promise.all(webPromises),
    Promise.all(wikiPromises),
  ]);

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
// Stages 3+4+5+6+8 — single Sonnet synthesis call producing the structured report
// ─────────────────────────────────────────────────────────────
// To control cost and complexity, we collapse the synthesis stages into one
// Sonnet call with a strict output schema. Sonnet sees the full harvest + an
// indexed source list, returns the structured `LitReviewReport`. This is the
// «interesting» work of the pipeline — the prompt below carries the spec's
// anti-fabrication rules and §4 (tables), §3 (technologies), §1 (classification),
// §4-conclusions, §6 (caveats) requirements in one place.

const SYNTH_PROMPT = `Ты — отраслевой аналитик, готовишь литературный обзор по заданной теме на основе предоставленных открытых источников (патенты, научные статьи, web, Wikipedia). Каждый источник в списке SOURCES имеет порядковый номер ref — используй его для цитирования.

КРИТИЧЕСКОЕ ПРАВИЛО АНТИ-ФАБРИКАЦИИ: используй ТОЛЬКО данные из SOURCES. Никаких выдуманных компаний, технологий, цифр, ссылок. Если в источниках нет ответа на пункт — раздел "caveats" должен это явно отметить, не достраивай.

Верни СТРОГО валидный JSON, соответствующий схеме:
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
  "comparativeTables": [
    {
      "title": "Таблица 1. Заголовок группы (например 'Крупнейшие производители X')",
      "columns": ["Параметр", "Компания A", "Компания B", "Компания C"],
      "rows": [
        {
          "label": "Местоположение",
          "cells": ["—", "Финляндия", "Канада", "Китай"],
          "sourceRefs": [3, 8]
        }
        // 5-9 строк (Местоположение, Сырьё, Технология, Продукт, Мощность, Особенности, Источники)
      ]
    }
    // 2-4 таблицы
  ],
  "technologies": [
    {
      "name": "название технологии",
      "description": "2-3 предложения",
      "pros": ["плюс 1", "плюс 2"],
      "cons": ["минус 1", "минус 2"],
      "sourceRefs": [4, 9]
    }
    // 4-8 элементов
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
- Если в SOURCES менее 5 источников для какой-то группы — не делай таблицу, отметь в caveats.
- Не используй маркеры markdown — это будет рендерить worker.
- Сохраняй ёмкость: каждый текст 1-3 предложения, не "вода".`;

type Stage3to8Input = {
  sources: Array<{ ref: number; title: string; url: string; snippet?: string }>;
};

export async function stage3to8(
  apiKey: string,
  params: LitReviewParams,
  sources: LitReviewSource[],
  enrichmentSnippets: Map<string, string>
): Promise<LitReviewReport> {
  const inp: Stage3to8Input = {
    sources: sources.map((s) => ({
      ref: s.ref,
      title: s.title.slice(0, 300),
      url: s.url,
      snippet: enrichmentSnippets.get(s.url)?.slice(0, 800),
    })),
  };

  const userText = [
    `ТЕМА: ${params.topic}`,
    `ОТРАСЛЬ: ${params.industry}`,
    `РЕГИОНЫ: ${params.regions.join(", ")}`,
    `ПЕРИОД: ${params.periodFrom}-${params.periodTo}`,
    params.hypotheses ? `ГИПОТЕЗЫ ПОЛЬЗОВАТЕЛЯ: ${params.hypotheses}` : "",
    `SOURCES (${inp.sources.length} штук):\n${JSON.stringify(inp.sources, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { data } = await callTimewebJson<LitReviewReport>({
    apiKey,
    label: "litreview/synth",
    model: DEEP_ANALYSIS_MODEL,
    systemPrompt: SYNTH_PROMPT,
    userText,
    timeoutMs: DEEP_ANALYSIS_TIMEOUT_MS,
  });

  // Validate sourceRefs against the actual source list to drop any fabricated
  // numbers (defensive — the prompt forbids this, but a model may slip).
  const knownRefs = new Set(sources.map((s) => s.ref));
  const filterRefs = (refs: number[] | undefined) =>
    Array.isArray(refs) ? refs.filter((r) => knownRefs.has(r)) : [];

  return {
    title: typeof data.title === "string" ? data.title : params.topic,
    scope: typeof data.scope === "string" ? data.scope : "",
    overview: typeof data.overview === "string" ? data.overview : "",
    classification: (Array.isArray(data.classification) ? data.classification : []).map((c) => ({
      name: c.name ?? "",
      description: c.description ?? "",
      sourceRefs: filterRefs(c.sourceRefs),
    })),
    comparativeTables: (Array.isArray(data.comparativeTables) ? data.comparativeTables : []).map(
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
    technologies: (Array.isArray(data.technologies) ? data.technologies : []).map((t) => ({
      name: t.name ?? "",
      description: t.description ?? "",
      pros: Array.isArray(t.pros) ? t.pros : [],
      cons: Array.isArray(t.cons) ? t.cons : [],
      sourceRefs: filterRefs(t.sourceRefs),
    })),
    conclusions: (Array.isArray(data.conclusions) ? data.conclusions : []).map((c) => ({
      text: c.text ?? "",
      sourceRefs: filterRefs(c.sourceRefs),
    })),
    sources,
    caveats: Array.isArray(data.caveats) ? data.caveats : [],
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
