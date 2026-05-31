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
import { callGeminiJson } from "@/lib/gemini";
import { DEEP_ANALYSIS_MODEL, DEEP_ANALYSIS_TIMEOUT_MS } from "@/lib/config";
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
import {
  isBlacklistedUrl,
  filterByRelevance,
} from "@/lib/literature-review/source-sanitizer";
import {
  augmentReportTables,
  normalizeTableCellCounts,
  validateLLMCells,
  deriveTopicKeywords,
} from "@/lib/literature-review/source-augmentation";
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
  /** May contain full-precision IPC codes ("H01M 4/58") and/or subclasses ("H01M").
   *  Field name kept for back-compat with POC scripts; harvestPatSearch splits both. */
  ipcSubclasses: string[];
  workingTitle: string;
  /** PR-3.6.4 (ap-ba v2 review issue #2a): canonical lead companies in the
   *  topic's industry. Used by SYNTH_TABLES_PROMPT to seed the players-table
   *  columns so the model doesn't drift to tangentially-related firms
   *  (e.g. Longi-solar / Газпром-gas for an H2-electrolyzer topic). */
  seedCompanies?: string[];
};

const STAGE1_PROMPT = `Ты — эксперт по составлению поисковых запросов для патентных и научных баз. На вход — тема обзора, отрасль, регионы, период. Сгенерируй пул запросов для глубокого литобзора.

Верни СТРОГО валидный JSON:
{
  "queriesRu": ["6-8 коротких плотных запросов на русском: 5-15 слов через пробел, ключевые технические термины"],
  "queriesEn": ["6-8 английских аналогов того же смысла, 5-15 слов через пробел"],
  "ipcSubclasses": ["3-7 МПК-кодов уровня подгруппы (subgroup), формат 'буква-2цифры-буква пробел число/число', например 'C25B 1/04', 'H01M 4/58'. Допустимо 1-2 subclass'а как fallback (4-символьные 'C25B', 'H01M') ТОЛЬКО для очень широких тем"],
  "workingTitle": "Рабочий заголовок для обзора, 6-12 слов, формальный",
  "seedCompanies": ["4-6 canonical компаний-лидеров в данной области — глобальные производители ключевой технологии topic'а. См. КРИТИЧНО ниже."]
}

КРИТИЧНО — формат seedCompanies:
- Это canonical PRIMARY-business firms в данной narrow области. Если topic = «водородные электролизеры» — выбирай чистых electrolyzer manufacturers (Nel Hydrogen, ITM Power, Plug Power, Cummins/Hydrogenics, Siemens Energy, McPhy). НЕ Longi (solar primary), НЕ Газпром (gas primary, водород экспериментально).
- Если topic = «LFP-батареи» — CATL, BYD, Gotion High-tech, EVE Energy, CALB. НЕ Tesla (battery user).
- Если topic = «триоксид сурьмы» — Hsikwangshan Twinkling Star, Chenzhou Mining Group, Mandalay Resources. НЕ DuPont (downstream user).
- Принцип: компания должна иметь PRIMARY business = topic technology, НЕ adjacent / downstream / spinoff в этой нише.
- 4-6 имён, формат "Company Name" или "Company Name (страна, тикер)" если уверен в ticker.
- Если topic настолько narrow что canonical список тебе НЕ известен — пустой массив []. ЗАПРЕЩЕНО guessing.

КРИТИЧНО — формат queriesRu / queriesEn:
- Это семантический neural-search по полю qn в PatSearch / Crossref / Tavily. Длинные фразы и вопросы выдают мусор; плотные термы — релевантные хиты.
- Только существительные и ключевые прилагательные через пробел или запятую
- НЕ предложения, НЕ вопросы, НЕ глаголы-сказуемые
- Включи: тип объекта/материала, метод/процесс, отличительные технические признаки, синонимы

Примеры правильного формата (РАЗНЫЕ темы — это шаблон формы, не содержания):
- RU: "диагностика асинхронного электродвигателя сигнатурный анализ тока MCSA"
- EN: "asynchronous motor diagnostics current signature analysis MCSA"
- RU: "литий-ионный аккумулятор катод LiFePO4 деградация ёмкости циклирование"
- EN: "lithium-ion battery LiFePO4 cathode capacity fade cycling degradation"

Правила queriesRu vs queriesEn:
- queriesRu — для русскоязычных баз (PatSearch RU/CIS, Wikipedia RU)
- queriesEn — для англоязычных баз (PatSearch US/EP/CN/JP, Crossref, Tavily web)
- Оба покрывают одну тему, разной формулировкой и синонимами

КРИТИЧНО — формат ipcSubclasses (на самом деле теперь IPC subgroup codes):
- ПРИОРИТЕТ — subgroup-level коды (формат "буква-2цифры-буква пробел число/число", например "C25B 1/04", "H01M 4/58", "H01M 10/0525"). Эти precise — отсечёт off-topic патенты в pre-filter.
- ИЗБЕГАЙ subclass-only ("C25B", "H01M") — они слишком широкие, попадают электролитическая рафинировка металла, литий-серные батареи, etc.
- 3-7 кодов. Для unknown patent тем — пустой массив.

Примеры по domain (для понимания глубины — не используй буквально, выводи под тему):
- Водородные электролизёры: ["C25B 1/04", "C25B 9/19", "C25B 11/00", "H01M 8/10", "H01M 8/18"]
- LFP батареи: ["H01M 4/58", "H01M 4/136", "H01M 10/0525", "H01M 4/505"]
- Сурьмяная металлургия: ["C22B 30/02", "C22B 7/00", "C01G 30/00"]
- Антибиотики (биосимиляры): ["C07K 16/00", "C12N 15/13", "A61K 39/395"]`;

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
  // ⚠ КРИТИЧНО — pros/cons обязательны для КАЖДОЙ технологии (ap-ba v2.1 review issue #4):
  //   - cons: МИНИМУМ 1 элемент. Если в SOURCES нет конкретного cons — НЕ опускай поле, пиши явный
  //     fallback: "литературные данные ограничены; типичные ограничения метода — <generic-cap>"
  //     где <generic-cap> подставь из реальных известных ограничений химии/процесса
  //     (например, для гидротермального синтеза LFP — высокие давления и автоклавная инфраструктура;
  //     для микроволнового — низкая масштабируемость; для распылительной сушки — узкое окно реагентов).
  //   - pros: МИНИМУМ 1 элемент аналогично — если sources не дали, пиши «общеизвестные преимущества метода — <generic-pro>».
  //   - Никогда не выпускай технологию с пустым cons[] или pros[] — это «шаблон MAB v0» regression.
  "conclusions": [
    {
      "text": "СТРАТЕГИЧЕСКИЙ вывод 1-2 предложения, с конкретикой (см. правила ниже)",
      "sourceRefs": [1, 7]
    }
    // РОВНО 5-7 элементов; ОБЯЗАТЕЛЬНО покрыть категории (минимум по одному пункту на категорию):
    //   • Доминанты — КТО (компания из Tab.1) контролирует КАКУЮ долю / производит сколько (число)
    //   • Стратегические риски — концентрация (% откуда), санкции (юрисдикция), регуляторика (страна, год)
    //   • Тренды и драйверы — М&A (кто кого, год), запуск новых мощностей (компания, capacity, год), geo shifts (откуда → куда)
    //   • Регуляторика — конкретные акты / стандарты / экспортный контроль (страна, год, что меняется)
    //   • Технологический outlook — какая технология (название) уходит / приходит, с какой скоростью / по какой причине
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
- НЕ генерируй таблицы — они идут отдельным вызовом.

КРИТИЧНО — правила для §4 conclusions (ap-ba review 2026-05-31 issue #2, v1 failed 0/6):

КАЖДЫЙ пункт ОБЯЗАН содержать МИНИМУМ ТРИ из четырёх элементов:
  (a) ЧИСЛО — доля рынка %, capacity (GWh/тонн/MW), выручка ($/₽), год (2018/2024/2027)
  (b) КОНКРЕТНУЮ КОМПАНИЮ — название из SOURCES (CATL / Nel Hydrogen / Hsikwangshan), не «лидеры рынка»
  (c) ACTION для stakeholder — что это значит для покупателя / производителя / инвестора (НЕ описательный «развивается»)
  (d) NON-LINEAR событие — M&A (X купил Y в Z году), регуляторный shift (страна ввела X в Z году), geo shift (X переезжает из Y в Z), технологический breakthrough (X замещает Y)

ЗАПРЕЩЁННЫЕ паттерны (автоматический fail в review):
  ❌ «Рынок активно развивается с акцентом на снижение стоимости»
  ❌ «Ключевые тренды включают декарбонизацию и интеграцию с возобновляемыми источниками»
  ❌ «Регуляторика играет важную роль в формировании рынка»
  ❌ «Технологический прогресс продолжается»
  ❌ «Различные компании предлагают разнообразные решения»

ЭТАЛОНЫ (формат, не содержание — выводи под топик):
  ✓ «≥90% мирового производства Sb₂O₃ — КНР (Hsikwangshan + Chenzhou + 7 заводов Лэншуйцзяна), что создаёт single-country supply risk при санкциях; покупателям ATO в ЕС/США планировать diversification.»
  ✓ «CATL контролирует ~38% global EV battery market в 2024 (BloombergNEF); Cummins выкупила Hydrogenics в 2019 чтобы войти в green-H2 — повторение M&A consolidation pattern ожидается 2026-2028.»
  ✓ «ЕС CBAM с 1 октября 2026 поднимет cost-impact на импорт аккумуляторов из КНР на ~7-12% (ICCT estimate) — российским производителям LFP открывается ниша, если запустят capacity до конца 2025.»

Если в SOURCES не хватает данных под все 5 категорий — заполни сколько есть (минимум 5 пунктов), остальное явно вынеси в caveats: «§4 не покрыл регуляторику — в источниках нет данных по конкретным актам».`;

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

⚠ КРИТИЧНО — ПЕРВАЯ ТАБЛИЦА (comparativeTables[0]) ОБЯЗАНА быть tables-of-players. Это hard rule, не «постарайся»:
- comparativeTables[0] = tables-of-players (компании × HQ/основание/продукт/...)
- comparativeTables[1..N] = tech-comparison / cost factors / regional matrix — следующими

Если по теме игроков «нет» (например, обзор фундаментальной физики) — НЕ делай tech-comparison первой; вместо этого выведи tables-of-players с заголовком «Ключевые исследовательские группы» и колонками = ведущими университетами/лабораториями.

ОБЯЗАТЕЛЬНО включи ОДНУ ТАБЛИЦУ tables-of-players — сравнение конкретных компаний/предприятий/поставщиков с количественными данными. Это критическая ось для коммерческого использования отчёта. Колонки = названия компаний (Параметр × CATL × BYD × Gotion × EVE Energy), строки:
- HQ / страна
- год основания / выход на рынок
- основной продукт / технология
- объём производства / capacity (тонн/год, ГВт·ч/год, units/year — что применимо)
- доля рынка / выручка (если есть в источниках)
- ключевые клиенты / партнёрства
- статус / IPO / ownership

КРИТИЧНО — выбор companies для players table:
- Если в context указан SEED_COMPANIES (см. ниже) — используй ИХ как primary columns (4-6 штук). Это canonical leaders в области, известны экспертам отрасли.
- Если SEED_COMPANIES пуст — извлекай companies из SOURCES, но СТРОГО фильтруй: company должна иметь PRIMARY business = topic technology. Например, для H2-electrolyzers НЕ Longi (solar primary), НЕ Газпром (gas primary). Для LFP — НЕ Tesla (battery user, не производитель LFP cells).
- ❌ ЗАПРЕЩЕНО включать adjacent / downstream / spinoff компании только потому что они упоминают topic как побочную деятельность.

Если в SOURCES нет количественных данных по компании — поставь "—" в ячейке (НЕ выдумывай числа). Цель: 4-6 компаний в колонках, 4-7 строк характеристик.

ЖЁСТКО ЗАПРЕЩЕНО в cells:
- ❌ Generic statements: «производит батареи», «major player», «выпускает разнообразные продукты», «один из ведущих», «various solutions», «ключевой игрок». Любое такое содержание → cell = "—".
- ❌ Перефразирование без конкретики: если в source нет числа/имени/года — cell = "—".
- ❌ Утверждения без source: каждая заполненная cell ОБЯЗАНА иметь хотя бы один валидный sourceRef из SOURCES.
- ✅ Принцип: лучше «—» чем generic prose. Пустую ячейку pipeline дозаполнит из Wikipedia / корп.сайта / SEC после твоей синтез-стадии — твоя задача НЕ замусорить её фразой-наполнителем.

Дополнительные оси (выбирай в зависимости от topic'а):
- методы / технологии / процессы → колонки = МЕТОДЫ (Параметр × Пирометаллургия × Гидрометаллургия × Электролиз)
- материалы / продукты → колонки = МАТЕРИАЛЫ
- регионы / рынки / страны → колонки = РЕГИОНЫ (Параметр × Китай × ЕС × США × РФ)
- стандарты / регуляторика → колонки = ЮРИСДИКЦИИ

Целься в 3-5 таблиц: ОБЯЗАТЕЛЬНО одна tables-of-players + 2-4 на дополнительных осях (3-7 строк в каждой). Подбирай ось сравнения и набор разрезов под конкретный topic — НЕ привязывайся к одному шаблону.

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
  sources: SynthSourceInput[],
  seedCompanies: string[] = []
): string {
  return [
    `ТЕМА: ${params.topic}`,
    `ОТРАСЛЬ: ${params.industry}`,
    `РЕГИОНЫ: ${params.regions.join(", ")}`,
    `ПЕРИОД: ${params.periodFrom}-${params.periodTo}`,
    params.hypotheses ? `ГИПОТЕЗЫ ПОЛЬЗОВАТЕЛЯ: ${params.hypotheses}` : "",
    seedCompanies.length > 0
      ? `SEED_COMPANIES (canonical leaders для players table — ИСПОЛЬЗУЙ ИХ как primary columns):\n${seedCompanies.map((c) => `- ${c}`).join("\n")}`
      : "",
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
  enrichmentSnippets: Map<string, string>,
  tavilyKey: string = process.env.TAVILY_API_KEY ?? "",
  seedCompanies: string[] = [],
  /** PR-3.6.1.2: Stage-1 queries (Ru + En) fed into topic-keyword derivation;
   *  augmenter skips news/SEC pages that don't mention the topic at all
   *  (closes Siemens-Mobile / BYD-chip / Gotion-sodium mis-attribution). */
  extraQueries: string[] = []
): Promise<LitReviewReport> {
  const synthSources: SynthSourceInput[] = sources.slice(0, SYNTH_MAX_SOURCES).map((s) => ({
    ref: s.ref,
    title: s.title.slice(0, 300),
    url: s.url,
    snippet: enrichmentSnippets.get(s.url)?.slice(0, SYNTH_SNIPPET_CHARS),
  }));
  const userText = buildSynthUserText(params, synthSources, seedCompanies);

  // Two parallel Gemini Flash 2.5 calls (via the Timeweb gateway). History:
  // Sonnet was the natural choice — premium model, structured output. POC #7
  // verified 7/7 gates pass under Sonnet at ~₽38 / report. But Timeweb's
  // gateway capped Sonnet think-time at ~180s the next day (verified probe:
  // 20k-input/8k-output JSON request → 408 in 182s). Gemini 2.5 Flash reasons
  // an order of magnitude faster and is ~40× cheaper per token, with no
  // observed regression on structured output (the same JSON-shape validator
  // downstream catches any drift). If quality drops we revisit Sonnet via
  // aitunnel (alternate gateway) — call sites stay the same.
  const [restResult, tablesResult] = await Promise.all([
    callGeminiJson<RestPayload>({
      apiKey,
      label: "litreview/synth-rest",
      systemPrompt: SYNTH_REST_PROMPT,
      userText,
      timeoutMs: 180_000,
    }),
    callGeminiJson<TablesPayload>({
      apiKey,
      label: "litreview/synth-tables",
      systemPrompt: SYNTH_TABLES_PROMPT,
      userText,
      timeoutMs: 180_000,
    }),
  ]);
  const rest = restResult.data;
  const tables = tablesResult.data;

  // Validate sourceRefs against the actual source list to drop any fabricated
  // numbers (defensive — the prompt forbids this, but a model may slip).
  const knownRefs = new Set(sources.map((s) => s.ref));
  const filterRefs = (refs: number[] | undefined) =>
    Array.isArray(refs) ? refs.filter((r) => knownRefs.has(r)) : [];

  const report: LitReviewReport = {
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

  // PR-3.6.3 (ap-ba v2 review issue #3): collapse rows where the LLM emitted
  // more cells than columns (e.g. 6 cells for 5 company columns shifts data
  // alignment). Or pad short rows so the renderer's pipe alignment holds.
  const cellCountFix = normalizeTableCellCounts(report);
  if (cellCountFix.fixedRows > 0) {
    console.info("[litreview/stage3to8] normalised cell counts", cellCountFix);
  }

  // PR-3.6.1 (ap-ba v2 review issue #2c): validate LLM-filled cells in the
  // players table against (a) substring-match in cited snippets and (b) the
  // field-format regex. v2 spot-check found 40% hallucination rate on LLM
  // cells (Plug Power HQ = "Китай (Сиань)" mis-attributed; LFP "Российские
  // проекты" share = "14% Q2 2025" actually citing LNG export news).
  // Failing cells reset to "—" so the augmenter below gets a second shot.
  const llmValidation = validateLLMCells({ report, enrichmentSnippets });
  if (llmValidation.resetCount > 0) {
    console.info("[litreview/stage3to8] LLM cell validation reset", llmValidation);
  }

  // PR-3.6 source-augmentation: fill empty cells in the «tables-of-players»
  // table using deterministic Wiki infobox + corp /about + industry news +
  // SEC/HKEX filings. Mutates report.comparativeTables[N].rows[*].cells and
  // appends new entries to report.sources (which Stage 7 will then verify).
  //
  // Best-effort: if the augmenter fails, the report still ships with whatever
  // the LLM filled (mostly "—"). We don't fail the whole pipeline over it —
  // the user got their report; v2 quality is a soft target.
  try {
    const topicKeywords = deriveTopicKeywords({
      topic: params.topic,
      hypotheses: params.hypotheses,
      extraQueries,
    });
    await augmentReportTables({ apiKey, tavilyKey, report, topicKeywords });
  } catch (e) {
    console.error("[litreview/stage3to8] augmentation failed (non-fatal)", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return report;
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
// Domain blacklist is applied here (pre-numbering) so we don't waste ref
// numbers on URLs that won't survive. LLM relevance filter runs separately
// via `applyRelevanceFilter` against the numbered list.
export function harvestToSources(harvest: LitReviewHarvest): {
  sources: LitReviewSource[];
  snippets: Map<string, string>;
  blacklistedCount: number;
} {
  const sources: LitReviewSource[] = [];
  const snippets = new Map<string, string>();
  const seenUrl = new Set<string>();
  let blacklistedCount = 0;

  const push = (
    title: string,
    url: string,
    provenance: LitReviewSource["provenance"],
    snippet?: string
  ) => {
    if (!url || seenUrl.has(url)) return;
    if (isBlacklistedUrl(url)) {
      blacklistedCount++;
      return;
    }
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

  return { sources, snippets, blacklistedCount };
}

// LLM-based relevance pass over the numbered source list. Drops sources that
// the model judges as «явно не в тему». Renumbers the survivors to keep refs
// contiguous (downstream synth cites by ref index — gaps would confuse it).
//
// Returns the trimmed source list, an updated snippet map, and the dropped
// (ref, reason) pairs for logging / debugging.
export async function applyRelevanceFilter(opts: {
  apiKey: string;
  topic: string;
  sources: LitReviewSource[];
  snippets: Map<string, string>;
}): Promise<{
  sources: LitReviewSource[];
  snippets: Map<string, string>;
  droppedCount: number;
  droppedRefs: Map<number, string>;
}> {
  const items = opts.sources.map((s) => ({
    ref: s.ref,
    title: s.title,
    snippet: opts.snippets.get(s.url),
  }));
  const { keptRefs, droppedRefs } = await filterByRelevance({
    apiKey: opts.apiKey,
    topic: opts.topic,
    items,
  });
  const kept = opts.sources.filter((s) => keptRefs.has(s.ref));
  // Renumber contiguously starting from 1. Build a new snippet map keyed by
  // URL (URL is stable across renumbering).
  const renumbered: LitReviewSource[] = kept.map((s, i) => ({ ...s, ref: i + 1 }));
  const newSnippets = new Map<string, string>();
  for (const s of renumbered) {
    const snip = opts.snippets.get(s.url);
    if (snip) newSnippets.set(s.url, snip);
  }
  return {
    sources: renumbered,
    snippets: newSnippets,
    droppedCount: droppedRefs.size,
    droppedRefs,
  };
}
