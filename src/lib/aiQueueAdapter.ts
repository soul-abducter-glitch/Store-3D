import { BullMQQueueAdapter } from "@/lib/infra/queue/bullmqQueueAdapter";
import { InMemoryQueueAdapter } from "@/lib/infra/queue/inMemoryQueueAdapter";
import type { AIQueueAdapter, AIQueueDriver } from "@/lib/infra/queue/queueAdapter";
import { isRedisConfigured } from "@/lib/infra/redis/redisConfig";

const resolveRawDriver = () =>
  String(process.env.AI_QUEUE_DRIVER || process.env.AI_QUEUE_ADAPTER || "inmemory")
    .trim()
    .toLowerCase();

export const resolveAiQueueDriver = (): AIQueueDriver =>
  resolveRawDriver() === "bullmq" ? "bullmq" : "inmemory";

let singleton: AIQueueAdapter | null = null;

export const getAiQueueAdapter = (): AIQueueAdapter => {
  if (singleton) return singleton;

  const driver = resolveAiQueueDriver();
  if (driver === "bullmq") {
    if (!isRedisConfigured()) {
      const message = "AI_QUEUE_DRIVER=bullmq requires REDIS_URL.";
      if (process.env.NODE_ENV === "production") {
        throw new Error(message);
      }
      console.warn(`[ai/queue] ${message} Falling back to in-memory adapter in non-production.`);
      singleton = new InMemoryQueueAdapter();
      return singleton;
    }
    singleton = new BullMQQueueAdapter();
    return singleton;
  }

  singleton = new InMemoryQueueAdapter();
  return singleton;
};

export const resetAiQueueAdapterForTests = () => {
  singleton = null;
};

export type { AIQueueAdapter };
