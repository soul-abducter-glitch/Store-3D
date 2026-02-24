import { createAiJobEvent } from "@/lib/aiJobEvents";
import { normalizeAiJobStatus, type AIJobStatus } from "@/lib/aiJobStatus";

type PayloadLike = {
  findByID: (args: {
    collection: "ai_jobs";
    id: string | number;
    depth?: number;
    overrideAccess?: boolean;
  }) => Promise<any>;
  update: (args: {
    collection: "ai_jobs";
    id: string | number;
    depth?: number;
    overrideAccess?: boolean;
    data: Record<string, unknown>;
  }) => Promise<any>;
  create: (args: {
    collection: "ai_job_events";
    overrideAccess?: boolean;
    depth?: number;
    data: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
};

export type TransitionContext = {
  eventType?: string;
  actor?: string;
  progress?: number | null;
  etaSeconds?: number | null;
  providerJobId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorDetails?: Record<string, unknown> | null;
  retryCount?: number | null;
  requestId?: string | null;
  traceId?: string | null;
  payload?: Record<string, unknown> | null;
};

const TRANSITION_MAP: Record<AIJobStatus, AIJobStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["provider_pending", "provider_processing", "failed", "retrying"],
  provider_pending: ["provider_processing", "failed", "retrying", "cancelled"],
  provider_processing: ["postprocessing", "failed", "retrying", "cancelled"],
  postprocessing: ["completed", "failed", "retrying"],
  retrying: ["queued", "running", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

const clampProgress = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
};

const toStringSafe = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizePayload = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const resolveTransitionPatch = (
  from: AIJobStatus,
  to: AIJobStatus,
  context: TransitionContext,
  nowIso: string
) => {
  const patch: Record<string, unknown> = {
    status: to,
  };
  const progress = clampProgress(context.progress);
  if (progress !== null) patch.progress = progress;
  if (typeof context.etaSeconds === "number" && Number.isFinite(context.etaSeconds)) {
    patch.etaSeconds = Math.max(0, Math.trunc(context.etaSeconds));
  }
  const providerJobId = toStringSafe(context.providerJobId);
  if (providerJobId) patch.providerJobId = providerJobId;

  const errorCode = toStringSafe(context.errorCode);
  const errorMessage = toStringSafe(context.errorMessage);
  if (errorCode) patch.errorCode = errorCode;
  if (errorMessage) patch.errorMessage = errorMessage;
  if (context.errorDetails && typeof context.errorDetails === "object") {
    patch.errorDetails = context.errorDetails;
  }

  if (typeof context.retryCount === "number" && Number.isFinite(context.retryCount)) {
    patch.retryCount = Math.max(0, Math.trunc(context.retryCount));
  }

  if ((to === "running" || to === "provider_processing") && from === "queued") {
    patch.startedAt = nowIso;
  }
  if (to === "completed") {
    patch.completedAt = nowIso;
    patch.progress = 100;
  }
  if (to === "failed") {
    patch.failedAt = nowIso;
  }
  if (to === "cancelled") {
    patch.failedAt = nowIso;
    if (!errorMessage) {
      patch.errorMessage = "Canceled by user.";
    }
  }

  return patch;
};

export const canTransition = (from: AIJobStatus, to: AIJobStatus) =>
  TRANSITION_MAP[from].includes(to);

export const transitionJob = async (
  payload: PayloadLike,
  jobId: string | number,
  to: AIJobStatus,
  context: TransitionContext = {}
) => {
  const job = await payload.findByID({
    collection: "ai_jobs",
    id: jobId,
    depth: 0,
    overrideAccess: true,
  });
  if (!job) {
    throw new Error("AI job not found.");
  }

  const from = normalizeAiJobStatus(job?.status);
  const toStatus = normalizeAiJobStatus(to);
  const rawCurrentStatus = toStringSafe(job?.status);
  if (from === toStatus && rawCurrentStatus === toStatus) {
    return job;
  }
  if (from === toStatus && rawCurrentStatus !== toStatus) {
    return payload.update({
      collection: "ai_jobs",
      id: jobId,
      depth: 0,
      overrideAccess: true,
      data: {
        status: toStatus,
      },
    });
  }
  if (!canTransition(from, toStatus)) {
    throw new Error(`Invalid AI job transition: ${from} -> ${toStatus}`);
  }

  const nowIso = new Date().toISOString();
  const patch = resolveTransitionPatch(from, toStatus, context, nowIso);
  const updated = await payload.update({
    collection: "ai_jobs",
    id: jobId,
    depth: 0,
    overrideAccess: true,
    data: patch,
  });

  const userId = updated?.user?.id ?? updated?.user ?? job?.user?.id ?? job?.user ?? null;
  if (userId !== null && userId !== undefined) {
    await createAiJobEvent(payload, {
      jobId,
      userId,
      eventType: toStringSafe(context.eventType) || "job.transition",
      statusBefore: from,
      statusAfter: toStatus,
      provider: toStringSafe(updated?.provider || job?.provider) || null,
      requestId: toStringSafe(context.requestId) || null,
      traceId: toStringSafe(context.traceId) || null,
      payload: {
        actor: toStringSafe(context.actor) || "system",
        ...normalizePayload(context.payload),
      },
    });
  }

  return updated;
};
