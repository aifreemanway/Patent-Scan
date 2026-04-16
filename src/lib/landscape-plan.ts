const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_PROMPT = `Ты — аналитик патентных ландшафтов. На вход: свободное описание технологической темы (на любом языке).

Задача: сформулировать план поиска для построения патентного ландшафта в базе PatSearch (Роспатент, работает семантически по полю qn на русском). Нужно 3–5 РАЗНЫХ поисковых фраз, покрывающих тему с разных сторон, плюс общие IPC-subclass.

Верни СТРОГО валидный JSON:
{
  "queries": [
    "короткая фраза 5–15 слов на русском — аспект 1",
    "короткая фраза 5–15 слов на русском — аспект 2",
    "короткая фраза 5–15 слов на русском — аспект 3"
  ],
  "ipcSubclasses": ["C22B", "C01G"],
  "overviewSeed": "1–2 предложения: суть темы и её технологический контекст (для затравки итогового обзора)"
}

Правила queries:
- ТОЛЬКО русский язык (PatSearch лучше работает с русским семантическим поиском)
- 3–5 запросов, каждый покрывает РАЗНЫЙ аспект темы: метод / объект / применение / альтернативная технология / вторичное использование
- 5–15 значимых слов в каждом запросе (существительные + ключевые прилагательные)
- Без вводных слов, без воды, без брендов
- Если тема широкая (например «переработка оловянных концентратов») — 5 запросов. Если узкая — 3.

Правила ipcSubclasses:
- 2–5 самых релевантных IPC-subclass (формат: 4 символа, например "C22B", "G01R", "H02H")
- Только subclass (4 символа), НЕ group (как "C22B 25/00")
- Если тема пересекает несколько областей — покрыть основные

Правила overviewSeed:
- 1–2 предложения на русском
- Описывает техническую суть области, без оценок и выводов — только факт

Пример:
Вход: "Технологии переработки бедных оловянных концентратов: пирометаллургия, гидрометаллургия, обогащение касситерита"
→ {
  "queries": [
    "плавка оловянных концентратов восстановление касситерита",
    "флотационное обогащение касситерита тонкие фракции",
    "гидрометаллургическое выщелачивание олова из шлаков",
    "извлечение олова из хвостов обогащения и вторичного сырья",
    "вакуумное рафинирование олова от мышьяка и свинца"
  ],
  "ipcSubclasses": ["C22B", "B03D", "B03B"],
  "overviewSeed": "Переработка бедных оловянных концентратов — задача металлургии цветных металлов, совмещающая обогащение, пиро- и гидрометаллургию для извлечения Sn из сырья с низким содержанием металла и сложным составом примесей."
}`;

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

export type LandscapePlan = {
  queries: string[];
  ipcSubclasses: string[];
  overviewSeed: string;
};

export async function planLandscape(
  topic: string,
  apiKey: string,
  timeoutMs = 30_000
): Promise<LandscapePlan> {
  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: topic }] }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 1024 },
    },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`Gemini plan failed: ${resp.status}`);
  }

  const raw = (await resp.json()) as GeminiResponse;
  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

  const parsed = JSON.parse(cleaned) as {
    queries?: unknown;
    ipcSubclasses?: unknown;
    overviewSeed?: unknown;
  };

  const queries = Array.isArray(parsed.queries)
    ? parsed.queries
        .filter(
          (q): q is string => typeof q === "string" && q.trim().length >= 5
        )
        .map((q) => q.trim())
        .slice(0, 5)
    : [];

  const ipcSubclasses = Array.isArray(parsed.ipcSubclasses)
    ? parsed.ipcSubclasses
        .filter(
          (c): c is string =>
            typeof c === "string" && /^[A-H]\d{2}[A-Z]$/.test(c.trim())
        )
        .map((c) => c.trim())
        .slice(0, 6)
    : [];

  const overviewSeed =
    typeof parsed.overviewSeed === "string" ? parsed.overviewSeed.trim() : "";

  if (queries.length < 2) {
    throw new Error("Gemini returned fewer than 2 queries");
  }

  return { queries, ipcSubclasses, overviewSeed };
}
