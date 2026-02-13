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
