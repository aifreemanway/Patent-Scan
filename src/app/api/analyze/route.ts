import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 90;

const TIMEOUT_MS = 90_000;
const MAX_DESCRIPTION_LEN = 50_000;
const MAX_ANSWERS = 20;
const MAX_ANSWER_LEN = 5_000;

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_PROMPT = `Ты — эксперт-патентовед с опытом подготовки заключений о патентной чистоте. На вход: описание изобретения и список найденных патентов/публикаций из открытых баз (Роспатент, EPO, USPTO).

Задача: оценить патентоспособность изобретения (новизна + изобретательский уровень) относительно найденных аналогов.

Верни СТРОГО валидный JSON без преамбул:
{
  "uniqueness": "High" | "Medium" | "Low",
  "uniquenessDetail": "2–3 предложения: ключевые совпадающие/отличительные признаки, почему такая оценка",
  "overview": "4–6 предложений: патентный ландшафт — основные технические направления среди аналогов, хронология (пик активности), ведущие страны/заявители, тренды",
  "patents": [
    {
      "id": "<id из входа, без изменений>",
      "title": "<title из входа>",
      "year": "<YYYY>",
      "country": "<2-буквенный код>",
      "similarity": "High" | "Medium" | "Low",
      "match": "какие существенные признаки изобретения совпадают с этим аналогом (конкретно: метод, устройство, материал, параметр)",
      "diff": "какие существенные признаки изобретения отсутствуют в аналоге или решены иначе"
    }
  ],
  "recommendation": "3–5 предложений: (1) итоговая оценка перспектив патентования, (2) какие признаки стоит усилить в формуле, (3) конкретный следующий шаг — доработать формулу / подать заявку / обратиться к патентному поверенному"
}

Правила оценки similarity:
- High: аналог решает ту же техническую задачу тем же способом, совпадают ≥3 существенных признака из формулы
- Medium: аналог решает схожую задачу, но другим методом, или совпадают 1–2 существенных признака
- Low: аналог из той же области, но техническое решение принципиально другое

Правила uniqueness:
- High: нет аналогов с High similarity, ≤1 аналог с Medium → высокие шансы на патент
- Medium: есть 1+ аналог с High или 2+ с Medium → нужна доработка формулы
- Low: 2+ аналога с High similarity → прямые аналоги, патентование затруднено

Общие правила:
- Включи в patents 5–10 самых релевантных записей из входа. Если во входе меньше — включи все.
- ЗАПРЕЩЕНО выдумывать патенты. Используй ТОЛЬКО те id и title, что пришли на вход.
- В match/diff называй конкретные технические признаки, а не общие фразы.
- Если abstract аналога пуст — оценивай по title и IPC-классам, отметь это.
- Язык ответа — тот же, что и у описания изобретения.`;

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

type InputPatent = {
  id: string;
  title?: string;
  year?: string;
  country?: string;
  abstract?: string;
  ipc?: string[];
};

export async function POST(req: Request) {
  const rl = await rateLimit(req, { windowMs: 60_000, max: 5, keyPrefix: "analyze" });
  if (rl) return rl;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Service configuration error" }, { status: 500 });
  }

  let body: {
    description?: string;
    answers?: string[];
    patents?: InputPatent[];
  };
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

  const patents = (body.patents ?? []).slice(0, 30);
  const answers = (body.answers ?? [])
    .filter((a) => a && a.trim().length > 0)
    .slice(0, MAX_ANSWERS)
    .map((a) => a.slice(0, MAX_ANSWER_LEN));

  const userParts = [
    `ОПИСАНИЕ ИЗОБРЕТЕНИЯ:\n${description}`,
    answers.length > 0 ? `УТОЧНЕНИЯ:\n${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}` : "",
    `НАЙДЕННЫЕ ПАТЕНТЫ (JSON):\n${JSON.stringify(patents, null, 2)}`,
  ].filter(Boolean).join("\n\n");

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userParts }] }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 1024 },
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
    return NextResponse.json({ error: "Analysis service unavailable" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    return NextResponse.json({ error: "Analysis service error" }, { status: 502 });
  }

  const raw = (await resp.json()) as GeminiResponse;
  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json(
      { error: "Analysis returned invalid response" },
      { status: 502 }
    );
  }

  return NextResponse.json(parsed);
}
