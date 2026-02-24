import {
  normalizeProviderError,
  normalizeProviderStatus,
  pollProviderJob,
} from "@/lib/aiProvider";
import { transitionJob } from "@/lib/aiJobStateMachine";
import { normalizeAiJobStatus } from "@/lib/aiJobStatus";
import { getAiQueueAdapter } from "@/lib/aiQueueAdapter";
import { finalizeAiJobTokens, releaseAiJobTokens } from "@/lib/aiTokenLifecycle";

const DEFAULT_MOCK_MODEL_URL = "https://modelviewer.dev/shared-assets/models/Astronaut.glb";

type PayloadLike = {
  find: (args: Record<string, unknown>) => Promise<{ docs?: any[] }>;
  update: (args: Record<string, unknown>) => Promise<any>;
  findByID: (args: Record<string, unknown>) => Promise<any>;
  create: (args: Record<string, unknown>) => Promise<any>;
};

type WorkerOptions = {
  limit?: number;
  jobId?: string | number | null;
};

export type AiWorkerTickResult = {
  enabled: boolean;
  processed: number;
  advanced: number;
  completed: number;
  skipped: number;
  updatedIds: string[];
};

const ACTIVE_JOB_STATUSES = [
  "queued",
  "running",
  "provider_pending",
  "provider_processing",
  "postprocessing",
  "retrying",
  "processing",
] as const;

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const parseInteger = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
};

const clamp = (value: unknown, min: number, max: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const inferFormat = (modelUrl: string) => {
  const normalized = modelUrl.toLowerCase();
  if (normalized.includes(".gltf")) return "gltf";
  if (normalized.includes(".obj")) return "obj";
  if (normalized.includes(".stl")) return "stl";
  if (normalized.includes(".glb")) return "glb";
  return "unknown";
};

const parseDateToMs = (value: unknown, fallbackMs: number) => {
  if (typeof value !== "string") return fallbackMs;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
};

const resolveMockProgress = (elapsedMs: number) => {
  if (elapsedMs >= 6200) return 100;
  if (elapsedMs >= 5200) return 95;
  if (elapsedMs >= 4300) return 82;
  if (elapsedMs >= 3200) return 65;
  if (elapsedMs >= 2200) return 45;
  if (elapsedMs >= 1200) return 25;
  return 8;
};

const resolveRetryLimit = () => {
  const env = parseInteger(process.env.AI_PROVIDER_MAX_RETRIES, 2);
  return Math.max(0, Math.min(8, env));
};

const toInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
};

const updateJobPatch = async (
  payload: PayloadLike,
  jobId: string | number,
  patch: Record<string, unknown>
) =>
  payload.update({
    collection: "ai_jobs",
    id: jobId,
    overrideAccess: true,
    data: patch,
  });

const finalizeOrReleaseByStatus = async (payload: PayloadLike, job: any, status: string) => {
  if (status === "completed") {
    await finalizeAiJobTokens(payload as any, job);
    await getAiQueueAdapter().ackJob(String(job?.id ?? ""));
    return;
  }
  if (status === "failed" || status === "cancelled") {
    await releaseAiJobTokens(payload as any, job);
    await getAiQueueAdapter().failJob(String(job?.id ?? ""), status);
  }
};

const advanceOneStep = async (
  payload: PayloadLike,
  job: any,
  target: "provider_pending" | "provider_processing" | "completed" | "failed",
  context: {
    progress?: number;
    providerJobId?: string;
    errorCode?: string;
    errorMessage?: string;
    errorDetails?: Record<string, unknown>;
  }
) => {
  const status = normalizeAiJobStatus(job?.status);

  if (target === "failed") {
    if (status === "completed" || status === "failed" || status === "cancelled") return job;
    return transitionJob(payload as any, job.id, "failed", {
      eventType: "worker.failed",
      progress: context.progress,
      errorCode: context.errorCode,
      errorMessage: context.errorMessage,
      errorDetails: context.errorDetails,
    });
  }

  if (status === "queued") {
    return transitionJob(payload as any, job.id, "running", {
      eventType: "worker.running",
      progress: context.progress,
    });
  }
  if (status === "retrying") {
    return transitionJob(payload as any, job.id, "queued", {
      eventType: "worker.retry.queued",
      progress: context.progress,
    });
  }
  if (status === "running") {
    return transitionJob(payload as any, job.id, "provider_pending", {
      eventType: "worker.provider.pending",
      progress: context.progress,
      providerJobId: context.providerJobId,
    });
  }
  if (status === "provider_pending") {
    if (target === "provider_pending") return job;
    return transitionJob(payload as any, job.id, "provider_processing", {
      eventType: "worker.provider.processing",
      progress: context.progress,
      providerJobId: context.providerJobId,
    });
  }
  if (status === "provider_processing") {
    if (target === "provider_processing") return job;
    return transitionJob(payload as any, job.id, "postprocessing", {
      eventType: "worker.postprocessing",
      progress: Math.max(90, context.progress || 90),
    });
  }
  if (status === "postprocessing") {
    if (target !== "completed") return job;
    return transitionJob(payload as any, job.id, "completed", {
      eventType: "worker.completed",
      progress: 100,
    });
  }

  return job;
};

const advanceMockJob = async (payload: PayloadLike, job: any, nowIso: string) => {
  const status = normalizeAiJobStatus(job?.status);
  if (status === "completed" || status === "failed" || status === "cancelled") {
    return { advanced: false, completed: status === "completed" };
  }

  const nowMs = Date.now();
  const createdAtMs = parseDateToMs(job?.createdAt, nowMs);
  const elapsedMs = Math.max(0, nowMs - createdAtMs);
  const timelineProgress = resolveMockProgress(elapsedMs);
  const currentProgress = clamp(job?.progress, 0, 100);
  const nextProgress = Math.max(currentProgress, timelineProgress);

  if (status === "provider_processing" || status === "postprocessing" || status === "running") {
    if (nextProgress > currentProgress) {
      await updateJobPatch(payload, job.id, {
        progress: nextProgress,
      });
    }
  }

  if (elapsedMs >= 6200) {
    const modelUrl =
      toNonEmptyString(job?.result?.modelUrl) ||
      toNonEmptyString(process.env.AI_GENERATION_MOCK_MODEL_URL) ||
      DEFAULT_MOCK_MODEL_URL;
    const previewUrl = toNonEmptyString(job?.result?.previewUrl) || toNonEmptyString(job?.sourceUrl);
    const format = toNonEmptyString(job?.result?.format) || inferFormat(modelUrl);
    await updateJobPatch(payload, job.id, {
      result: {
        modelUrl,
        previewUrl,
        format,
      },
      completedAt: nowIso,
      progress: 100,
      errorMessage: "",
      errorCode: "",
    });
    const updated = await advanceOneStep(payload, job, "completed", { progress: 100 });
    const normalized = normalizeAiJobStatus(updated?.status);
    if (normalized === "completed") {
      await finalizeOrReleaseByStatus(payload, updated, normalized);
      return { advanced: true, completed: true };
    }
    return { advanced: true, completed: false };
  }

  const target = elapsedMs >= 2500 ? "provider_processing" : "provider_pending";
  const updated = await advanceOneStep(payload, job, target, { progress: nextProgress });
  return { advanced: String(updated?.id || "") !== "", completed: false };
};

const advanceExternalJob = async (payload: PayloadLike, job: any, nowIso: string) => {
  const status = normalizeAiJobStatus(job?.status);
  if (status === "completed" || status === "failed" || status === "cancelled") {
    return { advanced: false, completed: status === "completed" };
  }

  const provider = toNonEmptyString(job?.provider).toLowerCase();
  const providerJobId = toNonEmptyString(job?.providerJobId);
  if (!provider || !providerJobId) {
    const failed = await advanceOneStep(payload, job, "failed", {
      errorCode: "PROVIDER_UNKNOWN",
      errorMessage: "Provider job id is missing.",
    });
    await finalizeOrReleaseByStatus(payload, failed, normalizeAiJobStatus(failed?.status));
    return { advanced: true, completed: false };
  }

  const mode = job?.mode === "text" || job?.mode === "text_to_3d" ? "text" : "image";
  const sourceType =
    job?.sourceType === "url" || job?.sourceType === "image" ? job.sourceType : "none";

  let providerState: Awaited<ReturnType<typeof pollProviderJob>> | null = null;
  try {
    providerState = await pollProviderJob({
      provider: provider as any,
      providerJobId,
      mode,
      sourceType,
    });
  } catch (error) {
    const normalized = normalizeProviderError(error);
    const currentRetryCount = toInt(job?.retryCount, 0);
    const retryLimit = resolveRetryLimit();
    if (normalized.retryable && currentRetryCount < retryLimit) {
      const retrying = await transitionJob(payload as any, job.id, "retrying", {
        eventType: "worker.retrying",
        retryCount: currentRetryCount + 1,
        errorCode: normalized.code,
        errorMessage: normalized.providerMessage,
        errorDetails: {
          providerCode: normalized.providerCode,
          httpStatusSuggested: normalized.httpStatusSuggested,
        },
      });
      await getAiQueueAdapter().retryJob(String(job.id), { delayMs: 1000 * (currentRetryCount + 1) });
      return { advanced: Boolean(retrying), completed: false };
    }
    const failed = await advanceOneStep(payload, job, "failed", {
      errorCode: normalized.code,
      errorMessage: normalized.providerMessage,
      errorDetails: {
        providerCode: normalized.providerCode,
        httpStatusSuggested: normalized.httpStatusSuggested,
      },
    });
    await finalizeOrReleaseByStatus(payload, failed, normalizeAiJobStatus(failed?.status));
    return { advanced: true, completed: false };
  }

  const providerStatus = normalizeProviderStatus(providerState?.status);
  const currentProgress = clamp(job?.progress, 0, 100);
  const nextProgress =
    providerStatus === "completed"
      ? 100
      : Math.max(currentProgress, clamp(providerState?.progress, 0, 100));

  if (providerState?.providerJobId && providerState.providerJobId !== providerJobId) {
    await updateJobPatch(payload, job.id, {
      providerJobId: providerState.providerJobId,
    });
  }
  if (nextProgress > currentProgress) {
    await updateJobPatch(payload, job.id, {
      progress: nextProgress,
      startedAt: job?.startedAt || nowIso,
      errorMessage: providerStatus === "failed" ? job?.errorMessage || "" : "",
    });
  }

  if (providerStatus === "failed") {
    const failed = await advanceOneStep(payload, job, "failed", {
      progress: nextProgress,
      errorCode: "PROVIDER_UNKNOWN",
      errorMessage: providerState?.errorMessage || "Provider failed to generate model.",
    });
    await finalizeOrReleaseByStatus(payload, failed, normalizeAiJobStatus(failed?.status));
    return { advanced: true, completed: false };
  }

  if (providerStatus === "completed") {
    const modelUrl =
      toNonEmptyString(providerState?.result?.modelUrl) || toNonEmptyString(job?.result?.modelUrl);
    const previewUrl =
      toNonEmptyString(providerState?.result?.previewUrl) ||
      toNonEmptyString(job?.result?.previewUrl) ||
      toNonEmptyString(job?.sourceUrl);
    const format =
      toNonEmptyString(providerState?.result?.format) ||
      toNonEmptyString(job?.result?.format) ||
      inferFormat(modelUrl || previewUrl);

    if (!modelUrl) {
      const failed = await advanceOneStep(payload, job, "failed", {
        errorCode: "PROVIDER_UNKNOWN",
        errorMessage: "Provider completed job without model URL.",
      });
      await finalizeOrReleaseByStatus(payload, failed, normalizeAiJobStatus(failed?.status));
      return { advanced: true, completed: false };
    }

    await updateJobPatch(payload, job.id, {
      result: {
        modelUrl,
        previewUrl,
        format,
      },
      completedAt: nowIso,
      progress: 100,
      errorMessage: "",
      errorCode: "",
    });

    const updated = await advanceOneStep(payload, job, "completed", {
      progress: 100,
      providerJobId: providerState.providerJobId || providerJobId,
    });
    const normalized = normalizeAiJobStatus(updated?.status);
    if (normalized === "completed") {
      await finalizeOrReleaseByStatus(payload, updated, normalized);
      return { advanced: true, completed: true };
    }
    return { advanced: true, completed: false };
  }

  const target = providerStatus === "processing" ? "provider_processing" : "provider_pending";
  const updated = await advanceOneStep(payload, job, target, {
    progress: nextProgress,
    providerJobId: providerState?.providerJobId || providerJobId,
  });
  return { advanced: Boolean(updated), completed: false };
};

const buildNextJobResult = async (payload: PayloadLike, job: any, nowIso: string) => {
  const provider = toNonEmptyString(job?.provider).toLowerCase() || "mock";
  if (provider === "mock") {
    return advanceMockJob(payload, job, nowIso);
  }
  return advanceExternalJob(payload, job, nowIso);
};

export const runAiWorkerTick = async (
  payload: PayloadLike,
  options: WorkerOptions = {}
): Promise<AiWorkerTickResult> => {
  const enabled = parseBoolean(process.env.AI_WORKER_ENABLED, true);
  if (!enabled) {
    return {
      enabled: false,
      processed: 0,
      advanced: 0,
      completed: 0,
      skipped: 0,
      updatedIds: [],
    };
  }

  const envBatchSize = parseInteger(process.env.AI_WORKER_BATCH_SIZE, 10);
  const safeEnvBatch = Math.max(1, Math.min(100, envBatchSize));
  const requestedLimit = typeof options.limit === "number" ? options.limit : safeEnvBatch;
  const limit = Math.max(1, Math.min(100, Math.trunc(requestedLimit)));

  const where: Record<string, unknown> = {
    status: {
      in: [...ACTIVE_JOB_STATUSES],
    },
  };
  if (options.jobId !== null && options.jobId !== undefined && String(options.jobId).trim()) {
    where.id = {
      equals: options.jobId as any,
    };
  }

  const found = await payload.find({
    collection: "ai_jobs",
    depth: 0,
    limit,
    sort: "createdAt",
    where,
    overrideAccess: true,
  });

  const docs = Array.isArray(found?.docs) ? found.docs : [];
  if (docs.length === 0) {
    return {
      enabled: true,
      processed: 0,
      advanced: 0,
      completed: 0,
      skipped: 0,
      updatedIds: [],
    };
  }

  const nowIso = new Date().toISOString();
  const updatedIds: string[] = [];
  let advanced = 0;
  let completed = 0;
  let skipped = 0;

  for (const job of docs) {
    try {
      const result = await buildNextJobResult(payload, job, nowIso);
      if (!result.advanced) {
        skipped += 1;
        continue;
      }
      advanced += 1;
      if (result.completed) {
        completed += 1;
      }
      updatedIds.push(String(job?.id ?? ""));
    } catch (error) {
      skipped += 1;
      console.error("[ai/worker] failed to advance job", {
        id: String(job?.id ?? ""),
        provider: toNonEmptyString(job?.provider) || "mock",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    enabled: true,
    processed: docs.length,
    advanced,
    completed,
    skipped,
    updatedIds,
  };
};
