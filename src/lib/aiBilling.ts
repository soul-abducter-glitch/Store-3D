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

const normalizeBillingMode = (value: unknown): BillingMode => {
  if (typeof value !== "string") return "hybrid_preview";
  const normalized = value.trim().toLowerCase();
  if (normalized === "mock_only") return "mock_only";
  if (normalized === "real") return "real";
  return "hybrid_preview";
};

export const BILLING_MODE: BillingMode = normalizeBillingMode(
  process.env.NEXT_PUBLIC_BILLING_MODE || "hybrid_preview"
);

export const mockBillingEnabled = BILLING_MODE === "mock_only" || BILLING_MODE === "hybrid_preview";
export const realBillingEnabled = BILLING_MODE === "real";

const toUiMessage = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback;
  const message = value.trim();
  return message || fallback;
};

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

  async getPlans() {
    return {
      success: false as const,
      reason: "api_not_connected" as const,
    };
  },

  async createCheckout() {
    return {
      success: false as const,
      reason: "api_not_connected" as const,
    };
  },
};
