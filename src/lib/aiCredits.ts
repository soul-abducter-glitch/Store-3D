type PayloadWithUsers = {
  find?: (args: {
    collection: "ai_token_events";
    where?: Record<string, unknown>;
    depth?: number;
    limit?: number;
    sort?: string;
    overrideAccess?: boolean;
  }) => Promise<{ docs?: any[] }>;
  findByID: (args: {
    collection: "users";
    id: string | number;
    depth?: number;
    overrideAccess?: boolean;
  }) => Promise<Record<string, unknown> | null>;
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

export type AiTokenEventReason = "spend" | "refund" | "topup" | "adjust";
export type AiTokenEventType = "reserve" | "finalize" | "release" | "topup" | "adjust";

type AiTokenEventOptions = {
  reason?: AiTokenEventReason;
  type?: AiTokenEventType;
  amount?: number;
  jobId?: string | number;
  source?: string;
  referenceId?: string;
  idempotencyKey?: string;
  meta?: Record<string, unknown>;
};

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizeCredits = (value: unknown, fallback: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeReason = (value: unknown): AiTokenEventReason => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "spend" || raw === "refund" || raw === "topup" || raw === "adjust") return raw;
  return "adjust";
};

const normalizeType = (value: unknown): AiTokenEventType => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "reserve" || raw === "finalize" || raw === "release" || raw === "topup" || raw === "adjust") {
    return raw;
  }
  return "adjust";
};

const normalizeMeta = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export const findAiTokenEventByIdempotencyKey = async (
  payload: PayloadWithUsers,
  idempotencyKey: string
) => {
  const key = toNonEmptyString(idempotencyKey);
  if (!key || typeof payload.find !== "function") return null;
  try {
    const found = await payload.find({
      collection: "ai_token_events",
      depth: 0,
      limit: 1,
      sort: "-createdAt",
      overrideAccess: true,
      where: {
        idempotencyKey: {
          equals: key,
        },
      },
    });
    const first = Array.isArray(found?.docs) ? found.docs[0] : null;
    return first || null;
  } catch {
    return null;
  }
};

const recordAiTokenEvent = async (
  payload: PayloadWithUsers,
  userId: string | number,
  input: {
    reason: AiTokenEventReason;
    type?: AiTokenEventType;
    amount?: number;
    jobId?: string | number;
    delta: number;
    balanceAfter: number;
    source?: string;
    referenceId?: string;
    idempotencyKey?: string;
    meta?: Record<string, unknown>;
  }
) => {
  if (typeof payload.create !== "function") return;
  try {
    await payload.create({
      collection: "ai_token_events",
      overrideAccess: true,
      depth: 0,
      data: {
        job: input.jobId as any,
        user: userId as any,
        reason: input.reason,
        type: normalizeType(input.type || "adjust"),
        amount: Math.max(0, Math.trunc(input.amount ?? Math.abs(input.delta))),
        delta: input.delta,
        balanceAfter: input.balanceAfter,
        source: toNonEmptyString(input.source) || "system",
        referenceId: toNonEmptyString(input.referenceId) || undefined,
        idempotencyKey: toNonEmptyString(input.idempotencyKey) || undefined,
        meta: normalizeMeta(input.meta),
      },
    });
  } catch (error) {
    console.error("[aiCredits] failed to write token event", error);
  }
};

export const appendAiTokenEvent = async (
  payload: PayloadWithUsers,
  userId: string | number,
  input: {
    reason?: AiTokenEventReason;
    type: AiTokenEventType;
    amount: number;
    delta?: number;
    balanceAfter?: number;
    source?: string;
    referenceId?: string;
    idempotencyKey?: string;
    jobId?: string | number;
    meta?: Record<string, unknown>;
  }
) => {
  const existing = await findAiTokenEventByIdempotencyKey(payload, input.idempotencyKey || "");
  if (existing) {
    return {
      applied: false,
      event: existing,
    };
  }
  const safeDelta = Number.isFinite(input.delta as number) ? Math.trunc(input.delta as number) : 0;
  const safeBalanceAfter = Number.isFinite(input.balanceAfter as number)
    ? Math.max(0, Math.trunc(input.balanceAfter as number))
    : 0;
  await recordAiTokenEvent(payload, userId, {
    reason: normalizeReason(input.reason || "adjust"),
    type: normalizeType(input.type),
    amount: Math.max(0, Math.trunc(input.amount)),
    delta: safeDelta,
    balanceAfter: safeBalanceAfter,
    source: input.source,
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey,
    jobId: input.jobId,
    meta: input.meta,
  });
  return {
    applied: true,
    event: null,
  };
};

export const AI_DEFAULT_TOKENS = parsePositiveInt(process.env.AI_TOKENS_DEFAULT, 120);
export const AI_TOKEN_COST = parsePositiveInt(process.env.AI_TOKEN_COST, 10);

export const getUserAiCredits = async (
  payload: PayloadWithUsers,
  userId: string | number
): Promise<number> => {
  const userDoc = await payload.findByID({
    collection: "users",
    id: userId,
    depth: 0,
    overrideAccess: true,
  });

  if (!userDoc) {
    throw new Error("User not found.");
  }

  const current = normalizeCredits((userDoc as { aiCredits?: unknown }).aiCredits, AI_DEFAULT_TOKENS);
  if (typeof (userDoc as { aiCredits?: unknown }).aiCredits === "number") {
    return current;
  }

  await payload.update({
    collection: "users",
    id: userId,
    depth: 0,
    overrideAccess: true,
    data: {
      aiCredits: current,
    },
  });

  return current;
};

export const spendUserAiCredits = async (
  payload: PayloadWithUsers,
  userId: string | number,
  amount: number,
  options?: AiTokenEventOptions
): Promise<{ ok: boolean; remaining: number }> => {
  const existing = await findAiTokenEventByIdempotencyKey(payload, options?.idempotencyKey || "");
  if (existing) {
    const balanceAfter = Number((existing as { balanceAfter?: unknown }).balanceAfter);
    return {
      ok: true,
      remaining: Number.isFinite(balanceAfter) ? Math.max(0, Math.trunc(balanceAfter)) : await getUserAiCredits(payload, userId),
    };
  }
  const spendAmount = Math.max(0, Math.trunc(amount));
  const current = await getUserAiCredits(payload, userId);
  if (spendAmount === 0) {
    return { ok: true, remaining: current };
  }
  if (current < spendAmount) {
    return { ok: false, remaining: current };
  }

  const remaining = Math.max(0, current - spendAmount);
  await payload.update({
    collection: "users",
    id: userId,
    depth: 0,
    overrideAccess: true,
    data: {
      aiCredits: remaining,
    },
  });

  await recordAiTokenEvent(payload, userId, {
    reason: normalizeReason(options?.reason || "spend"),
    type: normalizeType(
      options?.type ||
        (normalizeReason(options?.reason || "spend") === "topup" ? "topup" : "reserve")
    ),
    amount: Math.max(0, Math.trunc(options?.amount ?? spendAmount)),
    jobId: options?.jobId,
    delta: -spendAmount,
    balanceAfter: remaining,
    source: options?.source || "ai_generate",
    referenceId: options?.referenceId,
    idempotencyKey: options?.idempotencyKey,
    meta: options?.meta,
  });

  return { ok: true, remaining };
};

export const refundUserAiCredits = async (
  payload: PayloadWithUsers,
  userId: string | number,
  amount: number,
  options?: AiTokenEventOptions
): Promise<number> => {
  const existing = await findAiTokenEventByIdempotencyKey(payload, options?.idempotencyKey || "");
  if (existing) {
    const balanceAfter = Number((existing as { balanceAfter?: unknown }).balanceAfter);
    if (Number.isFinite(balanceAfter)) {
      return Math.max(0, Math.trunc(balanceAfter));
    }
  }
  const refundAmount = Math.max(0, Math.trunc(amount));
  if (refundAmount === 0) {
    return getUserAiCredits(payload, userId);
  }
  const current = await getUserAiCredits(payload, userId);
  const next = Math.max(0, current + refundAmount);
  await payload.update({
    collection: "users",
    id: userId,
    depth: 0,
    overrideAccess: true,
    data: {
      aiCredits: next,
    },
  });

  await recordAiTokenEvent(payload, userId, {
    reason: normalizeReason(options?.reason || "refund"),
    type: normalizeType(
      options?.type ||
        (normalizeReason(options?.reason || "refund") === "topup" ? "topup" : "release")
    ),
    amount: Math.max(0, Math.trunc(options?.amount ?? refundAmount)),
    jobId: options?.jobId,
    delta: refundAmount,
    balanceAfter: next,
    source: options?.source || "ai_generate",
    referenceId: options?.referenceId,
    idempotencyKey: options?.idempotencyKey,
    meta: options?.meta,
  });

  return next;
};
