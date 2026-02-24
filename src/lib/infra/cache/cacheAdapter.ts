export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number, opts?: { tags?: string[] }): Promise<void>;
  del(key: string): Promise<void>;
  delByTag(tag: string): Promise<void>;
}

export const withCache = async <T>(
  adapter: CacheAdapter,
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  opts?: { tags?: string[] }
): Promise<{ value: T; hit: boolean }> => {
  const cached = await adapter.get<T>(key);
  if (cached !== null) {
    return { value: cached, hit: true };
  }

  const value = await loader();
  await adapter.set(key, value, ttlSeconds, opts);
  return { value, hit: false };
};
