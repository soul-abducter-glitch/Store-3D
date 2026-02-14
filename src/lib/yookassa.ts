import { createHash } from "crypto";

export type YookassaConfig = {
  shopId: string;
  secretKey: string;
  webhookSecret: string;
  apiBaseUrl: string;
  returnUrl: string;
};

export type YookassaPaymentStatus =
  | "pending"
  | "waiting_for_capture"
  | "succeeded"
  | "canceled"
  | string;

export type YookassaPayment = {
  id: string;
  status: YookassaPaymentStatus;
  paid?: boolean;
  amount?: {
    value?: string;
    currency?: string;
  };
  metadata?: Record<string, string>;
  confirmation?: {
    type?: string;
    confirmation_url?: string;
  };
};

type YookassaCreatePaymentArgs = {
  orderId: string;
  amountMinor: number;
  currency: string;
  description?: string;
  returnUrl: string;
  idempotencyKey: string;
};

export class YookassaApiError extends Error {
  statusCode: number;
  data: unknown;

  constructor(message: string, statusCode: number, data?: unknown) {
    super(message);
    this.name = "YookassaApiError";
    this.statusCode = statusCode;
    this.data = data;
  }
}

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeApiBaseUrl = (value: string) => {
  const normalized = value.endsWith("/") ? value.slice(0, -1) : value;
  return normalized || "https://api.yookassa.ru/v3";
};

const buildBasicAuthHeader = (shopId: string, secretKey: string) =>
  `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`;

const stringifyAmount = (amountMinor: number) => {
  const safe = Number.isFinite(amountMinor) ? Math.max(0, Math.round(amountMinor)) : 0;
  return (safe / 100).toFixed(2);
};

const parseAmountToMinor = (value?: string | null) => {
  if (!value) return 0;
  const normalized = String(value).replace(",", ".").trim();
  if (!normalized) return 0;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
};

const parseJsonSafe = (value: string): any | null => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const resolveYookassaApiBaseUrl = () =>
  normalizeApiBaseUrl(
    toNonEmptyString(process.env.YOOKASSA_API_BASE_URL) || "https://api.yookassa.ru/v3"
  );

export const resolveYookassaConfig = (): YookassaConfig => ({
  shopId: toNonEmptyString(process.env.YOOKASSA_SHOP_ID),
  secretKey: toNonEmptyString(process.env.YOOKASSA_SECRET_KEY),
  webhookSecret: toNonEmptyString(process.env.YOOKASSA_WEBHOOK_SECRET),
  apiBaseUrl: resolveYookassaApiBaseUrl(),
  returnUrl: toNonEmptyString(process.env.YOOKASSA_RETURN_URL),
});

export const isYookassaConfigured = () => {
  const config = resolveYookassaConfig();
  return Boolean(config.shopId && config.secretKey);
};

const requestYookassa = async <T>(args: {
  path: string;
  method?: "GET" | "POST";
  idempotencyKey?: string;
  body?: unknown;
  config?: YookassaConfig;
}): Promise<T> => {
  const config = args.config ?? resolveYookassaConfig();
  if (!config.shopId || !config.secretKey) {
    throw new YookassaApiError("YooKassa is not configured.", 500);
  }

  const headers: HeadersInit = {
    Accept: "application/json",
    Authorization: buildBasicAuthHeader(config.shopId, config.secretKey),
  };
  if (args.method === "POST") {
    headers["Content-Type"] = "application/json";
  }
  if (args.idempotencyKey) {
    headers["Idempotence-Key"] = args.idempotencyKey;
  }

  const response = await fetch(`${config.apiBaseUrl}${args.path}`, {
    method: args.method || "GET",
    headers,
    body: args.body ? JSON.stringify(args.body) : undefined,
    cache: "no-store",
  });

  const rawText = await response.text();
  const json = parseJsonSafe(rawText);
  if (!response.ok) {
    const description =
      toNonEmptyString(json?.description) || toNonEmptyString(json?.message) || rawText;
    throw new YookassaApiError(
      description || `YooKassa request failed with status ${response.status}.`,
      response.status,
      json ?? rawText
    );
  }

  return (json ?? {}) as T;
};

export const mapYookassaPaymentStatus = (
  status?: string | null
): "pending" | "paid" | "failed" => {
  const raw = toNonEmptyString(status).toLowerCase();
  if (raw === "succeeded") return "paid";
  if (raw === "canceled") return "failed";
  return "pending";
};

export const yookassaAmountToMinor = (value?: string | null) => parseAmountToMinor(value);

export const isYookassaWebhookAuthorized = (
  request: Request,
  config?: YookassaConfig
) => {
  const resolved = config ?? resolveYookassaConfig();
  const authHeader = toNonEmptyString(request.headers.get("authorization"));

  if (authHeader && resolved.shopId && resolved.secretKey) {
    const expected = buildBasicAuthHeader(resolved.shopId, resolved.secretKey);
    if (authHeader === expected) {
      return true;
    }
    return false;
  }

  if (resolved.webhookSecret) {
    const provided =
      toNonEmptyString(request.headers.get("x-yookassa-webhook-secret")) ||
      toNonEmptyString(request.headers.get("x-webhook-token"));
    if (!provided) {
      return false;
    }
    return provided === resolved.webhookSecret;
  }

  return true;
};

export const createYookassaPayment = async (
  args: YookassaCreatePaymentArgs,
  config?: YookassaConfig
) => {
  const requestBody = {
    amount: {
      value: stringifyAmount(args.amountMinor),
      currency: (args.currency || "RUB").trim().toUpperCase(),
    },
    capture: true,
    description: args.description || `Order ${args.orderId}`,
    confirmation: {
      type: "redirect",
      return_url: args.returnUrl,
    },
    metadata: {
      orderId: args.orderId,
    },
  };

  return requestYookassa<YookassaPayment>({
    path: "/payments",
    method: "POST",
    idempotencyKey: args.idempotencyKey,
    body: requestBody,
    config,
  });
};

export const getYookassaPayment = async (paymentId: string, config?: YookassaConfig) => {
  const safeId = toNonEmptyString(paymentId);
  if (!safeId) {
    throw new YookassaApiError("Missing payment id.", 400);
  }
  return requestYookassa<YookassaPayment>({
    path: `/payments/${encodeURIComponent(safeId)}`,
    method: "GET",
    config,
  });
};

export const buildYookassaIdempotencyKey = (scope: string, orderId: string) => {
  const base = `${scope}:${orderId}:${Date.now()}`;
  const digest = createHash("sha256").update(base).digest("hex").slice(0, 32);
  return `${scope}:${digest}`;
};
