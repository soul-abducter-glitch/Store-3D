export type AiPlanCode = "s" | "m" | "l";
export type AiSubscriptionMode = "off" | "stripe";
export type AiSubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "trialing"
  | "unpaid"
  | "incomplete_expired";

export type AiPlanConfig = {
  code: AiPlanCode;
  label: string;
  monthlyTokens: number;
  monthlyAmountCents: number;
  stripePriceId: string;
  proAccess: boolean;
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const toPositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(toNonEmptyString(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
};

export const normalizeAiPlanCode = (value: unknown): AiPlanCode | null => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "s" || raw === "m" || raw === "l") return raw;
  return null;
};

export const normalizeAiSubscriptionMode = (value: unknown): AiSubscriptionMode => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "stripe") return "stripe";
  return "off";
};

export const resolveAiSubscriptionMode = (): AiSubscriptionMode =>
  normalizeAiSubscriptionMode(process.env.AI_SUBSCRIPTIONS_MODE || "off");

export const resolveAiPlans = (): Record<AiPlanCode, AiPlanConfig> => ({
  s: {
    code: "s",
    label: "Plan S",
    monthlyTokens: toPositiveInt(process.env.AI_SUB_PLAN_S_TOKENS, 300),
    monthlyAmountCents: toPositiveInt(process.env.AI_SUB_PLAN_S_PRICE_CENTS, 4900),
    stripePriceId: toNonEmptyString(process.env.AI_SUB_STRIPE_PRICE_S),
    proAccess: false,
  },
  m: {
    code: "m",
    label: "Plan M",
    monthlyTokens: toPositiveInt(process.env.AI_SUB_PLAN_M_TOKENS, 1000),
    monthlyAmountCents: toPositiveInt(process.env.AI_SUB_PLAN_M_PRICE_CENTS, 12900),
    stripePriceId: toNonEmptyString(process.env.AI_SUB_STRIPE_PRICE_M),
    proAccess: true,
  },
  l: {
    code: "l",
    label: "Plan L",
    monthlyTokens: toPositiveInt(process.env.AI_SUB_PLAN_L_TOKENS, 3000),
    monthlyAmountCents: toPositiveInt(process.env.AI_SUB_PLAN_L_PRICE_CENTS, 29900),
    stripePriceId: toNonEmptyString(process.env.AI_SUB_STRIPE_PRICE_L),
    proAccess: true,
  },
});

export const getAiPlanByCode = (planCode: unknown): AiPlanConfig | null => {
  const normalized = normalizeAiPlanCode(planCode);
  if (!normalized) return null;
  const plans = resolveAiPlans();
  return plans[normalized] || null;
};

export const getAiPlanByPriceId = (priceId: unknown): AiPlanConfig | null => {
  const needle = toNonEmptyString(priceId);
  if (!needle) return null;
  const plans = Object.values(resolveAiPlans());
  return plans.find((plan) => plan.stripePriceId === needle) || null;
};

export const normalizeAiSubscriptionStatus = (value: unknown): AiSubscriptionStatus => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (
    raw === "active" ||
    raw === "past_due" ||
    raw === "canceled" ||
    raw === "incomplete" ||
    raw === "trialing" ||
    raw === "unpaid" ||
    raw === "incomplete_expired"
  ) {
    return raw;
  }
  return "incomplete";
};

export const isAiSubscriptionActive = (status: unknown) => {
  const normalized = normalizeAiSubscriptionStatus(status);
  return normalized === "active" || normalized === "trialing";
};
