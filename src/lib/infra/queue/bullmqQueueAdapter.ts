import { type JobsOptions } from "bullmq";

import type { AIQueueAdapter } from "@/lib/infra/queue/queueAdapter";
import { getAiBullMQQueue } from "@/lib/infra/queue/bullmqQueue";
import {
  AI_GENERATE_JOB_NAME,
  buildAiRetryQueueJobId,
  buildAiStableQueueJobId,
} from "@/lib/infra/queue/jobNames";

const parsePositiveInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
};

const resolveAttempts = () =>
  parsePositiveInt(process.env.AI_BULLMQ_MAX_ATTEMPTS, 3, 1, 20);

const resolveBackoffDelayMs = () =>
  parsePositiveInt(process.env.AI_BULLMQ_BACKOFF_BASE_MS, 3000, 250, 120000);

const resolveDelayMs = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

const buildBaseJobOptions = (delayMs: number): JobsOptions => ({
  attempts: resolveAttempts(),
  backoff: {
    type: "exponential",
    delay: resolveBackoffDelayMs(),
  },
  removeOnComplete: true,
  removeOnFail: 500,
  delay: delayMs,
});

export class BullMQQueueAdapter implements AIQueueAdapter {
  async enqueueJob(jobId: string, opts?: { delayMs?: number }) {
    const normalized = String(jobId || "").trim();
    if (!normalized) return;

    const queue = getAiBullMQQueue();
    const stableJobId = buildAiStableQueueJobId(normalized);
    const existing = await queue.getJob(stableJobId);
    if (existing) {
      return;
    }

    await queue.add(
      AI_GENERATE_JOB_NAME,
      {
        jobId: normalized,
        requestedAt: new Date().toISOString(),
      },
      {
        ...buildBaseJobOptions(resolveDelayMs(opts?.delayMs)),
        jobId: stableJobId,
      }
    );

    console.info("[ai/queue] enqueued", { jobId: normalized, queueJobId: stableJobId });
  }

  async ackJob(jobId: string) {
    const normalized = String(jobId || "").trim();
    if (!normalized) return;
    const queue = getAiBullMQQueue();
    const stableJobId = buildAiStableQueueJobId(normalized);
    const existing = await queue.getJob(stableJobId);
    if (existing) {
      await existing.remove().catch(() => null);
    }
  }

  async failJob(jobId: string, reason: string) {
    const normalized = String(jobId || "").trim();
    if (!normalized) return;
    const queue = getAiBullMQQueue();
    const stableJobId = buildAiStableQueueJobId(normalized);
    const existing = await queue.getJob(stableJobId);
    if (existing) {
      await existing.remove().catch(() => null);
    }
    console.warn("[ai/queue] failed", {
      jobId: normalized,
      reason: String(reason || "unknown"),
    });
  }

  async retryJob(jobId: string, opts?: { delayMs?: number }) {
    const normalized = String(jobId || "").trim();
    if (!normalized) return;
    const queue = getAiBullMQQueue();
    const retryJobId = buildAiRetryQueueJobId(normalized);
    await queue.add(
      AI_GENERATE_JOB_NAME,
      {
        jobId: normalized,
        requestedAt: new Date().toISOString(),
      },
      {
        ...buildBaseJobOptions(resolveDelayMs(opts?.delayMs)),
        jobId: retryJobId,
      }
    );
    console.info("[ai/queue] retry scheduled", {
      jobId: normalized,
      queueJobId: retryJobId,
      delayMs: resolveDelayMs(opts?.delayMs),
    });
  }
}
