type PayloadWithUsers = {
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

type AiTokenEventOptions = {
  reason?: AiTokenEventReason;
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

const normalizeMeta = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const recordAiTokenEvent = async (
  payload: PayloadWithUsers,
  userId: string | number,
  input: {
    reason: AiTokenEventReason;
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
        user: userId as any,
        reason: input.reason,
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
    delta: refundAmount,
    balanceAfter: next,
    source: options?.source || "ai_generate",
    referenceId: options?.referenceId,
    idempotencyKey: options?.idempotencyKey,
    meta: options?.meta,
  });

  return next;
};
