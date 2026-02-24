import type { CacheAdapter } from "@/lib/infra/cache/cacheAdapter";

type CacheEntry = {
  payload: string;
  expiresAt: number;
  tags: string[];
};

export class InProcessCacheAdapter implements CacheAdapter {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly tagIndex = new Map<string, Set<string>>();

  private cleanup(now: number) {
    if (this.entries.size < 5000) return;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.removeKey(key);
      }
    }
  }

  private removeKey(key: string) {
    const existing = this.entries.get(key);
    if (!existing) return;
    this.entries.delete(key);
    for (const tag of existing.tags) {
      const set = this.tagIndex.get(tag);
      if (!set) continue;
      set.delete(key);
      if (set.size === 0) {
        this.tagIndex.delete(tag);
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const normalized = String(key || "").trim();
    if (!normalized) return null;
    const now = Date.now();
    this.cleanup(now);
    const found = this.entries.get(normalized);
    if (!found) return null;
    if (found.expiresAt <= now) {
      this.removeKey(normalized);
      return null;
    }
    try {
      return JSON.parse(found.payload) as T;
    } catch {
      this.removeKey(normalized);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number, opts?: { tags?: string[] }) {
    const normalized = String(key || "").trim();
    if (!normalized) return;
    const ttlMs = Math.max(1000, Math.trunc(ttlSeconds * 1000));
    const tags = Array.from(
      new Set(
        (opts?.tags || [])
          .map((tag) => String(tag || "").trim())
          .filter(Boolean)
      )
    );

    this.removeKey(normalized);
    this.entries.set(normalized, {
      payload: JSON.stringify(value),
      expiresAt: Date.now() + ttlMs,
      tags,
    });
    for (const tag of tags) {
      const set = this.tagIndex.get(tag) || new Set<string>();
      set.add(normalized);
      this.tagIndex.set(tag, set);
    }
  }

  async del(key: string) {
    const normalized = String(key || "").trim();
    if (!normalized) return;
    this.removeKey(normalized);
  }

  async delByTag(tag: string) {
    const normalized = String(tag || "").trim();
    if (!normalized) return;
    const set = this.tagIndex.get(normalized);
    if (!set || set.size === 0) return;
    for (const key of Array.from(set.values())) {
      this.removeKey(key);
    }
    this.tagIndex.delete(normalized);
  }
}
