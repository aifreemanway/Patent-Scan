import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { requireAuth } from "@/lib/auth-quota";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import {
  callTimewebJson,
  TimewebError,
  timewebErrorToStatus,
} from "@/lib/timeweb";
import {
  DEEP_ANALYSIS_MODEL,
  DEEP_ANALYSIS_TIMEOUT_MS,
  MAX_DESCRIPTION_LEN,
  MAX_ANSWERS,
  MAX_ANSWER_LEN,
  MAX_PATENTS_ANALYZE,
  RATE_WINDOW_MS,
  RATE_MAX,
} from "@/lib/config";

export const runtime = "nodejs";
// Sonnet claim-by-claim is long. Exceeds Vercel Pro's 60s cap → needs a no-cap
// host (Timeweb VPS) in prod; fine locally and on the deferred deploy target.
export const maxDuration = 120;

// Premium "deep" judge: a claim-by-claim novelty read over the SAME retrieved
// prior-art pool the free pass used — broken down by the distinguishing
// features of the invention (which are already disclosed, which are genuinely
// new), with the conservative honest-verdict framing.
const SYSTEM_PROMPT = `Ты — патентный эксперт высшей квалификации, готовишь углублённое заключение о патентоспособности. На вход: описание изобретения, уточнения и список найденных патентов-аналогов (id, страна, год, название, реферат) из открытых баз (Роспатент, US, EP, JP, CN).

Задача — РАЗБОР ПО ПРИЗНАКАМ: вычлени существенные отличительные признаки изобретения (как в формуле — устройство/способ + действие + объект + отличие) и по КАЖДОМУ признаку определи, раскрыт ли он в аналогах.

Верни СТРОГО валидный JSON без преамбул:
{
  "uniqueness": "High" | "Medium" | "Low",
  "uniquenessDetail": "2–3 предложения: почему такая итоговая оценка по совокупности признаков",
  "overview": "3–5 предложений: патентный ландшафт вокруг изобретения",
  "features": [
    {
      "feature": "существенный признак изобретения своими словами",
      "status": "known" | "partially_known" | "novel",
      "analogIds": ["<id аналога из входа, раскрывающего признак>", ...],
      "note": "1–2 предложения: чем именно аналог раскрывает признак, или почему признак нов"
    }
  ],
  "patents": [
    {
      "id": "<id из входа, без изменений>",
      "title": "<title из входа>",
      "year": "<YYYY>",
      "country": "<2-буквенный код>",
      "similarity": "High" | "Medium" | "Low",
      "match": "какие существенные признаки совпадают",
      "diff": "какие существенные признаки отсутствуют/решены иначе"
    }
  ],
  "recommendation": "3–5 предложений: перспективы патентования, какие признаки усилить в формуле, конкретный следующий шаг"
}

Правила:
- features: 3–8 существенных признаков. status='known' если признак прямо раскрыт хотя бы одним аналогом; 'partially_known' если раскрыт частично/смежно; 'novel' если в аналогах не найден.
- analogIds: ТОЛЬКО id из входа, дословно. Если признак нов — пустой массив. НИЧЕГО не выдумывай.
- ЗАПРЕЩЕНО выдумывать патенты/номера. Используй только id и title из входа.
- uniqueness: 'High' только если большинство существенных признаков 'novel'; 'Low' если ключевые признаки 'known'.
- Будь консервативен: это предварительный скрининг, а не гарантия патента. Язык ответа — язык описания изобретения.`;

type FeatureStatus = "known" | "partially_known" | "novel";
type DeepFeature = {
  feature?: string;
  status?: FeatureStatus;
  analogIds?: unknown;
  note?: string;
};
type DeepPatent = {
  id?: string;
  title?: string;
  year?: string;
  country?: string;
  similarity?: "High" | "Medium" | "Low";
  match?: string;
  diff?: string;
};
type DeepVerdict = {
  uniqueness?: "High" | "Medium" | "Low";
  uniquenessDetail?: string;
  overview?: string;
  features?: DeepFeature[];
  patents?: DeepPatent[];
  recommendation?: string;
};

type InputPatent = {
  id: string;
  title?: string;
  year?: string;
  country?: string;
  abstract?: string;
  ipc?: string[];
  url?: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.deepAnalysis,
    keyPrefix: "deep-analysis",
  });
  if (rl) return rl;

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const apiKey = process.env.TIMEWEB_AI_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Service configuration error" },
      { status: 500 }
    );
  }

  // Claim the one free Deep Analysis atomically (anti-abuse §5: strictly one per
  // verified account). Billing for additional runs is fast-follow.
  const admin = createSupabaseAdmin();
  const { data: consumeRaw, error: consumeErr } = await admin.rpc(
    "consume_free_deep_analysis",
    { p_user_id: auth.user.id }
  );
  if (consumeErr) {
    console.error("[deep-analysis] consume rpc failed", {
      message: consumeErr.message,
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  const consume = consumeRaw as { allowed?: boolean; reason?: string };
  if (!consume?.allowed) {
    return NextResponse.json(
      { error: "deep_analysis_used", reason: consume?.reason ?? "already_used" },
      { status: 402 }
    );
  }

  // From here the credit is claimed — refund it on any downstream failure.
  // Self-guarding so a refund hiccup never masks the real error path.
  const refund = async () => {
    try {
      await admin.rpc("refund_free_deep_analysis", { p_user_id: auth.user.id });
    } catch (err) {
      console.error("[deep-analysis] refund failed", err);
    }
  };

  let body: {
    description?: string;
    answers?: string[];
    patents?: InputPatent[];
  };
  try {
    body = await req.json();
  } catch {
    await refund();
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const description = (body.description ?? "").trim();
  if (description.length < 20) {
    await refund();
    return NextResponse.json(
      { error: "description must be at least 20 characters" },
      { status: 400 }
    );
  }
  if (description.length > MAX_DESCRIPTION_LEN) {
    await refund();
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
    const { data } = await callTimewebJson<DeepVerdict>({
      apiKey,
      label: "deep-analysis",
      model: DEEP_ANALYSIS_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userText,
      timeoutMs: DEEP_ANALYSIS_TIMEOUT_MS,
    });

    // Anti-fabrication (same guarantee as /api/analyze): every cited id — in
    // patents AND in each feature's analogIds — must be a real retrieved hit.
    const normKey = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const byId = new Map(
      patents.filter((p) => p.id).map((p) => [normKey(p.id), p] as const)
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

    const features = (Array.isArray(data.features) ? data.features : []).map(
      (f) => {
        const ids = Array.isArray(f.analogIds) ? f.analogIds : [];
        const analogIds = ids
          .filter((id): id is string => typeof id === "string")
          .map((id) => byId.get(normKey(id))?.id)
          .filter((id): id is string => Boolean(id));
        return {
          feature: typeof f.feature === "string" ? f.feature : "",
          status: f.status ?? "partially_known",
          analogIds,
          note: typeof f.note === "string" ? f.note : "",
        };
      }
    );

    return NextResponse.json({
      ...data,
      patents: verified,
      features,
      deep: true,
    });
  } catch (e) {
    await refund();
    if (e instanceof TimewebError) {
      return NextResponse.json(
        { error: "Deep analysis service error" },
        { status: timewebErrorToStatus(e) }
      );
    }
    return NextResponse.json(
      { error: "Deep analysis service unavailable" },
      { status: 502 }
    );
  }
}
