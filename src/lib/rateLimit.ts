import { getRateLimitAdapter } from "@/lib/infra/rate-limit/getRateLimitAdapter";

type RateLimitConfig = {
  scope: string;
  key: string;
  max: number;
  windowMs: number;
};

type RateLimitResult = {
  ok: boolean;
  retryAfterMs: number;
  remaining: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const cleanupBuckets = (now: number) => {
  if (buckets.size < 2000) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const FAIL_OPEN_ON_ADAPTER_ERROR = parseBoolean(
  process.env.RATE_LIMIT_FAIL_OPEN,
  true
);

export const checkRateLimit = (config: RateLimitConfig): RateLimitResult => {
  const max = Math.max(1, Math.trunc(config.max));
  const windowMs = Math.max(1000, Math.trunc(config.windowMs));
  const now = Date.now();
  cleanupBuckets(now);

  const bucketKey = `${config.scope}:${config.key}`;
  const existing = buckets.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0, remaining: max - 1 };
  }

  if (existing.count >= max) {
    return {
      ok: false,
      retryAfterMs: Math.max(0, existing.resetAt - now),
      remaining: 0,
    };
  }

  existing.count += 1;
  buckets.set(bucketKey, existing);
  return {
    ok: true,
    retryAfterMs: 0,
    remaining: Math.max(0, max - existing.count),
  };
};

export const checkRateLimitDistributed = async (
  config: RateLimitConfig
): Promise<RateLimitResult> => {
  try {
    const adapter = getRateLimitAdapter();
    return await adapter.consume(config);
  } catch (error) {
    console.error("[rate-limit] adapter error", {
      scope: config.scope,
      key: config.key,
      error: error instanceof Error ? error.message : String(error),
      failOpen: FAIL_OPEN_ON_ADAPTER_ERROR,
    });
    if (FAIL_OPEN_ON_ADAPTER_ERROR) {
      return {
        ok: true,
        retryAfterMs: 0,
        remaining: Math.max(0, Math.trunc(config.max) - 1),
      };
    }
    return {
      ok: false,
      retryAfterMs: 1000,
      remaining: 0,
    };
  }
};

export const resolveClientIp = (headers: Headers) => {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
};

export type { RateLimitConfig, RateLimitResult };
