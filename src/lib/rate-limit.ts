import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Entry = { count: number; resetAt: number };
const buckets = new Map<string, Entry>();
const rlCache = new Map<string, Ratelimit>();

let redis: Redis | null = null;
let redisChecked = false;
let warnedMissingUpstash = false;

function getRedis(): Redis | null {
  if (redisChecked) return redis;
  redisChecked = true;
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    if (!warnedMissingUpstash && process.env.NODE_ENV === "production") {
      console.warn(
        "[rate-limit] Upstash env vars missing in production — falling back to in-memory (non-persistent)."
      );
      warnedMissingUpstash = true;
    }
    return null;
  }
  try {
    redis = Redis.fromEnv();
  } catch (e) {
    console.error("[rate-limit] Failed to init Upstash Redis:", e);
    redis = null;
  }
  return redis;
}

function getRatelimiter(windowMs: number, max: number): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  const key = `${max}-${windowMs}`;
  let rl = rlCache.get(key);
  if (!rl) {
    const window = (windowMs >= 1000
      ? `${Math.floor(windowMs / 1000)} s`
      : `${windowMs} ms`) as `${number} s` | `${number} ms`;
    rl = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(max, window),
      prefix: "@ratelimit",
      analytics: false,
    });
    rlCache.set(key, rl);
  }
  return rl;
}

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function rateLimit(
  req: Request,
  opts: { windowMs: number; max: number; keyPrefix?: string }
): Promise<NextResponse | null> {
  const key = `${opts.keyPrefix ?? "rl"}:${clientIp(req)}`;

  const limiter = getRatelimiter(opts.windowMs, opts.max);
  if (limiter) {
    try {
      const { success, limit, remaining, reset } = await limiter.limit(key);
      if (!success) {
        const retryAfter = Math.max(Math.ceil((reset - Date.now()) / 1000), 1);
        return NextResponse.json(
          { error: "Too many requests" },
          {
            status: 429,
            headers: {
              "Retry-After": String(retryAfter),
              "X-RateLimit-Limit": String(limit),
              "X-RateLimit-Remaining": String(remaining),
              "X-RateLimit-Reset": String(Math.ceil(reset / 1000)),
            },
          }
        );
      }
      return null;
    } catch (e) {
      console.error("[rate-limit] Upstash call failed, falling back:", e);
    }
  }

  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(key, entry);
  }
  entry.count++;
  if (entry.count > opts.max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(opts.max),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
        },
      }
    );
  }
  return null;
}
