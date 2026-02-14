import {
  getAiPlanByCode,
  isAiSubscriptionActive,
  normalizeAiPlanCode,
  normalizeAiSubscriptionStatus,
  resolveAiPlans,
  type AiPlanCode,
  type AiSubscriptionStatus,
} from "./aiSubscriptionConfig";

type PayloadLike = {
  find: (args: {
    collection: "ai_subscriptions" | "processed_webhooks";
    where?: Record<string, unknown>;
    sort?: string;
    limit?: number;
    depth?: number;
    overrideAccess?: boolean;
  }) => Promise<{ docs?: any[] } | null>;
  create: (args: {
    collection: "ai_subscriptions" | "processed_webhooks";
    data: Record<string, unknown>;
    depth?: number;
    overrideAccess?: boolean;
  }) => Promise<any>;
  update: (args: {
    collection: "ai_subscriptions" | "processed_webhooks";
    id: string | number;
    data: Record<string, unknown>;
    depth?: number;
    overrideAccess?: boolean;
  }) => Promise<any>;
};

export type AiGenerationModeTier = "standard" | "pro";

export type AiSubscriptionSummary = {
  id: string;
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  planCode: AiPlanCode | null;
  status: AiSubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  monthlyTokens: number;
  monthlyAmountCents: number;
  planLabel: string;
  proAccess: boolean;
  isActive: boolean;
  nextBillingAt: string | null;
  updatedAt: string | null;
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

export const normalizeRelationshipId = (value: unknown): string | number | null => {
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

const toIsoDateOrNull = (value: unknown): string | null => {
  const raw = toNonEmptyString(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
};

export const toIsoFromUnixSeconds = (value: unknown): string | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(Math.trunc(parsed) * 1000).toISOString();
};

const toBool = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return false;
};

const buildSubscriptionWhereByUser = (userId: string | number) => ({
  user: {
    equals: userId as any,
  },
});

const buildSubscriptionWhereByStripeSubscription = (stripeSubscriptionId: string) => ({
  stripeSubscriptionId: {
    equals: stripeSubscriptionId,
  },
});

const buildSubscriptionWhereByStripeCustomer = (stripeCustomerId: string) => ({
  stripeCustomerId: {
    equals: stripeCustomerId,
  },
});

export const getUserAiSubscriptionRecord = async (
  payload: PayloadLike,
  userId: string | number
) => {
  const found = await payload.find({
    collection: "ai_subscriptions",
    depth: 0,
    limit: 1,
    sort: "-updatedAt",
    overrideAccess: true,
    where: buildSubscriptionWhereByUser(userId),
  });
  return found?.docs?.[0] || null;
};

export const findAiSubscriptionByStripeSubscriptionId = async (
  payload: PayloadLike,
  stripeSubscriptionId: string
) => {
  const needle = toNonEmptyString(stripeSubscriptionId);
  if (!needle) return null;
  const found = await payload.find({
    collection: "ai_subscriptions",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: buildSubscriptionWhereByStripeSubscription(needle),
  });
  return found?.docs?.[0] || null;
};

export const findAiSubscriptionByStripeCustomerId = async (
  payload: PayloadLike,
  stripeCustomerId: string
) => {
  const needle = toNonEmptyString(stripeCustomerId);
  if (!needle) return null;
  const found = await payload.find({
    collection: "ai_subscriptions",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: buildSubscriptionWhereByStripeCustomer(needle),
  });
  return found?.docs?.[0] || null;
};

type UpsertAiSubscriptionInput = {
  userId: string | number;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  planCode?: AiPlanCode | null;
  status?: AiSubscriptionStatus | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  lastInvoiceId?: string | null;
  meta?: Record<string, unknown>;
};

export const upsertAiSubscriptionRecord = async (
  payload: PayloadLike,
  input: UpsertAiSubscriptionInput
) => {
  const userId = normalizeRelationshipId(input.userId);
  if (!userId) {
    throw new Error("User id is required for subscription upsert.");
  }

  const stripeSubscriptionId = toNonEmptyString(input.stripeSubscriptionId);
  const stripeCustomerId = toNonEmptyString(input.stripeCustomerId);
  let existing =
    (stripeSubscriptionId
      ? await findAiSubscriptionByStripeSubscriptionId(payload, stripeSubscriptionId)
      : null) ||
    (await getUserAiSubscriptionRecord(payload, userId));

  const normalizedPlan = normalizeAiPlanCode(input.planCode ?? null);
  const data: Record<string, unknown> = {
    user: userId as any,
    stripeCustomerId: stripeCustomerId || undefined,
    stripeSubscriptionId: stripeSubscriptionId || undefined,
    stripePriceId: toNonEmptyString(input.stripePriceId) || undefined,
    planCode: normalizedPlan || undefined,
    status: normalizeAiSubscriptionStatus(input.status || existing?.status || "incomplete"),
    currentPeriodStart: toIsoDateOrNull(input.currentPeriodStart) || undefined,
    currentPeriodEnd: toIsoDateOrNull(input.currentPeriodEnd) || undefined,
    cancelAtPeriodEnd:
      typeof input.cancelAtPeriodEnd === "boolean"
        ? input.cancelAtPeriodEnd
        : toBool(existing?.cancelAtPeriodEnd),
    lastInvoiceId: toNonEmptyString(input.lastInvoiceId) || undefined,
    meta: input.meta || undefined,
  };

  if (!existing && stripeCustomerId) {
    existing = await findAiSubscriptionByStripeCustomerId(payload, stripeCustomerId);
  }

  if (existing?.id) {
    return payload.update({
      collection: "ai_subscriptions",
      id: existing.id,
      depth: 0,
      overrideAccess: true,
      data,
    });
  }

  return payload.create({
    collection: "ai_subscriptions",
    depth: 0,
    overrideAccess: true,
    data,
  });
};

export const toAiSubscriptionSummary = (value: any): AiSubscriptionSummary | null => {
  if (!value || typeof value !== "object") return null;

  const planCode = normalizeAiPlanCode(value.planCode);
  const plan = planCode ? getAiPlanByCode(planCode) : null;
  const status = normalizeAiSubscriptionStatus(value.status);
  const currentPeriodStart = toIsoDateOrNull(value.currentPeriodStart);
  const currentPeriodEnd = toIsoDateOrNull(value.currentPeriodEnd);
  const isActive = isAiSubscriptionActive(status);

  return {
    id: toNonEmptyString(value.id),
    userId: String(normalizeRelationshipId(value.user) ?? ""),
    stripeCustomerId: toNonEmptyString(value.stripeCustomerId),
    stripeSubscriptionId: toNonEmptyString(value.stripeSubscriptionId),
    stripePriceId: toNonEmptyString(value.stripePriceId),
    planCode,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: toBool(value.cancelAtPeriodEnd),
    monthlyTokens: plan?.monthlyTokens || 0,
    monthlyAmountCents: plan?.monthlyAmountCents || 0,
    planLabel: plan?.label || "No plan",
    proAccess: Boolean(plan?.proAccess) && isActive,
    isActive,
    nextBillingAt: currentPeriodEnd,
    updatedAt: toIsoDateOrNull(value.updatedAt),
  };
};

export const normalizeAiModeTier = (value: unknown): AiGenerationModeTier => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "pro") return "pro";
  return "standard";
};

export const hasProAccess = (planCode: AiPlanCode | null, status: unknown) => {
  if (!planCode) return false;
  if (!isAiSubscriptionActive(status)) return false;
  const plan = resolveAiPlans()[planCode];
  return Boolean(plan?.proAccess);
};

export const canUseAiModeTier = (
  requestedMode: AiGenerationModeTier,
  planCode: AiPlanCode | null,
  status: unknown
) => {
  if (requestedMode !== "pro") return true;
  return hasProAccess(planCode, status);
};

type ReserveWebhookInput = {
  provider: "stripe" | "yookassa";
  eventId: string;
  eventType: string;
  meta?: Record<string, unknown>;
};

export const reserveProcessedWebhookEvent = async (
  payload: PayloadLike,
  input: ReserveWebhookInput
) => {
  const eventId = toNonEmptyString(input.eventId);
  if (!eventId) {
    return { duplicate: false, record: null as any };
  }

  const existing = await payload.find({
    collection: "processed_webhooks",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      eventId: {
        equals: eventId,
      },
    },
  });
  const existingRecord = existing?.docs?.[0];
  if (existingRecord) {
    const existingStatus = toNonEmptyString(existingRecord.status).toLowerCase();
    if (existingStatus === "failed" && existingRecord.id) {
      const reopened = await payload.update({
        collection: "processed_webhooks",
        id: existingRecord.id,
        depth: 0,
        overrideAccess: true,
        data: {
          status: "processing",
          processedAt: undefined,
          failureReason: undefined,
          meta: input.meta || undefined,
        },
      });
      return { duplicate: false, record: reopened };
    }
    return { duplicate: true, record: existingRecord };
  }

  try {
    const created = await payload.create({
      collection: "processed_webhooks",
      depth: 0,
      overrideAccess: true,
      data: {
        provider: input.provider,
        eventId,
        eventType: toNonEmptyString(input.eventType) || "unknown",
        status: "processing",
        meta: input.meta || {},
      },
    });
    return { duplicate: false, record: created };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("duplicate") || message.includes("unique")) {
      const retried = await payload.find({
        collection: "processed_webhooks",
        depth: 0,
        limit: 1,
        overrideAccess: true,
        where: {
          eventId: {
            equals: eventId,
          },
        },
      });
      return { duplicate: true, record: retried?.docs?.[0] || null };
    }
    throw error;
  }
};

export const finalizeProcessedWebhookEvent = async (
  payload: PayloadLike,
  webhookId: string | number | null | undefined,
  status: "processed" | "ignored" | "failed",
  input?: {
    failureReason?: string;
    meta?: Record<string, unknown>;
  }
) => {
  if (!webhookId) return;
  await payload.update({
    collection: "processed_webhooks",
    id: webhookId,
    depth: 0,
    overrideAccess: true,
    data: {
      status,
      processedAt: new Date().toISOString(),
      failureReason: toNonEmptyString(input?.failureReason) || undefined,
      meta: input?.meta || undefined,
    },
  });
};
