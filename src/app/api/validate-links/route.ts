// Validate a FINAL, displayed set of patent links (source-link-invariant AC п.4
// / BUG-AC-2). The retrieval pipelines run client-side and fan out a wide net
// before ranking down to the handful actually shown; validating the wide net
// would hammer ФИПС/Google for patents that never display. So the client calls
// this ONCE, on the ranked set it is about to show, and we drop/downgrade any
// dead link via the shared validator (HEAD checks, 7-day cached).
//
// Best-effort by contract: the client treats a failure here as "keep the
// original links" — link-checking must never break a search. We still
// auth-gate + rate-limit + cap the input so it can't be abused as a generic
// SSRF/HEAD-amplifier (it only ever fetches the two known patent hosts the
// validator whitelists by behaviour).

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-quota";
import { rateLimit } from "@/lib/rate-limit";
import { validatePatentLinks, type LinkedHit } from "@/lib/link-validator";
import { RATE_WINDOW_MS } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 30;

// Displayed sets are small (Поиск ≤10, Экспертный/report ≤60, Ландшафт ≤~400).
// Cap well above the largest real set but bounded so one call can't fan out
// unboundedly.
const MAX_LINKS = 450;

export async function POST(req: Request) {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: 30,
    keyPrefix: "validate-links",
  });
  if (rl) return rl;

  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  let body: { hits?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.hits)) {
    return NextResponse.json({ error: "hits must be an array" }, { status: 400 });
  }

  // Keep only well-formed entries; preserve order so the client can map results
  // back by index. Over-cap → reject (the client never sends more than a report).
  if (body.hits.length > MAX_LINKS) {
    return NextResponse.json(
      { error: `too many hits (max ${MAX_LINKS})` },
      { status: 413 }
    );
  }

  const hits: LinkedHit[] = body.hits.map((h) => {
    const o = (h ?? {}) as Record<string, unknown>;
    return {
      id: typeof o.id === "string" ? o.id : "",
      country: typeof o.country === "string" ? o.country : "",
      url: typeof o.url === "string" ? o.url : "",
    };
  });

  const validated = await validatePatentLinks(hits);
  return NextResponse.json({ hits: validated });
}
