import type { CacheAdapter } from "@/lib/infra/cache/cacheAdapter";
import { InProcessCacheAdapter } from "@/lib/infra/cache/inProcessCacheAdapter";
import { RedisCacheAdapter } from "@/lib/infra/cache/redisCacheAdapter";
import { isRedisConfigured } from "@/lib/infra/redis/redisConfig";

export type CacheDriver = "memory" | "redis";

const resolveRawCacheDriver = () =>
  String(process.env.CACHE_DRIVER || "memory").trim().toLowerCase();

export const resolveCacheDriver = (): CacheDriver =>
  resolveRawCacheDriver() === "redis" ? "redis" : "memory";

let singleton: CacheAdapter | null = null;

export const getCacheAdapter = (): CacheAdapter => {
  if (singleton) return singleton;
  const driver = resolveCacheDriver();
  if (driver === "redis") {
    if (!isRedisConfigured()) {
      const message = "CACHE_DRIVER=redis requires REDIS_URL.";
      if (process.env.NODE_ENV === "production") {
        throw new Error(message);
      }
      console.warn(`[cache] ${message} Falling back to in-process adapter in non-production.`);
      singleton = new InProcessCacheAdapter();
      return singleton;
    }
    singleton = new RedisCacheAdapter();
    return singleton;
  }
  singleton = new InProcessCacheAdapter();
  return singleton;
};

export const resetCacheAdapterForTests = () => {
  singleton = null;
};
