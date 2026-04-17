const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_PROMPT = `Ты — патентный поисковик. На вход: описание изобретения (может быть длинным, на любом языке).

Задача: извлечь компактный поисковый запрос для патентной базы PatSearch (Роспатент, 150 млн патентов). База содержит патенты RU, CIS (на русском) и US, EP, JP, CN (на английском). Нужны ДВА параллельных запроса — русский для русскоязычных датасетов и английский для англоязычных. PatSearch использует семантический neural-search по полю qn; длинные зашумлённые тексты обрабатывает плохо — нужен короткий плотный запрос из ключевых технических терминов.

Верни СТРОГО валидный JSON:
{
  "qn": "короткая фраза 5–15 слов на РУССКОМ, концентрирующая суть изобретения — устройство/метод + ключевые технические признаки",
  "qnEn": "точный перевод qn на АНГЛИЙСКИЙ той же длины и смысла",
  "ipcCodes": ["G01R 31/34", "H02H 7/09"]
}

Правила qn и qnEn:
- qn — на РУССКОМ (для датасетов ru_since_1994, ru_till_1994, cis)
- qnEn — точный перевод qn на АНГЛИЙСКИЙ (для датасетов us, ep, jp, cn)
- Оба поля покрывают один и тот же смысл, одну и ту же суть — просто разные языки
- Только существительные и ключевые прилагательные, через пробел или запятую
- Не включай конкретные модели чипов (STM32F407), номера стандартов (RS-485), бренды
- Включи: тип устройства, метод, объект измерения, ключевые отличительные признаки

Правила ipcCodes:
- Извлечь ВСЕ явно упомянутые в тексте коды МПК в формате "A01B 1/00" (буква-2цифры-буква пробел цифры/цифры)
- Если автор не указал коды — вернуть пустой массив, не придумывать
- Формат строго "G01R 31/34", НЕ "G01R31/34"

Примеры:
Вход: "устройство для диагностики асинхронных двигателей методом MCSA на базе STM32F407 с RS-485... МПК G01R 31/34, H02H 7/09"
→ {
  "qn": "диагностика асинхронного электродвигателя сигнатурный анализ тока MCSA",
  "qnEn": "asynchronous motor diagnostics current signature analysis MCSA",
  "ipcCodes": ["G01R 31/34", "H02H 7/09"]
}`;

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

export type SearchTerms = {
  qn: string;
  qnEn: string;
  ipcCodes: string[];
};

export async function extractSearchTerms(
  description: string,
  apiKey: string,
  timeoutMs = 20_000
): Promise<SearchTerms> {
  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: description }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 512 },
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
    throw new Error(`Gemini extract failed: ${resp.status}`);
  }

  const raw = (await resp.json()) as GeminiResponse;
  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

  const parsed = JSON.parse(cleaned) as {
    qn?: unknown;
    qnEn?: unknown;
    ipcCodes?: unknown;
  };

  const qn = typeof parsed.qn === "string" ? parsed.qn.trim() : "";
  const qnEn = typeof parsed.qnEn === "string" ? parsed.qnEn.trim() : "";
  const ipcCodes = Array.isArray(parsed.ipcCodes)
    ? parsed.ipcCodes.filter(
        (c): c is string => typeof c === "string" && c.trim().length > 0
      )
    : [];

  if (qn.length < 3 || qnEn.length < 3) {
    throw new Error("Gemini returned empty qn/qnEn");
  }

  return { qn, qnEn, ipcCodes };
}
