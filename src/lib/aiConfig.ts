export type AiProviderName = "mock" | "meshy" | "tripo";
export type AiTopupMode = "mock" | "stripe";

export type AiTopupPackId = "starter" | "pro" | "max";

export type AiTopupPack = {
  id: AiTopupPackId;
  label: string;
  credits: number;
  amountCents: number;
  currency: string;
  stripePriceId: string;
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

const toCurrency = (value: unknown, fallback: string) => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (!raw) return fallback;
  return raw.replace(/[^a-z]/g, "").slice(0, 3) || fallback;
};

export const normalizeAiProviderName = (value: unknown): AiProviderName => {
  const normalized = toNonEmptyString(value).toLowerCase();
  if (normalized === "meshy") return "meshy";
  if (normalized === "tripo") return "tripo";
  return "mock";
};

export const resolveRequestedAiProvider = (requested?: unknown): AiProviderName =>
  normalizeAiProviderName(
    requested ??
      process.env.AI_PROVIDER ??
      process.env.AI_GENERATION_PROVIDER ??
      "mock"
  );

export const normalizeAiTopupMode = (value: unknown): AiTopupMode => {
  const normalized = toNonEmptyString(value).toLowerCase();
  if (normalized === "stripe") return "stripe";
  return "mock";
};

export const resolveAiTopupMode = (): AiTopupMode =>
  normalizeAiTopupMode(process.env.AI_TOPUP_MODE ?? "mock");

export const resolveAiTopupCurrency = () =>
  toCurrency(process.env.AI_TOPUP_STRIPE_CURRENCY, toCurrency(process.env.PAYMENTS_CURRENCY, "usd"));

export const resolveAiTopupPacks = (): Record<AiTopupPackId, AiTopupPack> => {
  const currency = resolveAiTopupCurrency();
  return {
    starter: {
      id: "starter",
      label: "Starter 50",
      credits: toPositiveInt(process.env.AI_TOPUP_PACK_STARTER_CREDITS, 50),
      amountCents: toPositiveInt(process.env.AI_TOPUP_PACK_STARTER_PRICE_CENTS, 499),
      currency,
      stripePriceId: toNonEmptyString(process.env.AI_TOPUP_STRIPE_PRICE_STARTER),
    },
    pro: {
      id: "pro",
      label: "Pro 200",
      credits: toPositiveInt(process.env.AI_TOPUP_PACK_PRO_CREDITS, 200),
      amountCents: toPositiveInt(process.env.AI_TOPUP_PACK_PRO_PRICE_CENTS, 1499),
      currency,
      stripePriceId: toNonEmptyString(process.env.AI_TOPUP_STRIPE_PRICE_PRO),
    },
    max: {
      id: "max",
      label: "Max 500",
      credits: toPositiveInt(process.env.AI_TOPUP_PACK_MAX_CREDITS, 500),
      amountCents: toPositiveInt(process.env.AI_TOPUP_PACK_MAX_PRICE_CENTS, 2999),
      currency,
      stripePriceId: toNonEmptyString(process.env.AI_TOPUP_STRIPE_PRICE_MAX),
    },
  };
};

