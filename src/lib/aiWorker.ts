const DEFAULT_MOCK_MODEL_URL =
  "https://modelviewer.dev/shared-assets/models/Astronaut.glb";

type PayloadLike = {
  find: (args: Record<string, unknown>) => Promise<{ docs?: any[] }>;
  update: (args: Record<string, unknown>) => Promise<any>;
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

const ACTIVE_JOB_STATUSES = ["queued", "processing"] as const;

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

const getTimelineProgress = (elapsedMs: number) => {
  if (elapsedMs >= 6200) return { status: "completed" as const, progress: 100 };
  if (elapsedMs >= 5200) return { status: "processing" as const, progress: 94 };
  if (elapsedMs >= 4300) return { status: "processing" as const, progress: 82 };
  if (elapsedMs >= 3200) return { status: "processing" as const, progress: 65 };
  if (elapsedMs >= 2200) return { status: "processing" as const, progress: 45 };
  if (elapsedMs >= 1200) return { status: "processing" as const, progress: 25 };
  return { status: "queued" as const, progress: 8 };
};

const buildNextJobPatch = (job: any, nowIso: string) => {
  const provider = toNonEmptyString(job?.provider).toLowerCase() || "mock";
  const status = toNonEmptyString(job?.status).toLowerCase() || "queued";
  if (status === "completed" || status === "failed") return null;
  if (provider !== "mock") return null;

  const nowMs = Date.now();
  const createdAtMs = parseDateToMs(job?.createdAt, nowMs);
  const elapsedMs = Math.max(0, nowMs - createdAtMs);
  const timeline = getTimelineProgress(elapsedMs);

  const currentProgress = clamp(job?.progress, 0, 100);
  const nextProgress = timeline.status === "completed"
    ? 100
    : Math.max(currentProgress, timeline.progress);
  const currentStatus = status === "processing" ? "processing" : "queued";
  const nextStatus =
    timeline.status === "completed"
      ? "completed"
      : currentStatus === "processing"
        ? "processing"
        : timeline.status;

  const patch: Record<string, unknown> = {};
  if (nextStatus !== status) patch.status = nextStatus;
  if (nextProgress !== currentProgress) patch.progress = nextProgress;

  if ((nextStatus === "processing" || nextStatus === "completed") && !job?.startedAt) {
    patch.startedAt = nowIso;
  }

  if (nextStatus === "completed") {
    const modelUrl =
      toNonEmptyString(job?.result?.modelUrl) ||
      toNonEmptyString(process.env.AI_GENERATION_MOCK_MODEL_URL) ||
      DEFAULT_MOCK_MODEL_URL;
    const previewUrl =
      toNonEmptyString(job?.result?.previewUrl) || toNonEmptyString(job?.sourceUrl);
    const format =
      toNonEmptyString(job?.result?.format) ||
      inferFormat(modelUrl);
    patch.result = {
      modelUrl,
      previewUrl,
      format,
    };
    if (!job?.completedAt) patch.completedAt = nowIso;
    if (toNonEmptyString(job?.errorMessage)) patch.errorMessage = "";
  }

  return Object.keys(patch).length > 0 ? patch : null;
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
    const patch = buildNextJobPatch(job, nowIso);
    if (!patch) {
      skipped += 1;
      continue;
    }

    const updated = await payload.update({
      collection: "ai_jobs",
      id: job.id,
      data: patch,
      overrideAccess: true,
    });
    advanced += 1;
    if (toNonEmptyString(updated?.status).toLowerCase() === "completed") {
      completed += 1;
    }
    updatedIds.push(String(updated?.id ?? job?.id ?? ""));
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
