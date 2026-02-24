import { InMemoryRateLimitAdapter } from "@/lib/infra/rate-limit/inMemoryRateLimitAdapter";
import { RedisRateLimitAdapter } from "@/lib/infra/rate-limit/redisRateLimitAdapter";
import type { RateLimitAdapter } from "@/lib/infra/rate-limit/rateLimitAdapter";
import { isRedisConfigured } from "@/lib/infra/redis/redisConfig";

export type RateLimitDriver = "memory" | "redis";

const resolveRawRateLimitDriver = () =>
  String(process.env.RATE_LIMIT_DRIVER || "memory").trim().toLowerCase();

export const resolveRateLimitDriver = (): RateLimitDriver =>
  resolveRawRateLimitDriver() === "redis" ? "redis" : "memory";

let singleton: RateLimitAdapter | null = null;

export const getRateLimitAdapter = (): RateLimitAdapter => {
  if (singleton) return singleton;
  const driver = resolveRateLimitDriver();
  if (driver === "redis") {
    if (!isRedisConfigured()) {
      const message = "RATE_LIMIT_DRIVER=redis requires REDIS_URL.";
      if (process.env.NODE_ENV === "production") {
        throw new Error(message);
      }
      console.warn(`[rate-limit] ${message} Falling back to in-memory adapter in non-production.`);
      singleton = new InMemoryRateLimitAdapter();
      return singleton;
    }
    singleton = new RedisRateLimitAdapter();
    return singleton;
  }

  singleton = new InMemoryRateLimitAdapter();
  return singleton;
};

export const resetRateLimitAdapterForTests = () => {
  singleton = null;
};
