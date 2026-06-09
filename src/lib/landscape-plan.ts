import { GEMINI_TIMEOUT_MS } from "./config";
import { callGeminiJson } from "./gemini";
import { cacheKey, memo } from "./llm-cache";

const SYSTEM_PROMPT = `Ты — аналитик патентных ландшафтов. На вход: свободное описание технологической темы (на любом языке).

Задача: сформулировать план поиска для построения патентного ландшафта в базе PatSearch (Роспатент, 150 млн патентов, семантический поиск по полю qn). База содержит патенты RU, CIS, US, EP, JP, CN — русские патенты индексированы на русском, остальные на английском. Нужно 3–5 РАЗНЫХ поисковых фраз на РУССКОМ + их переводы на АНГЛИЙСКИЙ, плюс общие IPC-subclass.

Верни СТРОГО валидный JSON:
{
  "queries": [
    "короткая фраза 5–15 слов на русском — аспект 1",
    "короткая фраза 5–15 слов на русском — аспект 2",
    "короткая фраза 5–15 слов на русском — аспект 3"
  ],
  "queriesEn": [
    "short phrase 5–15 words in English — same aspect 1",
    "short phrase 5–15 words in English — same aspect 2",
    "short phrase 5–15 words in English — same aspect 3"
  ],
  "ipcSubclasses": ["C22B", "C01G"],
  "ipcGroups": ["C22B25/00", "C22B7/00"],
  "functionQuery": "ОДНА фраза 6–12 слов на РУССКОМ — чистая ФУНКЦИЯ изобретения без главного «фирменного» существительного",
  "functionQueryEn": "перевод functionQuery на АНГЛИЙСКИЙ",
  "functionQuery2": "ВТОРАЯ фраза той же функции, ИНАЧЕ сформулированная (синонимы действия/объекта)",
  "functionQuery2En": "перевод functionQuery2 на АНГЛИЙСКИЙ",
  "structureQuery": "ОДНА фраза 6–12 слов на РУССКОМ — главный рабочий ЭЛЕМЕНТ/устройство родовыми терминами + его действие, без «фирменного» существительного",
  "structureQueryEn": "перевод structureQuery на АНГЛИЙСКИЙ",
  "overviewSeed": "1–2 предложения: суть темы и её технологический контекст (для затравки итогового обзора)"
}

Правила queries и queriesEn:
- queries — на РУССКОМ (для поиска RU/CIS патентов)
- queriesEn — точный перевод каждого queries на АНГЛИЙСКИЙ (для поиска US/EP/CN/JP патентов)
- queries и queriesEn должны быть одинаковой длины и соответствовать по индексу
- 4–5 запросов. КРИТИЧНО для полноты поиска: разложи тему на ОТДЕЛЬНЫЕ технические признаки и сделай запрос на КАЖДЫЙ. Семантический поиск находит аналог, только если запрос пересказывает его суть, поэтому покрой РАЗНЫЕ грани:
  - конструкция/устройство (например, охлаждаемый элемент, фурма, сопло)
  - функция/действие (например, вдувание/подача газа и порошкового материала в расплав)
  - объект воздействия (например, ванна расплавленного металла)
  - применяемый процесс/среда (например, продувка, барботаж, плавка)
- Каждый запрос — ПЛОТНАЯ техническая фраза в духе патентной формулы: {устройство/способ} + {действие} + {объект} + {отличительный признак}. Называй конкретные технические существительные (кислород, порошковый материал, расплав металла, фурма, охлаждение), а не общие слова.
- ВАЖНО (де-якорение): минимум 2 запроса опиши ТОЛЬКО через функцию/действие, НЕ повторяя главное «фирменное» существительное темы (например, если тема про «кессон» — в этих запросах слова «кессон» быть НЕ должно). Семантический поиск цепляется за самое яркое слово и прячет функционально-эквивалентные аналоги, названные иначе. Пример: вместо «водоохлаждаемый кессон для вдувания порошка» дай «вдувание кислорода и порошкового материала в ванну расплавленного металла».
- 6–12 значимых слов в каждом запросе. Не сокращай до 3–4 слов — слишком короткий запрос даёт размытую выдачу и пропускает релевантные аналоги.
- Без вводных слов, без воды, без брендов
- Если тема узкая, но многопризнаковая — всё равно 4–5 запросов, по запросу на признак.

Правила ipcSubclasses:
- 2–5 самых релевантных IPC-subclass (формат: 4 символа, например "C22B", "G01R", "H02H")
- Только subclass (4 символа), НЕ group (как "C22B 25/00")
- Если тема пересекает несколько областей — покрыть основные

Правила ipcGroups:
- 3–8 самых релевантных ПОЛНЫХ IPC-групп уровня подгруппы (формат: БЕЗ пробела, например "C22B25/00", "G01R31/34", "H02H7/09")
- Это КОНКРЕТНЫЕ классы, где живут ближайшие аналоги изобретения — выбирай точные подгруппы, а не общие. Они напрямую используются для точного поиска по классу (classification.ipc), который достаёт релевантные аналоги, не зависящие от формулировки запроса
- Указывай ТОЛЬКО реально существующие коды МПК, в которых с высокой вероятностью классифицирован объект и его аналоги. Если не уверен в подгруппе — дай группу основного уровня (например "G01R31/00"). НЕ выдумывай несуществующие коды
- Покрой РАЗНЫЕ грани: класс самого устройства, класс способа/функции, класс смежных измерений/защиты
- ОБЯЗАТЕЛЬНО включи класс ОСНОВНОЙ ИЗМЕРЯЕМОЙ ФИЗИЧЕСКОЙ ВЕЛИЧИНЫ, на которой строится работа устройства, даже если главная функция в другом классе. Аналоги-измерители этой величины — частый «ближайший по архитектуре» прототип. Например: диагностика по ТОКУ → измерение электрического тока (G01R19); по ВИБРАЦИИ → G01H; по ТЕМПЕРАТУРЕ → G01K; по ДАВЛЕНИЮ → G01L

Правила functionQuery / functionQueryEn:
- ОДНА короткая фраза, описывающая ТОЛЬКО суть-функцию изобретения (что оно делает с чем), БЕЗ главного «фирменного» существительного темы (например, без «кессон», если тема про кессон)
- Это «зонд» для поиска функционально-эквивалентных аналогов, названных совсем иначе — поэтому максимально нейтральные родовые термины действия и объекта
- КАНОНИЧНОСТЬ: используй самые ОБЩИЕ, частотные глаголы действия (вдувание, подача, инжекция, продувка / injection, feeding, blowing) и РОДОВОЙ объект (расплав металла, ванна расплава / molten metal, molten bath). Избегай редких/узких формулировок — зонд должен матчить как можно больше аналогов
- functionQuery2 / functionQuery2En — ВТОРАЯ формулировка ТОЙ ЖЕ функции другими словами (синонимы глагола и объекта), чтобы поймать аналоги, которые первая формулировка пропускает. Не копия functionQuery, а парафраз
- Пример (тема про водоохлаждаемый кессон с подачей газа/порошка): functionQuery = "вдувание кислорода и порошкового материала в ванну расплавленного металла", functionQueryEn = "injection of oxygen and powdered material into molten metal bath"; functionQuery2 = "продувка расплава металла газом и подача твёрдых реагентов", functionQuery2En = "blowing gas and solid reagents into liquid metal melt"

Правила structureQuery / structureQueryEn:
- ОДНА короткая фраза про главный рабочий ЭЛЕМЕНТ/узел изобретения (ЧЕМ оно является конструктивно) + его действие, родовыми терминами, БЕЗ «фирменного» существительного темы
- Это второй «зонд» — для аналогов, у которых совпадает КОНСТРУКЦИЯ, а не функция (их находит другая формулировка, чем functionQuery). Называй родовой класс элемента (фурма, сопло, копьё, охлаждаемый наконечник, водоохлаждаемая панель и т.п.), а не «фирменное» слово темы
- КАНОНИЧНОСТЬ: родовой элемент + общий глагол (фурма/сопло + продувка/вдувание/охлаждение; tuyere/lance/nozzle + blowing/injection/cooling). Бери самое частотное название элемента, не редкое
- Пример (тема про водоохлаждаемый кессон с фурмами): structureQuery = "водоохлаждаемая фурма для продувки и вдувания в металлургическую печь", structureQueryEn = "water-cooled tuyere for blowing into metallurgical furnace"

Правила overviewSeed:
- 1–2 предложения на русском
- Описывает техническую суть области, без оценок и выводов — только факт

Пример:
Вход: "Технологии переработки бедных оловянных концентратов: пирометаллургия, гидрометаллургия, обогащение касситерита"
→ {
  "queries": [
    "восстановительная плавка бедных оловянных концентратов касситерита в печи",
    "флотационное обогащение тонких фракций касситерита из оловянных руд",
    "гидрометаллургическое выщелачивание олова из металлургических шлаков",
    "извлечение олова из хвостов обогащения и вторичного оловосодержащего сырья",
    "вакуумное рафинирование чернового олова от мышьяка свинца висмута"
  ],
  "queriesEn": [
    "reduction smelting of low-grade tin cassiterite concentrates in furnace",
    "flotation beneficiation of fine cassiterite fractions from tin ores",
    "hydrometallurgical leaching of tin from metallurgical slags",
    "recovery of tin from beneficiation tailings and secondary tin-bearing feedstock",
    "vacuum refining of crude tin removing arsenic lead bismuth impurities"
  ],
  "ipcSubclasses": ["C22B", "B03D", "B03B"],
  "ipcGroups": ["C22B25/00", "C22B7/00", "B03D1/02", "B03B7/00"],
  "functionQuery": "извлечение олова из низкосортного сырья и металлургических отходов",
  "functionQueryEn": "recovery of tin from low-grade feedstock and metallurgical waste",
  "functionQuery2": "выделение олова из шлаков хвостов и вторичного сырья",
  "functionQuery2En": "extraction of tin from slags tailings and secondary raw materials",
  "structureQuery": "печь и аппарат для восстановительной плавки металлсодержащих концентратов",
  "structureQueryEn": "furnace and apparatus for reduction smelting of metal-bearing concentrates",
  "overviewSeed": "Переработка бедных оловянных концентратов — задача металлургии цветных металлов, совмещающая обогащение, пиро- и гидрометаллургию для извлечения Sn из сырья с низким содержанием металла и сложным составом примесей."
}`;

export type LandscapePlan = {
  queries: string[];
  queriesEn: string[];
  ipcSubclasses: string[];
  ipcGroups: string[];
  functionQuery: string;
  functionQueryEn: string;
  functionQuery2: string;
  functionQuery2En: string;
  structureQuery: string;
  structureQueryEn: string;
  overviewSeed: string;
};

export async function planLandscape(
  topic: string,
  apiKey: string,
  timeoutMs: number = GEMINI_TIMEOUT_MS.plan
): Promise<LandscapePlan> {
  // Memoise by topic — the gateway is not bit-deterministic at temp 0, so the
  // same search must map to one plan (see llm-cache.ts). Version tag "plan-v1"
  // invalidates if the prompt changes.
  return memo(cacheKey("plan-v1", topic), () => planLandscapeUncached(topic, apiKey, timeoutMs));
}

async function planLandscapeUncached(
  topic: string,
  apiKey: string,
  timeoutMs: number
): Promise<LandscapePlan> {
  const { data } = await callGeminiJson<{
    queries?: unknown;
    queriesEn?: unknown;
    ipcSubclasses?: unknown;
    ipcGroups?: unknown;
    functionQuery?: unknown;
    functionQueryEn?: unknown;
    functionQuery2?: unknown;
    functionQuery2En?: unknown;
    structureQuery?: unknown;
    structureQueryEn?: unknown;
    overviewSeed?: unknown;
  }>({
    apiKey,
    label: "landscape-plan",
    systemPrompt: SYSTEM_PROMPT,
    userText: topic,
    // ZERO temperature (greedy): the de-anchored probes must be REPRODUCIBLE
    // run-to-run. Even temp 0.1 drifts probe wording between runs, and since each
    // probe is the qn of an IPC-class sweep, that drift swings a target analog's
    // raw rank within its own class by 10+ positions — which every downstream
    // top-K cutoff then turns into a run-to-run recall flip. Aspect diversity
    // comes from the prompt's explicit per-facet instructions, not from sampling.
    temperature: 0,
    timeoutMs,
  });

  const queries = Array.isArray(data.queries)
    ? data.queries
        .filter(
          (q): q is string => typeof q === "string" && q.trim().length >= 5
        )
        .map((q) => q.trim())
        .slice(0, 5)
    : [];

  const queriesEn = Array.isArray(data.queriesEn)
    ? data.queriesEn
        .filter(
          (q): q is string => typeof q === "string" && q.trim().length >= 5
        )
        .map((q) => q.trim())
        .slice(0, 5)
    : [];

  const ipcSubclasses = Array.isArray(data.ipcSubclasses)
    ? data.ipcSubclasses
        .filter(
          (c): c is string =>
            typeof c === "string" && /^[A-H]\d{2}[A-Z]$/.test(c.trim())
        )
        .map((c) => c.trim())
        .slice(0, 6)
    : [];

  // Full IPC groups (subgroup level, e.g. "G01R31/34") — normalize away spaces
  // ("G01R 31/34" → "G01R31/34") and keep only well-formed codes. These seed the
  // class-sweep directly (classification.ipc) so a plan-relevant class is swept
  // even when no probe hit happened to carry it (Samara 0/2 root cause).
  const ipcGroups = Array.isArray(data.ipcGroups)
    ? Array.from(
        new Set(
          data.ipcGroups
            .filter((g): g is string => typeof g === "string")
            .map((g) => g.replace(/\s+/g, ""))
            .filter((g) => /^[A-H]\d{2}[A-Z]\d{1,4}\/\d{1,6}$/.test(g))
        )
      ).slice(0, 8)
    : [];

  const functionQuery =
    typeof data.functionQuery === "string" ? data.functionQuery.trim() : "";
  const functionQueryEn =
    typeof data.functionQueryEn === "string" ? data.functionQueryEn.trim() : "";
  const functionQuery2 =
    typeof data.functionQuery2 === "string" ? data.functionQuery2.trim() : "";
  const functionQuery2En =
    typeof data.functionQuery2En === "string" ? data.functionQuery2En.trim() : "";
  const structureQuery =
    typeof data.structureQuery === "string" ? data.structureQuery.trim() : "";
  const structureQueryEn =
    typeof data.structureQueryEn === "string" ? data.structureQueryEn.trim() : "";

  const overviewSeed =
    typeof data.overviewSeed === "string" ? data.overviewSeed.trim() : "";

  if (queries.length < 2) {
    throw new Error("Gemini returned fewer than 2 queries");
  }

  return {
    queries,
    queriesEn,
    ipcSubclasses,
    ipcGroups,
    functionQuery,
    functionQueryEn,
    functionQuery2,
    functionQuery2En,
    structureQuery,
    structureQueryEn,
    overviewSeed,
  };
}
