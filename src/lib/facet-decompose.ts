// Facet decomposition — Stage 3.1 of the full-depth novelty retrieval (P2).
//
// WHY: a verbose invention blob ("Модуль EMM … MCSA … STM32 … RS-485 …") is
// semantically AVERAGED by the embedding search into one fuzzy vector — the
// distinct technical sub-problems wash out, so analogs that paraphrase only ONE
// facet (e.g. "обрыв стержней ротора") never surface. The recall beta-blocker
// (T1 union 1/32) traces to exactly this: the etalon patents each address a
// single facet of the invention, not the whole blob.
//
// FIX: an LLM stage splits the invention into 8–12 ATOMIC technical facets and
// emits one dense, patent-formula-style RU+EN query per facet. Each facet query
// is a separate semantic probe, so a per-facet analog floats up under its own
// query instead of being averaged away. This is the single biggest union mover
// in the P2 design (Antepatent/calibration-reference/recall-architecture-design-P2).
//
// Pure (apiKey in, facets out); the +1 Gemini call is the only paid cost and is
// negligible. Anti-fab N/A here — facets are search queries, not shown data.

import { GEMINI_TIMEOUT_MS } from "./config";
import { callGeminiJson } from "./gemini";

const SYSTEM_PROMPT = `Ты — патентный аналитик-поисковик. На вход: подробное описание одного изобретения (устройства или способа), часто многословное, с маркой, моделью контроллера, интерфейсами, перечнем функций.

Задача: РАЗЛОЖИТЬ изобретение на ОТДЕЛЬНЫЕ АТОМАРНЫЕ технические признаки (фасеты) и для КАЖДОГО дать одну поисковую фразу на РУССКОМ + её перевод на АНГЛИЙСКИЙ. Это нужно, потому что семантический патентный поиск находит аналог, только если запрос пересказывает СУТЬ этого аналога. Один общий запрос по всему описанию усредняется и теряет аналоги, которые относятся лишь к одной грани изобретения.

Верни СТРОГО валидный JSON:
{
  "facets": [
    { "ru": "плотная техническая фраза 6–14 слов на русском — один признак", "en": "точный перевод на английский" }
  ]
}

Правила:
- 8–12 фасетов. Покрой РАЗНЫЕ технические грани, каждая — отдельный фасет:
  - измеряемая физическая величина и метод её измерения (например, анализ сигнатуры тока, спектральный анализ вибрации)
  - КАЖДЫЙ обнаруживаемый дефект/режим/состояние ОТДЕЛЬНЫМ фасетом (например, обрыв стержней ротора; межвитковое замыкание статора; дефект подшипника — это ТРИ фасета, не один)
  - алгоритм/способ обработки сигнала (например, гармонический анализ спектра тока, пороговая классификация)
  - конструктивный узел / аппаратная архитектура (например, микроконтроллерный модуль сбора данных, аналого-цифровое преобразование сигнала)
  - функция управления/защиты (например, защитное отключение при дефекте)
  - КАНАЛ И СПОСОБ ПЕРЕДАЧИ/ОБМЕНА ДАННЫМИ ОТДЕЛЬНЫМ фасетом, если он есть в описании (например, передача данных по цифровому промышленному интерфейсу; телеметрия и удалённый мониторинг).
  - ЕСЛИ устройство И измеряет физическую величину, И передаёт её — обязательно выдели КОМПАУНД-фасет «измерение {величины} и беспроводная/дистанционная передача ИЗМЕРЕННЫХ ЗНАЧЕНИЙ» (например, «измеритель тока с беспроводной передачей измеренных значений тока», «измерение напряжения и радиопередача результатов измерений»). Описывай передачу САМИХ ИЗМЕРЕННЫХ ВЕЛИЧИН, а НЕ итогового статуса/диагноза — существуют аналоги-измерители с телеметрией без какой-либо диагностической обработки, и они находятся ТОЛЬКО этим компаунд-фасетом, теряясь и в фасете «измерение», и в фасете «передача статуса».
  - измерение и регистрация САМОЙ базовой физической величины отдельным фасетом (например, бесконтактное измерение тока трансформатором тока), не только её последующий спектральный/сигнатурный анализ — аналог может раскрывать лишь измерительный узел.
  - объект/среда применения (например, асинхронный электродвигатель, трёхфазная сеть 0,4 кВ)
- Каждая фраза — в духе патентной формулы: {объект/способ} + {действие} + {отличительный признак}. Конкретные технические существительные и глаголы, без воды, без вводных слов.
- НЕ якорись на марке/модели/бренде (EMM, STM32, MODBUS — это НЕ признаки изобретения, а реализация). Описывай родовую суть: «межвитковое замыкание обмотки статора», а не «модуль EMM для STM32».
- ru и en строго соответствуют по индексу и смыслу, одинаковое количество.
- Если описание узкое — всё равно выдели максимум различимых граней (минимум 8, дроби составные признаки).
- Только реально осмысленные технические фасеты. НЕ выдумывай признаки, которых в описании нет.

Пример.
Вход: "Водоохлаждаемый кессон для металлургической печи с фурмами для вдувания кислорода и порошкового углеродсодержащего материала в ванну расплава, с системой циркуляции охлаждающей воды и контролем температуры стенки."
→ {
  "facets": [
    { "ru": "вдувание кислорода в ванну расплавленного металла через фурму", "en": "injection of oxygen into molten metal bath through tuyere" },
    { "ru": "подача порошкового углеродсодержащего материала в металлический расплав", "en": "feeding powdered carbon-bearing material into metal melt" },
    { "ru": "водяное охлаждение стенки металлургической печи циркуляцией", "en": "water cooling of metallurgical furnace wall by circulation" },
    { "ru": "контроль температуры охлаждаемого элемента плавильного агрегата", "en": "temperature monitoring of cooled element of melting unit" },
    { "ru": "водоохлаждаемая фурма для продувки расплава газом", "en": "water-cooled tuyere for blowing melt with gas" },
    { "ru": "защита футеровки печи от прогара охлаждаемой панелью", "en": "protection of furnace lining from burn-through by cooled panel" },
    { "ru": "регулирование расхода дутья в плавильной печи", "en": "control of blast flow rate in melting furnace" },
    { "ru": "барботаж и перемешивание ванны расплава газовой струёй", "en": "bubbling and stirring of melt bath by gas jet" }
  ]
}`;

export type Facet = { ru: string; en: string };

export async function decomposeFacets(
  invention: string,
  apiKey: string,
  timeoutMs: number = GEMINI_TIMEOUT_MS.facet
): Promise<Facet[]> {
  const { data } = await callGeminiJson<{ facets?: unknown }>({
    apiKey,
    label: "facet-decompose",
    systemPrompt: SYSTEM_PROMPT,
    userText: invention,
    // ZERO temperature (greedy): facet phrasings must be REPRODUCIBLE run-to-run
    // (the recall fix has to be deterministic). Each facet phrase becomes a sweep
    // qn, so any drift swings a target's raw rank in its IPC class and flips
    // recall through downstream cutoffs. Diversity comes from the prompt's
    // explicit per-grain instructions, not sampling randomness.
    temperature: 0,
    timeoutMs,
  });

  if (!Array.isArray(data.facets)) return [];
  const facets: Facet[] = [];
  const seen = new Set<string>();
  for (const f of data.facets) {
    if (typeof f !== "object" || f === null) continue;
    const ru = typeof (f as Facet).ru === "string" ? (f as Facet).ru.trim() : "";
    const en = typeof (f as Facet).en === "string" ? (f as Facet).en.trim() : "";
    // A facet must have at least the RU phrase (the EN is a translation we can
    // skip if missing). Keep only sufficiently dense queries (>= 3 words-ish).
    if (ru.length < 8) continue;
    const key = ru.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    facets.push({ ru, en: en.length >= 5 ? en : "" });
    if (facets.length >= 12) break;
  }
  return facets;
}
