import { buildRedisKey } from "@/lib/infra/redis/redisConfig";
import { ensureRedisConnection } from "@/lib/infra/redis/redisClient";
import type {
  RateLimitAdapter,
  RateLimitConsumeInput,
  RateLimitConsumeResult,
} from "@/lib/infra/rate-limit/rateLimitAdapter";

const RATE_LIMIT_EVAL = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])

local current = redis.call("INCR", key)
if current == 1 then
  redis.call("PEXPIRE", key, window_ms)
end

local ttl = redis.call("PTTL", key)
if ttl < 0 then
  ttl = 0
end

local remaining = max - current
if remaining < 0 then
  remaining = 0
end

if current > max then
  return {0, remaining, ttl}
end

return {1, remaining, ttl}
`;

export class RedisRateLimitAdapter implements RateLimitAdapter {
  async consume(input: RateLimitConsumeInput): Promise<RateLimitConsumeResult> {
    const client = await ensureRedisConnection();
    if (!client) {
      throw new Error("Redis is not configured.");
    }

    const max = Math.max(1, Math.trunc(input.max));
    const windowMs = Math.max(1000, Math.trunc(input.windowMs));
    const key = buildRedisKey("ratelimit", input.scope, input.key);
    const result = await client.eval(
      RATE_LIMIT_EVAL,
      1,
      key,
      String(max),
      String(windowMs)
    );

    const tuple = Array.isArray(result) ? result : [0, 0, windowMs];
    const ok = Number(tuple[0]) === 1;
    const remaining = Math.max(0, Number(tuple[1]) || 0);
    const retryAfterMs = Math.max(0, Number(tuple[2]) || 0);

    return {
      ok,
      remaining,
      retryAfterMs,
    };
  }
}
