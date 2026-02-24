type JobLike = {
  id?: string | number;
  status?: unknown;
  progress?: unknown;
  createdAt?: unknown;
};

type PayloadLike = {
  find: (args: Record<string, unknown>) => Promise<{ docs?: any[] }>;
};

export type AiQueueSnapshot = {
  queueDepth: number;
  activeCount: number;
  byJobId: Record<
    string,
    {
      queuePosition: number | null;
      etaSeconds: number | null;
      etaStartAt: string | null;
      etaCompleteAt: string | null;
    }
  >;
};

const parseInteger = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const clampProgress = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

const normalizeStatus = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "queued") return "queued";
  if (raw === "running" || raw === "provider_pending" || raw === "provider_processing" || raw === "postprocessing" || raw === "retrying" || raw === "processing") return "processing";
  if (raw === "completed") return "completed";
  if (raw === "failed" || raw === "cancelled") return "failed";
  return "queued";
};

const normalizeId = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  return "";
};

const getNowIso = () => new Date().toISOString();

const toIsoAfterSeconds = (seconds: number) => {
  const now = Date.now();
  return new Date(now + Math.max(0, Math.trunc(seconds)) * 1000).toISOString();
};

const resolveAvgJobSeconds = () =>
  parseInteger(process.env.AI_QUEUE_AVG_SECONDS, 140, 30, 3600);

const resolveQueueSlotSeconds = () =>
  parseInteger(process.env.AI_QUEUE_SLOT_SECONDS, 90, 15, 1800);

const resolveMinProcessingEtaSeconds = () =>
  parseInteger(process.env.AI_QUEUE_MIN_PROCESSING_ETA_SECONDS, 12, 5, 600);

export const buildAiQueueSnapshot = async (payload: PayloadLike): Promise<AiQueueSnapshot> => {
  const avgJobSeconds = resolveAvgJobSeconds();
  const queueSlotSeconds = resolveQueueSlotSeconds();
  const minProcessingEtaSeconds = resolveMinProcessingEtaSeconds();

  const found = await payload.find({
    collection: "ai_jobs",
    depth: 0,
    limit: 1000,
    sort: "createdAt",
    where: {
      status: {
        in: ["queued", "running", "provider_pending", "provider_processing", "postprocessing", "retrying", "processing"],
      },
    },
    overrideAccess: true,
  });

  const docs = Array.isArray(found?.docs) ? found.docs : [];
  const processing = docs.filter((job) => normalizeStatus(job?.status) === "processing");
  const queued = docs.filter((job) => normalizeStatus(job?.status) === "queued");

  let processingBacklogSeconds = 0;
  for (const job of processing) {
    const progress = clampProgress(job?.progress);
    const remaining = Math.max(
      minProcessingEtaSeconds,
      Math.round(((100 - progress) / 100) * avgJobSeconds)
    );
    processingBacklogSeconds += remaining;
  }

  const byJobId: AiQueueSnapshot["byJobId"] = {};

  for (const job of processing) {
    const id = normalizeId(job?.id);
    if (!id) continue;
    const progress = clampProgress(job?.progress);
    const etaSeconds = Math.max(
      minProcessingEtaSeconds,
      Math.round(((100 - progress) / 100) * avgJobSeconds)
    );
    byJobId[id] = {
      queuePosition: null,
      etaSeconds,
      etaStartAt: getNowIso(),
      etaCompleteAt: toIsoAfterSeconds(etaSeconds),
    };
  }

  for (let index = 0; index < queued.length; index += 1) {
    const job = queued[index];
    const id = normalizeId(job?.id);
    if (!id) continue;
    const queuePosition = index + 1;
    const etaStartSeconds = processingBacklogSeconds + index * queueSlotSeconds;
    const etaCompleteSeconds = etaStartSeconds + avgJobSeconds;
    byJobId[id] = {
      queuePosition,
      etaSeconds: etaCompleteSeconds,
      etaStartAt: toIsoAfterSeconds(etaStartSeconds),
      etaCompleteAt: toIsoAfterSeconds(etaCompleteSeconds),
    };
  }

  return {
    queueDepth: queued.length,
    activeCount: docs.length,
    byJobId,
  };
};

export const withAiQueueMeta = <T extends JobLike>(
  jobs: T[],
  snapshot: AiQueueSnapshot
) =>
  jobs.map((job) => {
    const id = normalizeId(job?.id);
    const queue = id ? snapshot.byJobId[id] : null;
    return {
      ...job,
      queuePosition: queue?.queuePosition ?? null,
      etaSeconds: queue?.etaSeconds ?? null,
      etaStartAt: queue?.etaStartAt ?? null,
      etaCompleteAt: queue?.etaCompleteAt ?? null,
      queueDepth: snapshot.queueDepth,
      activeQueueJobs: snapshot.activeCount,
    };
  });
