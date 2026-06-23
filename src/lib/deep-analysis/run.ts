// Core Deep Analysis logic — the Sonnet claim-by-claim novelty read + the
// anti-fabrication post-processing. Extracted from the (formerly synchronous)
// /api/deep-analysis route so BOTH the submit-time validation and the async
// worker can share one source of truth for the prompt and verification.
//
// This module is pure: it takes inputs + an API key, calls the Timeweb gateway,
// verifies every cited id against the input pool, and returns the response
// payload. No auth, no DB, no quota — those live in the route / worker.

import { callTimewebJson } from "@/lib/timeweb";
import { DEEP_ANALYSIS_MODEL, DEEP_ANALYSIS_TIMEOUT_MS } from "@/lib/config";

// Premium "deep" judge: a claim-by-claim novelty read over the SAME retrieved
// prior-art pool the free pass used — broken down by the distinguishing
// features of the invention (which are already disclosed, which are genuinely
// new), with the conservative honest-verdict framing.
export const DEEP_ANALYSIS_SYSTEM_PROMPT = `Ты — патентный эксперт высшей квалификации, готовишь углублённое заключение о патентоспособности. На вход: описание изобретения, уточнения и список найденных патентов-аналогов (id, страна, год, название, реферат) из открытых баз (Роспатент, US, EP, JP, CN).

Задача — РАЗБОР ПО ПРИЗНАКАМ: вычлени существенные отличительные признаки изобретения (как в формуле — устройство/способ + действие + объект + отличие) и по КАЖДОМУ признаку определи, раскрыт ли он в аналогах.

Верни СТРОГО валидный JSON без преамбул:
{
  "uniqueness": "High" | "Medium" | "Low",
  "uniquenessDetail": "2–3 предложения: почему такая итоговая оценка по совокупности признаков",
  "overview": "3–5 предложений: патентный ландшафт вокруг изобретения",
  "prototypes": [
    {
      "id": "<id ближайшего аналога из входа>",
      "common": "1–2 предложения: что общего у изобретения с этим аналогом",
      "distinction": "2–3 предложения ПРОЗОЙ: ключевое существенное отличие ВАШЕГО решения от этого аналога — что именно иначе/добавлено и почему это значимо для патентоспособности",
      "verdict": "1 короткое предложение: прямой аналог / частичный аналог / смежное решение"
    }
  ],
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
- ⚠ prototypes — ОБЯЗАТЕЛЬНОЕ поле и ГЛАВНЫЙ результат для пользователя: ВСЕГДА возвращай 3–5 САМЫХ БЛИЗКИХ аналогов из входа (по убыванию близости, первый = ближайший аналог), даже если это пересекается с features/patents — НЕ пропускай блок. По каждому — аналитическое заключение ПРОЗОЙ, как у патентного поверенного: что общего и чем именно ваше решение отличается от этого аналога. id ТОЛЬКО из входа, дословно (с суффиксом-датой, как во входе). Если во входе есть хоть один аналог — массив prototypes пустым быть НЕ должен. НИЧЕГО не выдумывай.
- ЗАПРЕЩЕНО выдумывать патенты/номера. Используй только id и title из входа.
- uniqueness: 'High' только если большинство существенных признаков 'novel'; 'Low' если ключевые признаки 'known'.
- Будь консервативен: это предварительный скрининг, а не гарантия патента. Язык ответа — язык описания изобретения.`;

export type FeatureStatus = "known" | "partially_known" | "novel";

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
type DeepPrototype = {
  id?: string;
  common?: string;
  distinction?: string;
  verdict?: string;
};
type DeepVerdict = {
  uniqueness?: "High" | "Medium" | "Low";
  uniquenessDetail?: string;
  overview?: string;
  features?: DeepFeature[];
  patents?: DeepPatent[];
  prototypes?: DeepPrototype[];
  recommendation?: string;
};

export type InputPatent = {
  id: string;
  title?: string;
  year?: string;
  country?: string;
  abstract?: string;
  ipc?: string[];
  url?: string;
};

/** The shape persisted to search_requests.result and returned to the client. */
export type DeepResponsePayload = DeepVerdict & {
  patents: Array<DeepPatent & { id: string; url: string }>;
  features: Array<{
    feature: string;
    status: FeatureStatus;
    analogIds: string[];
    note: string;
  }>;
  // Closest analogs (прототипы) with prose conclusions — the attorney-style
  // "here are the nearest, here's why you differ", ranked closest-first.
  prototypes: Array<{
    id: string;
    title: string;
    year: string;
    country: string;
    url: string;
    common: string;
    distinction: string;
    verdict: string;
  }>;
  deep: true;
};

function buildUserText(
  description: string,
  answers: string[],
  patents: InputPatent[]
): string {
  return [
    `ОПИСАНИЕ ИЗОБРЕТЕНИЯ:\n${description}`,
    answers.length > 0
      ? `УТОЧНЕНИЯ:\n${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
      : "",
    `НАЙДЕННЫЕ ПАТЕНТЫ (JSON):\n${JSON.stringify(patents, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Run the deep-analysis Sonnet call + anti-fabrication verification.
 *
 * Throws `TimewebError` on gateway failure (caller decides retry/refund).
 * Anti-fabrication guarantee: every cited id — in `patents` AND in each
 * feature's `analogIds` — must be a real id from the input pool, or it is
 * dropped (the prompt forbids fabrication; this is the structural safety net).
 */
export async function runDeepAnalysisVerdict(opts: {
  apiKey: string;
  description: string;
  answers: string[];
  patents: InputPatent[];
  /** Per-user spend attribution (СЛОЙ-2) — the worker passes the row's user_id. */
  userId?: string | null;
}): Promise<DeepResponsePayload> {
  const userText = buildUserText(opts.description, opts.answers, opts.patents);

  const { data } = await callTimewebJson<DeepVerdict>({
    apiKey: opts.apiKey,
    label: "deep-analysis",
    model: DEEP_ANALYSIS_MODEL,
    systemPrompt: DEEP_ANALYSIS_SYSTEM_PROMPT,
    userText,
    timeoutMs: DEEP_ANALYSIS_TIMEOUT_MS,
    userId: opts.userId,
    // Streaming removed the gateway's ~187s deadline, so we can afford the
    // headroom: a full per-patent verdict over up to 60 analogs overflowed the
    // 8192 default (finish_reason "length" → truncated, invalid JSON). 16384
    // lets the JSON close while keeping the full analog set (no quality cut).
    maxTokens: 16384,
  });

  const normKey = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const byId = new Map(
    opts.patents.filter((p) => p.id).map((p) => [normKey(p.id), p] as const)
  );

  const verdictPatents = Array.isArray(data.patents) ? data.patents : [];
  const verified = verdictPatents.flatMap((p) => {
    const src = p && typeof p.id === "string" ? byId.get(normKey(p.id)) : undefined;
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

  const features = (Array.isArray(data.features) ? data.features : []).map((f) => {
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
  });

  // Prototypes: same anti-fab net as patents — keep only real input ids and
  // stamp the authoritative id/title/year/country/url from the retrieved hit.
  const prototypes = (Array.isArray(data.prototypes) ? data.prototypes : [])
    .flatMap((p) => {
      const src =
        p && typeof p.id === "string" ? byId.get(normKey(p.id)) : undefined;
      if (!src) return [];
      return [
        {
          id: src.id,
          title: src.title ?? "",
          year: src.year ?? "",
          country: src.country ?? "",
          url: src.url ?? "",
          common: typeof p.common === "string" ? p.common : "",
          distinction: typeof p.distinction === "string" ? p.distinction : "",
          verdict: typeof p.verdict === "string" ? p.verdict : "",
        },
      ];
    })
    .slice(0, 5);

  return {
    ...data,
    patents: verified,
    features,
    prototypes,
    deep: true,
  };
}
