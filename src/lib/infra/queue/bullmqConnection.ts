import type { ConnectionOptions } from "bullmq";

import { resolveRedisConfig } from "@/lib/infra/redis/redisConfig";

const toNonEmptyString = (value: string | undefined) => (value ? value.trim() : "");

export const resolveBullMQPrefix = () => {
  const config = resolveRedisConfig();
  return config?.prefix || "store3d";
};

export const resolveBullMQConnection = (): ConnectionOptions => {
  const config = resolveRedisConfig();
  if (!config?.url) {
    throw new Error("BullMQ requires REDIS_URL.");
  }

  const parsed = new URL(config.url);
  const dbRaw = parsed.pathname.replace(/^\//, "");
  const db = Number.parseInt(dbRaw || "0", 10);
  const port = Number.parseInt(parsed.port || "6379", 10);
  const tlsEnabled = config.tls || parsed.protocol === "rediss:";

  return {
    host: parsed.hostname,
    port: Number.isFinite(port) ? port : 6379,
    db: Number.isFinite(db) ? db : 0,
    username: toNonEmptyString(parsed.username) || undefined,
    password: toNonEmptyString(parsed.password) || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(tlsEnabled ? { tls: { rejectUnauthorized: false } } : {}),
  };
};
