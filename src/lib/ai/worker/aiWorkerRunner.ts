import { QueueEvents, Worker, type Job } from "bullmq";
import { getPayload } from "payload";

import payloadConfig from "../../../../payload.config";
import { getAiQueueAdapter, resolveAiQueueDriver } from "@/lib/aiQueueAdapter";
import { normalizeAiJobStatus } from "@/lib/aiJobStatus";
import { runAiWorkerTick } from "@/lib/aiWorker";
import {
  resolveBullMQConnection,
  resolveBullMQPrefix,
} from "@/lib/infra/queue/bullmqConnection";
import {
  AI_GENERATE_JOB_NAME,
  AI_GENERATE_QUEUE_NAME,
  type AIGenerateQueueJob,
} from "@/lib/infra/queue/jobNames";

type PayloadLike = {
  findByID: (args: {
    collection: "ai_jobs";
    id: string | number;
    depth?: number;
    overrideAccess?: boolean;
  }) => Promise<any>;
};

const ACTIVE_STATUSES = new Set([
  "queued",
  "running",
  "provider_pending",
  "provider_processing",
  "postprocessing",
  "retrying",
  "processing",
]);

const toNonEmptyString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const parsePositiveInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
};

const resolveConcurrency = () =>
  parsePositiveInt(process.env.AI_BULLMQ_WORKER_CONCURRENCY, 4, 1, 64);

const resolveBasePollDelayMs = () =>
  parsePositiveInt(process.env.AI_BULLMQ_POLL_DELAY_MS, 2500, 250, 120000);

const resolveSlowPollDelayMs = () =>
  parsePositiveInt(process.env.AI_BULLMQ_POLL_DELAY_SLOW_MS, 5000, 500, 180000);

const resolveProgress = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

const resolveNextDelayMs = (status: string, progress: number) => {
  if (status === "provider_pending") {
    return resolveBasePollDelayMs();
  }
  if (status === "provider_processing" || status === "postprocessing") {
    if (progress >= 90) {
      return resolveSlowPollDelayMs();
    }
    return resolveBasePollDelayMs();
  }
  return resolveSlowPollDelayMs();
};

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const processGenerateJob = async (
  payload: PayloadLike,
  queueJob: Job<AIGenerateQueueJob>
) => {
  const jobId = toNonEmptyString(queueJob?.data?.jobId);
  if (!jobId) {
    throw new Error("Queue payload is missing jobId.");
  }

  const tickResult = await runAiWorkerTick(payload as any, {
    jobId,
    limit: 1,
    force: true,
  });
  const actualJob = await payload.findByID({
    collection: "ai_jobs",
    id: jobId,
    depth: 0,
    overrideAccess: true,
  });
  if (!actualJob) {
    await getAiQueueAdapter().ackJob(jobId);
    return { jobId, status: "deleted", requeued: false, processed: tickResult.processed };
  }

  const status = normalizeAiJobStatus(actualJob?.status);
  if (status === "completed") {
    await getAiQueueAdapter().ackJob(jobId);
    return { jobId, status, requeued: false, processed: tickResult.processed };
  }
  if (status === "failed" || status === "cancelled") {
    await getAiQueueAdapter().failJob(jobId, status);
    return { jobId, status, requeued: false, processed: tickResult.processed };
  }

  if (ACTIVE_STATUSES.has(status)) {
    if (status !== "retrying") {
      const delayMs = resolveNextDelayMs(status, resolveProgress(actualJob?.progress));
      await getAiQueueAdapter().retryJob(jobId, { delayMs });
      return { jobId, status, requeued: true, delayMs, processed: tickResult.processed };
    }
    return { jobId, status, requeued: false, processed: tickResult.processed };
  }

  return { jobId, status, requeued: false, processed: tickResult.processed };
};

export type AiWorkerRunner = {
  stop: () => Promise<void>;
};

export const startAiWorkerRunner = async (): Promise<AiWorkerRunner> => {
  if (resolveAiQueueDriver() !== "bullmq") {
    throw new Error("AI_QUEUE_DRIVER must be set to bullmq for worker runner.");
  }

  const payload = await getPayloadClient();
  const worker = new Worker<AIGenerateQueueJob>(
    AI_GENERATE_QUEUE_NAME,
    async (queueJob) => {
      if (queueJob.name !== AI_GENERATE_JOB_NAME) {
        return { ignored: true, name: queueJob.name };
      }
      const processed = await processGenerateJob(payload as any, queueJob);
      return processed;
    },
    {
      connection: resolveBullMQConnection(),
      prefix: resolveBullMQPrefix(),
      concurrency: resolveConcurrency(),
    }
  );

  const events = new QueueEvents(AI_GENERATE_QUEUE_NAME, {
    connection: resolveBullMQConnection(),
    prefix: resolveBullMQPrefix(),
  });

  worker.on("active", (job) => {
    console.info("[ai/worker] queue.start", { queueJobId: job?.id, jobId: job?.data?.jobId });
  });
  worker.on("completed", (job, result) => {
    console.info("[ai/worker] queue.complete", {
      queueJobId: job?.id,
      jobId: job?.data?.jobId,
      result,
    });
  });
  worker.on("failed", (job, error) => {
    console.error("[ai/worker] queue.fail", {
      queueJobId: job?.id,
      jobId: job?.data?.jobId,
      error: error?.message || String(error),
    });
  });
  worker.on("error", (error) => {
    console.error("[ai/worker] worker.error", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);
  console.info("[ai/worker] runner.ready", {
    queue: AI_GENERATE_QUEUE_NAME,
    concurrency: resolveConcurrency(),
  });

  return {
    stop: async () => {
      await Promise.all([worker.close(), events.close()]);
    },
  };
};
