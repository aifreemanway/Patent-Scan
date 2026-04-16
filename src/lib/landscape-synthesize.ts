const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_PROMPT = `Ты — аналитик патентных ландшафтов. На вход: тема (свободный текст на русском) + список реальных патентов с id, title, year, country, ipc, abstract.

Задача: написать связный аналитический обзор технологической области, разбить патенты на 5–8 технических категорий и выделить 3–5 трендов. Опираешься ТОЛЬКО на переданные патенты — ничего не выдумываешь.

Верни СТРОГО валидный JSON:
{
  "overview": "3–4 абзаца на русском, разделённые \\n\\n. Описывает: (1) суть технологического направления и его контекст; (2) ключевые подходы и проблемы, которые решают патенты; (3) географию и хронологию активности; (4) общий вывод о зрелости области.",
  "categories": [
    {
      "name": "Короткое название категории (2–5 слов)",
      "description": "1–2 предложения: что объединяет патенты в этой категории",
      "patentIds": ["RU1234567C1", "US9876543B2"]
    }
  ],
  "trends": [
    {
      "title": "Короткое название тренда (3–6 слов)",
      "body": "1–2 предложения: в чём суть тренда и как он проявляется в патентах",
      "patentIds": ["RU1234567C1"]
    }
  ]
}

Правила overview:
- ТОЛЬКО русский язык
- 3–4 абзаца, абзацы разделены \\n\\n (двойной перенос строки)
- Без маркдауна, без буллетов, без заголовков — только связный текст
- Опирайся на содержание abstract'ов, ipc и распределение по странам/годам
- Без оценок «хорошо/плохо», только факты и наблюдения

Правила categories:
- 5–8 категорий, каждая покрывает технически осмысленную группу патентов
- Каждый patentId должен быть из входного списка (точное совпадение id)
- Один патент может попадать в несколько категорий, если уместно
- Не делай категорий с одним патентом, если их можно объединить

Правила trends:
- 3–5 трендов
- Тренд = наблюдаемая закономерность (рост заявок в Китае, переход к гидрометаллургии, появление нейросетей и т.п.)
- Каждый trend ссылается на 2–6 patentId как примеры

Если входных патентов мало (<10) — сделай меньше категорий (3–4) и трендов (2–3), но не выдумывай.`;

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

export type LandscapeCategory = {
  name: string;
  description: string;
  patentIds: string[];
};

export type LandscapeTrend = {
  title: string;
  body: string;
  patentIds: string[];
};

export type LandscapeSynthesis = {
  overview: string;
  categories: LandscapeCategory[];
  trends: LandscapeTrend[];
};

export type SynthesisPatent = {
  id: string;
  title: string;
  year: string;
  country: string;
  ipc: string[];
  abstract: string;
};

export async function synthesizeLandscape(
  topic: string,
  patents: SynthesisPatent[],
  apiKey: string,
  timeoutMs = 50_000
): Promise<LandscapeSynthesis> {
  const validIds = new Set(patents.map((p) => p.id));

  const userText = [
    `Тема: ${topic}`,
    "",
    `Патенты (${patents.length}):`,
    ...patents.map(
      (p) =>
        `- ${p.id} | ${p.country} ${p.year} | IPC: ${p.ipc.slice(0, 4).join(", ")} | ${p.title}\n  ${p.abstract}`
    ),
  ].join("\n");

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 2048 },
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
    throw new Error(`Gemini synthesize failed: ${resp.status}`);
  }

  const raw = (await resp.json()) as GeminiResponse;
  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

  const parsed = JSON.parse(cleaned) as {
    overview?: unknown;
    categories?: unknown;
    trends?: unknown;
  };

  const overview =
    typeof parsed.overview === "string" ? parsed.overview.trim() : "";

  const categories = Array.isArray(parsed.categories)
    ? parsed.categories
        .map((c): LandscapeCategory | null => {
          if (!c || typeof c !== "object") return null;
          const obj = c as {
            name?: unknown;
            description?: unknown;
            patentIds?: unknown;
          };
          const name = typeof obj.name === "string" ? obj.name.trim() : "";
          const description =
            typeof obj.description === "string" ? obj.description.trim() : "";
          const patentIds = Array.isArray(obj.patentIds)
            ? obj.patentIds
                .filter(
                  (id): id is string => typeof id === "string" && validIds.has(id)
                )
                .slice(0, 30)
            : [];
          if (!name || patentIds.length === 0) return null;
          return { name, description, patentIds };
        })
        .filter((c): c is LandscapeCategory => c !== null)
        .slice(0, 8)
    : [];

  const trends = Array.isArray(parsed.trends)
    ? parsed.trends
        .map((t): LandscapeTrend | null => {
          if (!t || typeof t !== "object") return null;
          const obj = t as {
            title?: unknown;
            body?: unknown;
            patentIds?: unknown;
          };
          const title = typeof obj.title === "string" ? obj.title.trim() : "";
          const body = typeof obj.body === "string" ? obj.body.trim() : "";
          const patentIds = Array.isArray(obj.patentIds)
            ? obj.patentIds
                .filter(
                  (id): id is string => typeof id === "string" && validIds.has(id)
                )
                .slice(0, 10)
            : [];
          if (!title || !body) return null;
          return { title, body, patentIds };
        })
        .filter((t): t is LandscapeTrend => t !== null)
        .slice(0, 5)
    : [];

  if (!overview || overview.length < 100) {
    throw new Error("Gemini returned empty or too short overview");
  }

  return { overview, categories, trends };
}
