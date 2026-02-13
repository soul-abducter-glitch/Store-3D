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
  amount: number
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

  return { ok: true, remaining };
};

export const refundUserAiCredits = async (
  payload: PayloadWithUsers,
  userId: string | number,
  amount: number
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
  return next;
};
