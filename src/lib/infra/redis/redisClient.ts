import Redis from "ioredis";

import { resolveRedisConfig } from "@/lib/infra/redis/redisConfig";

let singleton: Redis | null = null;

export const getRedisClient = (): Redis | null => {
  const config = resolveRedisConfig();
  if (!config) return null;
  if (singleton) return singleton;

  singleton = new Redis(config.url, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(config.tls ? { tls: { rejectUnauthorized: false } } : {}),
  });

  singleton.on("error", (error) => {
    console.error("[redis] client error", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return singleton;
};

export const ensureRedisConnection = async () => {
  const client = getRedisClient();
  if (!client) return null;
  if (client.status === "ready" || client.status === "connect") return client;
  await client.connect().catch((error) => {
    throw error;
  });
  return client;
};
