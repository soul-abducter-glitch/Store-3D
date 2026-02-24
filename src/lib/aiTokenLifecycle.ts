import {
  appendAiTokenEvent,
  findAiTokenEventByIdempotencyKey,
  refundUserAiCredits,
  spendUserAiCredits,
  type AiTokenEventReason,
  type AiTokenEventType,
} from "@/lib/aiCredits";

type PayloadLike = {
  findByID: (args: {
    collection: "users";
    id: string | number;
    depth?: number;
    overrideAccess?: boolean;
  }) => Promise<Record<string, unknown> | null>;
  find?: (args: {
    collection: "ai_token_events";
    where?: Record<string, unknown>;
    depth?: number;
    limit?: number;
    sort?: string;
    overrideAccess?: boolean;
  }) => Promise<{ docs?: any[] }>;
  update: (args: {
    collection: "users";
    id: string | number;
    data: Record<string, unknown>;
    overrideAccess?: boolean;
    depth?: number;
  }) => Promise<Record<string, unknown>>;
  create?: (args: {
    collection: "ai_token_events";
    data: Record<string, unknown>;
    overrideAccess?: boolean;
    depth?: number;
  }) => Promise<Record<string, unknown>>;
};

type AiJobLike = {
  id?: string | number;
  user?: unknown;
  reservedTokens?: unknown;
};

const toInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
};

const normalizeRelationshipId = (value: unknown): string | number | null => {
  let current: unknown = value;
  while (typeof current === "object" && current !== null) {
    current =
      (current as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (current as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (current as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
  }
  if (current === null || current === undefined) return null;
  if (typeof current === "number") return current;
  const raw = String(current).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
};

const jobEventKey = (jobId: string | number, type: AiTokenEventType) => `job:${jobId}:${type}`;

const extractJobId = (job: AiJobLike) => {
  if (job.id === null || job.id === undefined) return "";
  return String(job.id).trim();
};

const extractUserId = (job: AiJobLike) => normalizeRelationshipId(job.user);

const hasEvent = async (payload: PayloadLike, idempotencyKey: string) =>
  Boolean(await findAiTokenEventByIdempotencyKey(payload as any, idempotencyKey));

type RecordTokenEventInput = {
  payload: PayloadLike;
  userId: string | number;
  jobId: string | number;
  type: AiTokenEventType;
  reason: AiTokenEventReason;
  amount: number;
  delta: number;
  balanceAfter: number;
  source: string;
  meta?: Record<string, unknown>;
};

const recordTokenEvent = async (input: RecordTokenEventInput) =>
  appendAiTokenEvent(input.payload as any, input.userId, {
    reason: input.reason,
    type: input.type,
    amount: input.amount,
    delta: input.delta,
    balanceAfter: input.balanceAfter,
    source: input.source,
    idempotencyKey: jobEventKey(input.jobId, input.type),
    referenceId: String(input.jobId),
    jobId: input.jobId,
    meta: input.meta,
  });

export const reserveAiJobTokens = async (
  payload: PayloadLike,
  job: AiJobLike,
  amountInput?: number
) => {
  const jobId = extractJobId(job);
  const userId = extractUserId(job);
  if (!jobId || userId === null) {
    throw new Error("Cannot reserve tokens: invalid job context.");
  }
  const amount = Math.max(0, Math.trunc(amountInput ?? toInt(job.reservedTokens, 0)));
  if (amount <= 0) {
    return { ok: true as const, applied: false as const, remaining: null };
  }
  const idempotencyKey = jobEventKey(jobId, "reserve");
  const alreadyReserved = await hasEvent(payload, idempotencyKey);
  if (alreadyReserved) {
    return { ok: true as const, applied: false as const, remaining: null };
  }
  const spent = await spendUserAiCredits(payload as any, userId, amount, {
    reason: "spend",
    type: "reserve",
    amount,
    jobId: jobId as any,
    source: "ai_job:reserve",
    idempotencyKey,
    referenceId: jobId,
    meta: {
      jobId,
    },
  });
  return { ok: spent.ok, applied: spent.ok, remaining: spent.remaining };
};

export const finalizeAiJobTokens = async (payload: PayloadLike, job: AiJobLike) => {
  const jobId = extractJobId(job);
  const userId = extractUserId(job);
  if (!jobId || userId === null) {
    throw new Error("Cannot finalize tokens: invalid job context.");
  }
  const amount = Math.max(0, Math.trunc(toInt(job.reservedTokens, 0)));
  if (amount <= 0) {
    return { applied: false as const, reason: "no_reserved_tokens" as const };
  }

  const finalizeKey = jobEventKey(jobId, "finalize");
  if (await hasEvent(payload, finalizeKey)) {
    return { applied: false as const, reason: "already_finalized" as const };
  }
  if (await hasEvent(payload, jobEventKey(jobId, "release"))) {
    return { applied: false as const, reason: "already_released" as const };
  }

  const userDoc = await payload.findByID({
    collection: "users",
    id: userId as any,
    depth: 0,
    overrideAccess: true,
  });
  const balanceAfter = toInt((userDoc as { aiCredits?: unknown } | null)?.aiCredits, 0);
  await recordTokenEvent({
    payload,
    userId,
    jobId,
    type: "finalize",
    reason: "adjust",
    amount,
    delta: 0,
    balanceAfter,
    source: "ai_job:finalize",
    meta: {
      jobId,
    },
  });
  return { applied: true as const, reason: "finalized" as const };
};

export const releaseAiJobTokens = async (payload: PayloadLike, job: AiJobLike) => {
  const jobId = extractJobId(job);
  const userId = extractUserId(job);
  if (!jobId || userId === null) {
    throw new Error("Cannot release tokens: invalid job context.");
  }
  const amount = Math.max(0, Math.trunc(toInt(job.reservedTokens, 0)));
  if (amount <= 0) {
    return { applied: false as const, reason: "no_reserved_tokens" as const, remaining: null };
  }

  const releaseKey = jobEventKey(jobId, "release");
  if (await hasEvent(payload, releaseKey)) {
    return { applied: false as const, reason: "already_released" as const, remaining: null };
  }
  if (await hasEvent(payload, jobEventKey(jobId, "finalize"))) {
    return { applied: false as const, reason: "already_finalized" as const, remaining: null };
  }

  const remaining = await refundUserAiCredits(payload as any, userId, amount, {
    reason: "refund",
    type: "release",
    amount,
    jobId: jobId as any,
    source: "ai_job:release",
    idempotencyKey: releaseKey,
    referenceId: jobId,
    meta: {
      jobId,
    },
  });
  return { applied: true as const, reason: "released" as const, remaining };
};
