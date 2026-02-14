import { resolveProvider } from "@/lib/aiProvider";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { resolveAiPlans } from "@/lib/aiSubscriptionConfig";

type PayloadLike = {
  find: (args: {
    collection: "users";
    depth?: number;
    limit?: number;
    overrideAccess?: boolean;
  }) => Promise<unknown>;
};

export type ReadinessCheck = {
  name: "database" | "ai_schema" | "ai_provider" | "storage" | "payments";
  ok: boolean;
  required: boolean;
  message: string;
};

export type ReadinessResult = {
  ok: boolean;
  checks: ReadinessCheck[];
  generatedAt: string;
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const hasS3Config = () => {
  const accessKey = toNonEmptyString(
    process.env.S3_PUBLIC_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID
  );
  const secretKey = toNonEmptyString(
    process.env.S3_PUBLIC_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY
  );
  const bucket = toNonEmptyString(process.env.S3_PUBLIC_BUCKET || process.env.S3_BUCKET);
  const endpoint = toNonEmptyString(process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT);
  return Boolean(accessKey && secretKey && bucket && endpoint);
};

const hasStripeTopupConfig = () => {
  const mode = toNonEmptyString(process.env.AI_TOPUP_MODE || "mock").toLowerCase();
  if (mode !== "stripe") {
    return { ok: true, message: "Top-up mode is mock." };
  }
  const stripeKey = toNonEmptyString(process.env.STRIPE_SECRET_KEY);
  if (!stripeKey) {
    return { ok: false, message: "AI_TOPUP_MODE=stripe but STRIPE_SECRET_KEY is missing." };
  }
  const webhookSecret = toNonEmptyString(process.env.STRIPE_WEBHOOK_SECRET);
  if (!webhookSecret) {
    return { ok: false, message: "AI_TOPUP_MODE=stripe but STRIPE_WEBHOOK_SECRET is missing." };
  }
  const allowLive = toNonEmptyString(process.env.AI_TOPUP_STRIPE_ALLOW_LIVE).toLowerCase();
  const isLive = stripeKey.startsWith("sk_live_");
  if (isLive && !["1", "true", "yes", "on"].includes(allowLive)) {
    return {
      ok: false,
      message: "Stripe top-up is locked to test mode but sk_live_ key is configured.",
    };
  }
  return {
    ok: true,
    message: isLive ? "Stripe top-up configured (live enabled)." : "Stripe top-up configured in test mode.",
  };
};

const hasOrderPaymentsConfig = () => {
  const mode = toNonEmptyString(process.env.PAYMENTS_MODE || "off").toLowerCase();
  if (!mode || mode === "off" || mode === "mock") {
    return { ok: true, message: "Order payments are off/mock." };
  }
  if (mode === "stripe" || mode === "live") {
    const stripeKey = toNonEmptyString(process.env.STRIPE_SECRET_KEY);
    if (!stripeKey) {
      return { ok: false, message: "PAYMENTS_MODE=stripe but STRIPE_SECRET_KEY is missing." };
    }
    return {
      ok: true,
      message: stripeKey.startsWith("sk_live_")
        ? "Order payments via Stripe are configured in live mode."
        : "Order payments via Stripe are configured in test mode.",
    };
  }
  if (mode === "yookassa" || mode === "yoo") {
    const shopId = toNonEmptyString(process.env.YOOKASSA_SHOP_ID);
    if (!shopId) {
      return { ok: false, message: "PAYMENTS_MODE=yookassa but YOOKASSA_SHOP_ID is missing." };
    }
    const secretKey = toNonEmptyString(process.env.YOOKASSA_SECRET_KEY);
    if (!secretKey) {
      return { ok: false, message: "PAYMENTS_MODE=yookassa but YOOKASSA_SECRET_KEY is missing." };
    }
    const returnUrl = toNonEmptyString(process.env.YOOKASSA_RETURN_URL);
    return {
      ok: true,
      message: returnUrl
        ? "Order payments via YooKassa are configured."
        : "Order payments via YooKassa are configured (return URL fallback is used).",
    };
  }
  return { ok: false, message: `Unsupported PAYMENTS_MODE value: ${mode}.` };
};

const hasAiSubscriptionsConfig = () => {
  const mode = toNonEmptyString(process.env.AI_SUBSCRIPTIONS_MODE || "off").toLowerCase();
  if (mode !== "stripe") {
    return { ok: true, message: "AI subscriptions are off." };
  }
  const stripeKey = toNonEmptyString(process.env.STRIPE_SECRET_KEY);
  if (!stripeKey) {
    return { ok: false, message: "AI_SUBSCRIPTIONS_MODE=stripe but STRIPE_SECRET_KEY is missing." };
  }
  const plans = Object.values(resolveAiPlans());
  const configuredPlans = plans.filter((plan) => Boolean(plan.stripePriceId));
  if (configuredPlans.length === 0) {
    return { ok: false, message: "AI subscriptions enabled but no plan Stripe price ids are configured." };
  }
  return {
    ok: true,
    message: `AI subscriptions configured (${configuredPlans.length} plan(s)).`,
  };
};

export const runServiceReadinessChecks = async (
  payload: PayloadLike
): Promise<ReadinessResult> => {
  const checks: ReadinessCheck[] = [];

  try {
    await payload.find({
      collection: "users",
      depth: 0,
      limit: 1,
      overrideAccess: true,
    });
    checks.push({
      name: "database",
      ok: true,
      required: true,
      message: "Database connection is healthy.",
    });
  } catch (error) {
    checks.push({
      name: "database",
      ok: false,
      required: true,
      message: error instanceof Error ? error.message : "Failed to query database.",
    });
  }

  try {
    await ensureAiLabSchemaOnce(payload as any);
    checks.push({
      name: "ai_schema",
      ok: true,
      required: true,
      message: "AI schema is ready.",
    });
  } catch (error) {
    checks.push({
      name: "ai_schema",
      ok: false,
      required: true,
      message: error instanceof Error ? error.message : "Failed to ensure AI schema.",
    });
  }

  const provider = resolveProvider(process.env.AI_PROVIDER ?? process.env.AI_GENERATION_PROVIDER);
  const providerOk = provider.configured || provider.effectiveProvider === "mock";
  checks.push({
    name: "ai_provider",
    ok: providerOk,
    required: false,
    message: providerOk
      ? provider.fallbackToMock
        ? provider.reason || "Provider fallback to mock mode is active."
        : `Provider ready: ${provider.effectiveProvider}.`
      : provider.reason || "AI provider is not configured.",
  });

  const storageOk = hasS3Config();
  checks.push({
    name: "storage",
    ok: storageOk,
    required: true,
    message: storageOk ? "Storage is configured." : "Storage variables are not configured.",
  });

  const topup = hasStripeTopupConfig();
  const orderPayments = hasOrderPaymentsConfig();
  const subscriptions = hasAiSubscriptionsConfig();
  const payments = {
    ok: topup.ok && orderPayments.ok && subscriptions.ok,
    message: `${topup.message} ${orderPayments.message} ${subscriptions.message}`.trim(),
  };
  checks.push({
    name: "payments",
    ok: payments.ok,
    required: false,
    message: payments.message,
  });

  const ok = checks.every((check) => (check.required ? check.ok : true));

  return {
    ok,
    checks,
    generatedAt: new Date().toISOString(),
  };
};
