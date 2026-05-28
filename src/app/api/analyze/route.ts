import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import {
  GEMINI_TIMEOUT_MS,
  MAX_DESCRIPTION_LEN,
  MAX_ANSWERS,
  MAX_ANSWER_LEN,
  MAX_PATENTS_ANALYZE,
  RATE_WINDOW_MS,
  RATE_MAX,
} from "@/lib/config";
import {
  callGeminiJson,
  GeminiError,
  geminiErrorToStatus,
} from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 90;

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

type InputPatent = {
  id: string;
  title?: string;
  year?: string;
  country?: string;
  abstract?: string;
  ipc?: string[];
  url?: string;
};

type VerdictPatent = {
  id?: string;
  title?: string;
  year?: string;
  country?: string;
  similarity?: "High" | "Medium" | "Low";
  match?: string;
  diff?: string;
};

type AnalyzeVerdict = {
  uniqueness?: "High" | "Medium" | "Low";
  uniquenessDetail?: string;
  overview?: string;
  patents?: VerdictPatent[];
  recommendation?: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.analyze,
    keyPrefix: "analyze",
  });
  if (rl) return rl;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Service configuration error" },
      { status: 500 }
    );
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

  const patents = (body.patents ?? []).slice(0, MAX_PATENTS_ANALYZE);
  const answers = (body.answers ?? [])
    .filter((a) => a && a.trim().length > 0)
    .slice(0, MAX_ANSWERS)
    .map((a) => a.slice(0, MAX_ANSWER_LEN));

  const userText = [
    `ОПИСАНИЕ ИЗОБРЕТЕНИЯ:\n${description}`,
    answers.length > 0
      ? `УТОЧНЕНИЯ:\n${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
      : "",
    `НАЙДЕННЫЕ ПАТЕНТЫ (JSON):\n${JSON.stringify(patents, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const { data } = await callGeminiJson<AnalyzeVerdict>({
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      userText,
      temperature: 0.3,
      thinkingBudget: 1024,
      timeoutMs: GEMINI_TIMEOUT_MS.analyze,
    });

    // Anti-fabrication: a uniqueness verdict is legally consequential, so every
    // cited patent must be a REAL document the search actually retrieved — not
    // an id the model paraphrased into existence. The input patents are all real
    // PatSearch hits (each already carries a working source URL), so the ground
    // truth is membership in that retrieved set. Keep only verdict patents whose
    // id was in the input, and stamp each with the authoritative id/title/year/
    // country/url from the retrieved hit (never the model's, which it can mangle)
    // — this also gives the report a working link for every row. A live GET /docs
    // recheck would add latency and could drop a real analog on a transient
    // error, so membership is both safer and sufficient here.
    // Match on a normalized key (uppercase, alphanumerics only) so a model that
    // echoes an id with cosmetic drift (spaces, punctuation, case) still matches
    // its real retrieved hit instead of being wrongly dropped. A fabricated id
    // still matches nothing, so this stays fabrication-proof.
    const normKey = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const byId = new Map(
      patents
        .filter((p) => p.id)
        .map((p) => [normKey(p.id), p] as const)
    );
    const verdictPatents = Array.isArray(data.patents) ? data.patents : [];
    const verified = verdictPatents.flatMap((p) => {
      const src =
        p && typeof p.id === "string" ? byId.get(normKey(p.id)) : undefined;
      if (!src) return [];
      return [
        {
          ...p,
          id: src.id,
          title: src.title || p.title || "",
          year: src.year || p.year || "",
          country: src.country || p.country || "",
          url: src.url ?? "",
        },
      ];
    });
    const dropped = verdictPatents.length - verified.length;
    if (dropped > 0) {
      console.warn("[analyze] dropped unverified verdict patents", {
        dropped,
        kept: verified.length,
      });
    }

    return NextResponse.json({ ...data, patents: verified });
  } catch (e) {
    if (e instanceof GeminiError) {
      return NextResponse.json(
        { error: "Analysis service error" },
        { status: geminiErrorToStatus(e) }
      );
    }
    return NextResponse.json(
      { error: "Analysis service unavailable" },
      { status: 502 }
    );
  }
}
