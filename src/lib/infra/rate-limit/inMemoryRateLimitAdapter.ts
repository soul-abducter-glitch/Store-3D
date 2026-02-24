import type {
  RateLimitAdapter,
  RateLimitConsumeInput,
  RateLimitConsumeResult,
} from "@/lib/infra/rate-limit/rateLimitAdapter";

type Bucket = {
  count: number;
  resetAt: number;
};

export class InMemoryRateLimitAdapter implements RateLimitAdapter {
  private readonly buckets = new Map<string, Bucket>();

  private cleanup(now: number) {
    if (this.buckets.size < 2000) return;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  async consume(input: RateLimitConsumeInput): Promise<RateLimitConsumeResult> {
    const max = Math.max(1, Math.trunc(input.max));
    const windowMs = Math.max(1000, Math.trunc(input.windowMs));
    const now = Date.now();
    this.cleanup(now);

    const bucketKey = `${input.scope}:${input.key}`;
    const existing = this.buckets.get(bucketKey);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
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
    this.buckets.set(bucketKey, existing);
    return {
      ok: true,
      retryAfterMs: 0,
      remaining: Math.max(0, max - existing.count),
    };
  }
}
