import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { requireAuth } from "@/lib/auth-quota";
import { RATE_WINDOW_MS, RATE_MAX } from "@/lib/config";
import {
  fetchRuLegalStatuses,
  type LegalStatus,
} from "@/lib/patent-legal-status";

export const runtime = "nodejs";
// No Vercel ceiling on the VPS, but keep a sane upper bound: a 400-patent batch
// at 8-wide concurrency with a 12s per-fetch timeout stays well under this.
export const maxDuration = 60;

// Cap the batch so a single request can't fan out unbounded ФИПС fetches.
const MAX_NUMBERS = 400;

// Only RU patent numbers belong here (Этап 1, RU-only). Accept ids like
// "RU2828633C1" or bare digits; everything else is filtered out client-side
// already, but we re-validate server-side.
function toRuNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  // Reject anything that names a non-RU office prefix (US…, EP…, CN… etc).
  const cc = /^([A-Z]{2})/.exec(s.toUpperCase());
  if (cc && cc[1] !== "RU" && cc[1] !== "SU") return null;
  // Keep the FULL id (with kind, e.g. "RU88863U1") — the resolver needs the kind
  // to pick RUPM (полезная модель) vs RUPAT (изобретение). Must carry a number.
  return /\d/.test(s) ? s : null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const rl = await rateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX.legalStatus,
    keyPrefix: "legalStatus",
  });
  if (rl) return rl;

  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  let body: { numbers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.numbers)) {
    return NextResponse.json(
      { error: "numbers must be an array" },
      { status: 400 }
    );
  }

  const ruNumbers = body.numbers
    .map(toRuNumber)
    .filter((n): n is string => n != null)
    .slice(0, MAX_NUMBERS);

  if (ruNumbers.length === 0) {
    return NextResponse.json({ statuses: {} as Record<string, LegalStatus> });
  }

  const statuses = await fetchRuLegalStatuses(ruNumbers);
  return NextResponse.json({ statuses });
}
