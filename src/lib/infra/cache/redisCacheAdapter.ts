import type { CacheAdapter } from "@/lib/infra/cache/cacheAdapter";
import { buildRedisKey } from "@/lib/infra/redis/redisConfig";
import { ensureRedisConnection } from "@/lib/infra/redis/redisClient";

const normalizeKey = (key: string) => String(key || "").trim();
const normalizeTag = (tag: string) => String(tag || "").trim();

const toTagIndexKey = (tag: string) => buildRedisKey("cache", "tag", tag);
const toEntryKey = (key: string) => buildRedisKey("cache", "entry", key);

export class RedisCacheAdapter implements CacheAdapter {
  async get<T>(key: string): Promise<T | null> {
    const normalized = normalizeKey(key);
    if (!normalized) return null;
    const client = await ensureRedisConnection();
    if (!client) {
      throw new Error("Redis is not configured.");
    }
    const payload = await client.get(toEntryKey(normalized));
    if (!payload) return null;
    try {
      return JSON.parse(payload) as T;
    } catch {
      await client.del(toEntryKey(normalized));
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number, opts?: { tags?: string[] }) {
    const normalized = normalizeKey(key);
    if (!normalized) return;
    const ttl = Math.max(1, Math.trunc(ttlSeconds));
    const client = await ensureRedisConnection();
    if (!client) {
      throw new Error("Redis is not configured.");
    }
    const redisKey = toEntryKey(normalized);
    const payload = JSON.stringify(value);
    const tags = Array.from(
      new Set((opts?.tags || []).map((tag) => normalizeTag(tag)).filter(Boolean))
    );

    const pipeline = client.multi();
    pipeline.set(redisKey, payload, "EX", ttl);
    for (const tag of tags) {
      const indexKey = toTagIndexKey(tag);
      pipeline.sadd(indexKey, normalized);
      pipeline.expire(indexKey, Math.max(ttl + 60, 120));
    }
    await pipeline.exec();
  }

  async del(key: string) {
    const normalized = normalizeKey(key);
    if (!normalized) return;
    const client = await ensureRedisConnection();
    if (!client) {
      throw new Error("Redis is not configured.");
    }
    await client.del(toEntryKey(normalized));
  }

  async delByTag(tag: string) {
    const normalized = normalizeTag(tag);
    if (!normalized) return;
    const client = await ensureRedisConnection();
    if (!client) {
      throw new Error("Redis is not configured.");
    }
    const indexKey = toTagIndexKey(normalized);
    const keys = await client.smembers(indexKey);
    if (keys.length > 0) {
      const entryKeys = keys.map((key) => toEntryKey(key));
      await client.del(...entryKeys);
    }
    await client.del(indexKey);
  }
}
