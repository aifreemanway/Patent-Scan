import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { requireAuth } from "@/lib/auth-quota";
import {
  GEMINI_TIMEOUT_MS,
  MAX_DESCRIPTION_LEN,
  RATE_WINDOW_MS,
  RATE_MAX,
} from "@/lib/config";
import {
  callGeminiJson,
  GeminiError,
  geminiErrorToStatus,
} from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

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

export async function POST(req: Request): Promise<NextResponse> {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.questions,
    keyPrefix: "questions",
  });
  if (rl) return rl;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Service configuration error" },
      { status: 500 }
    );
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

  // Auth gate — questions are free (no quota) but still behind login.
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const { data } = await callGeminiJson<{ questions?: unknown }>({
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      userText: description,
      temperature: 0.4,
      thinkingBudget: 512,
      timeoutMs: GEMINI_TIMEOUT_MS.questions,
    });

    const questions = Array.isArray(data.questions)
      ? data.questions.filter(
          (q): q is string => typeof q === "string" && q.trim().length > 0
        )
      : [];

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "No questions generated" },
        { status: 502 }
      );
    }

    return NextResponse.json({ questions });
  } catch (e) {
    if (e instanceof GeminiError) {
      return NextResponse.json(
        { error: "Questions service error" },
        { status: geminiErrorToStatus(e) }
      );
    }
    return NextResponse.json(
      { error: "Questions service unavailable" },
      { status: 502 }
    );
  }
}
