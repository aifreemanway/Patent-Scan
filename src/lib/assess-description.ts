import { GEMINI_TIMEOUT_MS } from "./config";
import { callGeminiJson } from "./gemini";

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

export type Assessment = {
  sufficient: boolean;
  reason: string;
};

export async function assessDescription(
  description: string,
  apiKey: string,
  timeoutMs: number = GEMINI_TIMEOUT_MS.assess
): Promise<Assessment> {
  const { data } = await callGeminiJson<{
    sufficient?: unknown;
    reason?: unknown;
  }>({
    apiKey,
    systemPrompt: SYSTEM_PROMPT,
    userText: description,
    temperature: 0.1,
    thinkingBudget: 512,
    timeoutMs,
  });

  const sufficient = data.sufficient === true;
  const reason =
    typeof data.reason === "string" && data.reason.trim().length > 0
      ? data.reason.trim()
      : sufficient
        ? "описание достаточно полное"
        : "описание недостаточно подробное";

  return { sufficient, reason };
}
