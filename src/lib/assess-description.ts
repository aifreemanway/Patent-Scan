const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_PROMPT = `Ты оцениваешь, достаточно ли пользовательского описания изобретения для патентного поиска БЕЗ уточняющих вопросов.

sufficient=true ТОЛЬКО если одновременно выполнены условия:
- Указан тип объекта (устройство / метод / процесс / вещество / система)
- Есть минимум два конкретных технических признака (компоненты, принципы работы, материалы, алгоритмы, параметры)
- Понятна область применения ИЛИ решаемая техническая задача

sufficient=false если:
- Описание состоит из одной идеи без технических деталей ("хочу сделать X")
- Нет ни одного конкретного технического признака, только общие слова ("инновационный", "уникальный", "на базе ИИ")
- Непонятно, устройство это, метод или услуга
- Описание маркетинговое, а не техническое

Верни СТРОГО валидный JSON без markdown-обёртки:
{
  "sufficient": true | false,
  "reason": "краткая причина на русском, 5-15 слов"
}

Примеры:
Вход: "Хочу сделать умный будильник для стариков, который лучше обычных"
→ {"sufficient": false, "reason": "нет технических признаков, одна идея без деталей"}

Вход: "Устройство для диагностики асинхронных двигателей методом MCSA на базе STM32F407 с RS-485, беспроводным модулем и режимом обучения"
→ {"sufficient": true, "reason": "указан тип, метод, компоненты, применение"}

Вход: "Система очистки воды с мембранами"
→ {"sufficient": false, "reason": "мало технических деталей, не ясна конкретика мембран"}`;

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

export type Assessment = {
  sufficient: boolean;
  reason: string;
};

export async function assessDescription(
  description: string,
  apiKey: string,
  timeoutMs = 15_000
): Promise<Assessment> {
  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: description }] }],
    generationConfig: {
      temperature: 0.1,
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
    throw new Error(`Gemini assess failed: ${resp.status}`);
  }

  const raw = (await resp.json()) as GeminiResponse;
  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

  const parsed = JSON.parse(cleaned) as {
    sufficient?: unknown;
    reason?: unknown;
  };

  const sufficient = parsed.sufficient === true;
  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim().length > 0
      ? parsed.reason.trim()
      : sufficient
        ? "описание достаточно полное"
        : "описание недостаточно подробное";

  return { sufficient, reason };
}
