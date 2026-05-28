import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
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

// Examiner-style relevance filter over a broad candidate pool. Retrieval ranks
// a prior-art doc by query-paraphrase similarity, so a relevant analog worded
// differently can sit deep in the pool. This pass reads every candidate's title
// and selects the ones that match by technical MEANING, regardless of rank — so
// the analyze window contains the real analogs, not just the top retrieval hits.
const SYSTEM_PROMPT = `Ты — патентный эксперт по оценке новизны. На вход: описание изобретения и список патентов-кандидатов (id + страна + год + название).

Задача: отобрать кандидатов, которые ПО ТЕХНИЧЕСКОМУ СМЫСЛУ являются вероятными аналогами (prior-art) для оценки новизны изобретения — даже если названы совсем другими словами.

Верни СТРОГО валидный JSON без преамбул:
{ "ids": ["<id точно как во входе>", ...] }

Правила:
- До {{N}} самых релевантных id, самые близкие по сути — первыми.
- Используй ТОЛЬКО id из входа, дословно. НИЧЕГО не выдумывай.
- Включай аналог, если совпадает суть: тип устройства/способа + объект воздействия (расплав, фурма, охлаждаемый элемент, вдувание газа/порошка, продувка и т.п.), даже при иной формулировке.
- Отбрасывай явно нерелевантное (другая отрасль/назначение).
- Лучше включить пограничный аналог, чем пропустить релевантный — это поиск prior-art.`;

type Candidate = {
  id?: unknown;
  title?: unknown;
  titleEn?: unknown;
  titleRu?: unknown;
  year?: unknown;
  country?: unknown;
};

export async function POST(req: Request): Promise<NextResponse> {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.priorArtRank,
    keyPrefix: "rank",
  });
  if (rl) return rl;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Service configuration error" },
      { status: 500 }
    );
  }

  let body: { description?: string; candidates?: Candidate[]; limit?: number };
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

  const candidates = (Array.isArray(body.candidates) ? body.candidates : [])
    .map((c) => ({
      id: typeof c.id === "string" ? c.id : "",
      title:
        (typeof c.title === "string" && c.title) ||
        (typeof c.titleEn === "string" && c.titleEn) ||
        (typeof c.titleRu === "string" && c.titleRu) ||
        "",
      year: typeof c.year === "string" ? c.year : "",
      country: typeof c.country === "string" ? c.country : "",
    }))
    .filter((c) => c.id)
    .slice(0, 800);

  const validIds = new Set(candidates.map((c) => c.id));
  if (candidates.length === 0) {
    return NextResponse.json({ ids: [] });
  }

  const n = Math.min(Math.max(body.limit ?? 60, 1), 120);
  const systemPrompt = SYSTEM_PROMPT.replace("{{N}}", String(n));
  const userText = [
    `ОПИСАНИЕ ИЗОБРЕТЕНИЯ:\n${description}`,
    `КАНДИДАТЫ (id | страна год | название):\n${candidates
      .map((c) => `${c.id} | ${c.country} ${c.year} | ${c.title}`)
      .join("\n")}`,
  ].join("\n\n");

  try {
    const { data } = await callGeminiJson<{ ids?: unknown }>({
      apiKey,
      systemPrompt,
      userText,
      temperature: 0.2,
      thinkingBudget: 512,
      timeoutMs: GEMINI_TIMEOUT_MS.rank,
    });
    const ids = Array.isArray(data.ids)
      ? data.ids
          .filter((id): id is string => typeof id === "string" && validIds.has(id))
          .slice(0, n)
      : [];
    return NextResponse.json({ ids });
  } catch (e) {
    if (e instanceof GeminiError) {
      return NextResponse.json(
        { error: "Ranking service error" },
        { status: geminiErrorToStatus(e) }
      );
    }
    return NextResponse.json(
      { error: "Ranking service unavailable" },
      { status: 502 }
    );
  }
}
