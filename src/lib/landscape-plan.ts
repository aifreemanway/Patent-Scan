import { GEMINI_TIMEOUT_MS } from "./config";
import { callGeminiJson } from "./gemini";

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
  "functionQuery": "ОДНА фраза 6–12 слов на РУССКОМ — чистая ФУНКЦИЯ изобретения без главного «фирменного» существительного",
  "functionQueryEn": "перевод functionQuery на АНГЛИЙСКИЙ",
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

Правила functionQuery / functionQueryEn:
- ОДНА короткая фраза, описывающая ТОЛЬКО суть-функцию изобретения (что оно делает с чем), БЕЗ главного «фирменного» существительного темы (например, без «кессон», если тема про кессон)
- Это «зонд» для поиска функционально-эквивалентных аналогов, названных совсем иначе — поэтому максимально нейтральные родовые термины действия и объекта
- Пример (тема про водоохлаждаемый кессон с подачей газа/порошка): functionQuery = "вдувание кислорода и порошкового материала в ванну расплавленного металла", functionQueryEn = "injection of oxygen and powdered material into molten metal bath"

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
  "functionQuery": "извлечение олова из низкосортного сырья и металлургических отходов",
  "functionQueryEn": "recovery of tin from low-grade feedstock and metallurgical waste",
  "overviewSeed": "Переработка бедных оловянных концентратов — задача металлургии цветных металлов, совмещающая обогащение, пиро- и гидрометаллургию для извлечения Sn из сырья с низким содержанием металла и сложным составом примесей."
}`;

export type LandscapePlan = {
  queries: string[];
  queriesEn: string[];
  ipcSubclasses: string[];
  functionQuery: string;
  functionQueryEn: string;
  overviewSeed: string;
};

export async function planLandscape(
  topic: string,
  apiKey: string,
  timeoutMs: number = GEMINI_TIMEOUT_MS.plan
): Promise<LandscapePlan> {
  const { data } = await callGeminiJson<{
    queries?: unknown;
    queriesEn?: unknown;
    ipcSubclasses?: unknown;
    functionQuery?: unknown;
    functionQueryEn?: unknown;
    overviewSeed?: unknown;
  }>({
    apiKey,
    systemPrompt: SYSTEM_PROMPT,
    userText: topic,
    temperature: 0.3,
    thinkingBudget: 1024,
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

  const functionQuery =
    typeof data.functionQuery === "string" ? data.functionQuery.trim() : "";
  const functionQueryEn =
    typeof data.functionQueryEn === "string" ? data.functionQueryEn.trim() : "";

  const overviewSeed =
    typeof data.overviewSeed === "string" ? data.overviewSeed.trim() : "";

  if (queries.length < 2) {
    throw new Error("Gemini returned fewer than 2 queries");
  }

  return {
    queries,
    queriesEn,
    ipcSubclasses,
    functionQuery,
    functionQueryEn,
    overviewSeed,
  };
}
