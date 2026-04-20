import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const TIMEOUT_MS = 30_000;
const MAX_DESCRIPTION_LEN = 50_000;

const SYSTEM_PROMPT = `Ты — ассистент патентного поиска. На вход получаешь описание изобретения (на любом языке).

Задача: задать 3–4 уточняющих вопроса, ответы на которые помогут:
1. Точнее определить классы МПК для поиска
2. Выделить существенные отличительные признаки изобретения
3. Сузить область поиска до конкретной технической задачи

Категории вопросов (задай по одному из каждой):
- Область применения и конечный пользователь (промышленность, медицина, быт и т.д.)
- Ключевой технический приём или принцип действия (алгоритм, физический эффект, конструкция)
- Чем решение отличается от известных аналогов (параметр, материал, архитектура)
- Ограничения или условия эксплуатации (температура, среда, масштаб)

Формулируй кратко (до 15 слов). Вопросы — на том же языке, что и описание. Никаких преамбул.

Верни СТРОГО валидный JSON:
{ "questions": ["вопрос 1", "вопрос 2", "вопрос 3"] }`;

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

export async function POST(req: Request) {
  const rl = await rateLimit(req, { windowMs: 60_000, max: 20, keyPrefix: "questions" });
  if (rl) return rl;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Service configuration error" }, { status: 500 });
  }

  let body: { description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const description = (body.description ?? "").trim();
  if (description.length < 20) {
    return NextResponse.json(
      { error: "description must be at least 20 characters" },
      { status: 400 }
    );
  }
  if (description.length > MAX_DESCRIPTION_LEN) {
    return NextResponse.json(
      { error: `description must be at most ${MAX_DESCRIPTION_LEN} characters` },
      { status: 413 }
    );
  }

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: description }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 512 },
    },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch {
    return NextResponse.json({ error: "Questions service unavailable" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    return NextResponse.json({ error: "Questions service error" }, { status: 502 });
  }

  const raw = (await resp.json()) as GeminiResponse;
  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

  let parsed: { questions?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "Invalid response from questions service" }, { status: 502 });
  }

  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    : [];

  if (questions.length === 0) {
    return NextResponse.json({ error: "No questions generated" }, { status: 502 });
  }

  return NextResponse.json({ questions });
}
