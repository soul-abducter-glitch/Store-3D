export type BillingMode = "mock_only" | "hybrid_preview" | "real";

export type BillingUIState = {
  tokenBalance: number;
  billingMode: BillingMode;
  mockTopup: {
    status: "idle" | "loading" | "success" | "error";
    selectedPackageId?: string;
    customAmount?: number;
    errorMessage?: string;
  };
  realBilling: {
    enabled: boolean;
    status: "disabled" | "idle" | "loading" | "error";
    reason?: string;
  };
};

export type AiBillingPlanCode = "s" | "m" | "l";

export type AiBillingSubscriptionPlan = {
  code: AiBillingPlanCode;
  label: string;
  monthlyTokens: number;
  monthlyAmountCents: number;
  proAccess: boolean;
  configured: boolean;
};

export type AiBillingSubscriptionState = {
  id: string;
  stripeCustomerId: string;
  planCode: AiBillingPlanCode | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  nextBillingAt: string | null;
  monthlyTokens: number;
  monthlyAmountCents: number;
  planLabel: string;
  proAccess: boolean;
  isActive: boolean;
};

type MockTopupRequest = {
  amount: number;
  source?: string;
};

type MockTopupResponse = {
  success: boolean;
  mode?: string;
  transactionId?: string;
  creditsAdded?: number;
  newBalance?: number;
  tokens?: number;
  error?: string;
};

type SubscriptionMeResponse = {
  success?: boolean;
  mode?: string;
  plans?: unknown;
  subscription?: unknown;
  error?: string;
};

type SubscriptionCheckoutResponse = {
  success?: boolean;
  checkoutSessionId?: string;
  checkoutUrl?: string;
  error?: string;
};

type SubscriptionPortalResponse = {
  success?: boolean;
  url?: string;
  error?: string;
};

type RealTopupResponse = {
  success?: boolean;
  mode?: string;
  checkoutUrl?: string;
  creditsAdded?: number;
  tokens?: number;
  error?: string;
};

type MockCapabilityResponse = {
  success?: boolean;
  enabled?: boolean;
  reason?: string;
  error?: string;
};

const normalizeBillingMode = (value: unknown): BillingMode => {
  if (typeof value !== "string") return "hybrid_preview";
  const normalized = value.trim().toLowerCase();
  if (normalized === "mock_only") return "mock_only";
  if (normalized === "real") return "real";
  return "hybrid_preview";
};

const toUiMessage = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback;
  const message = value.trim();
  return message || fallback;
};

const toInt = (value: unknown, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
};

const normalizePlanCode = (value: unknown): AiBillingPlanCode | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "s" || normalized === "m" || normalized === "l") return normalized;
  return null;
};

const normalizeSubscriptionPlan = (value: unknown): AiBillingSubscriptionPlan | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as {
    code?: unknown;
    label?: unknown;
    monthlyTokens?: unknown;
    monthlyAmountCents?: unknown;
    proAccess?: unknown;
    configured?: unknown;
  };
  const code = normalizePlanCode(source.code);
  if (!code) return null;
  return {
    code,
    label:
      typeof source.label === "string" && source.label.trim()
        ? source.label.trim()
        : `Plan ${code.toUpperCase()}`,
    monthlyTokens: Math.max(0, toInt(source.monthlyTokens, 0)),
    monthlyAmountCents: Math.max(0, toInt(source.monthlyAmountCents, 0)),
    proAccess: Boolean(source.proAccess),
    configured: Boolean(source.configured),
  };
};

const normalizeSubscriptionState = (value: unknown): AiBillingSubscriptionState | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as {
    id?: unknown;
    stripeCustomerId?: unknown;
    planCode?: unknown;
    status?: unknown;
    cancelAtPeriodEnd?: unknown;
    nextBillingAt?: unknown;
    monthlyTokens?: unknown;
    monthlyAmountCents?: unknown;
    planLabel?: unknown;
    proAccess?: unknown;
    isActive?: unknown;
  };
  return {
    id: typeof source.id === "string" ? source.id : "",
    stripeCustomerId: typeof source.stripeCustomerId === "string" ? source.stripeCustomerId : "",
    planCode: normalizePlanCode(source.planCode),
    status: typeof source.status === "string" ? source.status : "",
    cancelAtPeriodEnd: Boolean(source.cancelAtPeriodEnd),
    nextBillingAt: typeof source.nextBillingAt === "string" ? source.nextBillingAt : null,
    monthlyTokens: Math.max(0, toInt(source.monthlyTokens, 0)),
    monthlyAmountCents: Math.max(0, toInt(source.monthlyAmountCents, 0)),
    planLabel: typeof source.planLabel === "string" && source.planLabel.trim() ? source.planLabel.trim() : "No plan",
    proAccess: Boolean(source.proAccess),
    isActive: Boolean(source.isActive),
  };
};

export const BILLING_MODE: BillingMode = normalizeBillingMode(
  process.env.NEXT_PUBLIC_BILLING_MODE || "hybrid_preview"
);

export const mockBillingEnabled = BILLING_MODE === "mock_only" || BILLING_MODE === "hybrid_preview";
export const realBillingEnabled = BILLING_MODE === "real";

export const billingProvider = {
  async mockTopup({ amount, source }: MockTopupRequest): Promise<{
    success: true;
    newBalance: number;
    creditsAdded: number;
    mode: "mock";
    transactionId: string;
  }> {
    const response = await fetch("/api/dev/mock-topup-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ amount, source }),
    });
    const data = (await response.json().catch(() => null)) as MockTopupResponse | null;
    if (!response.ok || !data?.success) {
      throw new Error(toUiMessage(data?.error, "Failed to top up tokens (mock)."));
    }
    const rawBalance = typeof data.newBalance === "number" ? data.newBalance : data.tokens;
    const rawCredits = typeof data.creditsAdded === "number" ? data.creditsAdded : amount;
    if (typeof rawBalance !== "number" || !Number.isFinite(rawBalance)) {
      throw new Error("Mock topup service returned invalid balance.");
    }
    const transactionId =
      typeof data.transactionId === "string" && data.transactionId.trim()
        ? data.transactionId
        : `mock_${Date.now()}`;
    return {
      success: true,
      newBalance: Math.max(0, Math.trunc(rawBalance)),
      creditsAdded: Math.max(0, Math.trunc(rawCredits)),
      mode: "mock",
      transactionId,
    };
  },

  async getPlans(): Promise<{
    success: true;
    mode: "off" | "stripe";
    plans: AiBillingSubscriptionPlan[];
    subscription: AiBillingSubscriptionState | null;
  }> {
    const response = await fetch("/api/ai/subscriptions/me", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as SubscriptionMeResponse | null;
    if (!response.ok || !data?.success) {
      throw new Error(toUiMessage(data?.error, "Failed to fetch subscription status."));
    }
    const mode = data.mode === "stripe" ? "stripe" : "off";
    const plansRaw = Array.isArray(data.plans) ? data.plans : [];
    const plans = plansRaw
      .map((plan) => normalizeSubscriptionPlan(plan))
      .filter((plan): plan is AiBillingSubscriptionPlan => plan !== null);
    return {
      success: true,
      mode,
      plans,
      subscription: normalizeSubscriptionState(data.subscription),
    };
  },

  async createCheckout(input: { planCode: AiBillingPlanCode }): Promise<{
    success: true;
    checkoutSessionId: string;
    checkoutUrl: string | null;
  }> {
    const response = await fetch("/api/ai/subscriptions/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ planCode: input.planCode }),
    });
    const data = (await response.json().catch(() => null)) as SubscriptionCheckoutResponse | null;
    if (!response.ok || !data?.success) {
      throw new Error(toUiMessage(data?.error, "Failed to start subscription checkout."));
    }
    return {
      success: true,
      checkoutSessionId: typeof data.checkoutSessionId === "string" ? data.checkoutSessionId : "",
      checkoutUrl: typeof data.checkoutUrl === "string" && data.checkoutUrl ? data.checkoutUrl : null,
    };
  },

  async openPortal(): Promise<{ success: true; url: string | null }> {
    const response = await fetch("/api/ai/subscriptions/portal", {
      method: "POST",
      credentials: "include",
    });
    const data = (await response.json().catch(() => null)) as SubscriptionPortalResponse | null;
    if (!response.ok || !data?.success) {
      throw new Error(toUiMessage(data?.error, "Failed to open subscription portal."));
    }
    return {
      success: true,
      url: typeof data.url === "string" && data.url ? data.url : null,
    };
  },

  async realTopup(input: { packId: string }): Promise<{
    success: true;
    checkoutUrl: string | null;
    mode: string;
    creditsAdded: number;
    tokens: number | null;
  }> {
    const response = await fetch("/api/ai/tokens/topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ packId: input.packId }),
    });
    const data = (await response.json().catch(() => null)) as RealTopupResponse | null;
    if (!response.ok || !data?.success) {
      throw new Error(toUiMessage(data?.error, "Failed to top up tokens."));
    }
    return {
      success: true,
      checkoutUrl: typeof data.checkoutUrl === "string" && data.checkoutUrl ? data.checkoutUrl : null,
      mode: typeof data.mode === "string" ? data.mode : "unknown",
      creditsAdded: Math.max(0, toInt(data.creditsAdded, 0)),
      tokens:
        typeof data.tokens === "number" && Number.isFinite(data.tokens)
          ? Math.max(0, Math.trunc(data.tokens))
          : null,
    };
  },

  async getMockCapability(): Promise<{ success: true; enabled: boolean; reason?: string }> {
    const response = await fetch("/api/dev/mock-topup-tokens", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 405) {
      return { success: true, enabled: false, reason: "unavailable" };
    }
    const data = (await response.json().catch(() => null)) as MockCapabilityResponse | null;
    if (!response.ok) {
      return {
        success: true,
        enabled: false,
        reason: typeof data?.reason === "string" ? data.reason : "unavailable",
      };
    }
    return {
      success: true,
      enabled: Boolean(data?.enabled),
      reason: typeof data?.reason === "string" ? data.reason : undefined,
    };
  },
};
