import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { requireAuth } from "@/lib/auth-quota";
import { checkAndChargeQuota } from "@/lib/quota";
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
import {
  countExpertRuns,
  createSearchRequest,
  deriveTopic,
  markSearchRequestCompleted,
  markSearchRequestError,
} from "@/lib/search-requests";
import { computeInputRichness, newSessionId } from "@/lib/calibration";

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

  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const apiKey = process.env.TIMEWEB_AI_KEY;
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
    // "v2" marks an «Экспертный поиск» run (opt-in recall-v2 path).
    engine?: string;
    // Silent-capture calibration extras (optional, backward-compatible).
    questions?: string[];
    diagnostics?: { topGroups?: string[]; queries?: string[]; total?: number };
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

  // Quota (Guardrail B): «Экспертный поиск» (engine="v2") gets 1 free run per
  // account — a SEPARATE entitlement, NOT drawn from the monthly Поиск quota.
  // The first expert run (no prior engine='v2' rows) is free; after that it
  // spends the search quota (or 402-upsells on exceed). Consumer search always
  // spends the search quota. Auth already happened above without charging.
  const isExpert = body.engine === "v2";
  let tier: string | null = null;
  const freeExpertRun = isExpert && (await countExpertRuns(guard.user.id)) === 0;
  if (!freeExpertRun) {
    const quota = await checkAndChargeQuota(guard.user.id, "search");
    if (!quota.ok) {
      return quota.reason === "quota_exceeded"
        ? NextResponse.json(
            {
              error: "quota_exceeded",
              tier: quota.tier,
              limit: quota.limit,
              used: quota.used,
              operation: "search",
            },
            { status: 402 }
          )
        : NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    tier = quota.tier ?? null;
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

  // History row created before the heavy call so a route crash still leaves a
  // record (worker would never see it, but /account/history will). Failure here
  // returns null and we proceed without logging — see search-requests.ts.
  // Silent-capture calibration: a fresh session id + deterministic richness of
  // the user's description, plus the clarifying Q&A (answers always; questions
  // only if the client sent them). Nested under params.calibration — additive,
  // never changes the response shape, and a failure here can't break a search.
  const sessionId = newSessionId();
  const questions = Array.isArray(body.questions)
    ? body.questions.filter((q): q is string => typeof q === "string")
    : undefined;

  const sr = await createSearchRequest({
    userId: guard.user.id,
    type: "novelty",
    topic: deriveTopic(description),
    description,
    params: {
      answers,
      patentsInput: patents.length,
      // Instrumentation (Guardrail E, no new PII surface): engine/mode let us
      // pull side-by-side v1-vs-v2 pairs and back the 1-free expert counter.
      engine: isExpert ? "v2" : "v1",
      mode: isExpert ? "field" : "verdict",
    },
    calibration: {
      session_id: sessionId,
      input_richness: computeInputRichness(description),
      clarifying_qa: {
        answers,
        ...(questions && questions.length > 0 ? { questions } : {}),
      },
    },
  });

  const diagnostics = body.diagnostics;

  try {
    const { data } = await callGeminiJson<AnalyzeVerdict>({
      apiKey,
      label: "analyze",
      systemPrompt: SYSTEM_PROMPT,
      userText,
      temperature: 0.3,
      reasoningEffort: "none",
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

    const responsePayload = { ...data, patents: verified };
    // Output-side calibration (nested under result.calibration). No-op fields
    // when the client didn't send diagnostics.
    const calibrationOutput =
      diagnostics?.topGroups || diagnostics?.queries
        ? {
            ipc_queried: diagnostics?.topGroups,
            queries_sent: diagnostics?.queries,
          }
        : undefined;
    await markSearchRequestCompleted(
      sr?.id ?? null,
      responsePayload,
      undefined,
      calibrationOutput
    );
    return NextResponse.json({
      ...responsePayload,
      requestId: sr?.id ?? null,
      // Account tier — lets the report pick a smart Verdict/Field default
      // (institute/team+/enterprise → Field). Null on a free expert run (no
      // charge happened); the report still defaults to Field via _expert.
      tier,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Analysis service unavailable";
    await markSearchRequestError(sr?.id ?? null, message);
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
