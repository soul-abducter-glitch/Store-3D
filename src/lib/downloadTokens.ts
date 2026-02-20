import { createHmac, timingSafeEqual } from "crypto";

export type LegacyDownloadTokenPayload = {
  kind: "legacy";
  userId: string;
  productId: string;
  iat: number;
  exp: number;
};

export type EntitlementDownloadTokenPayload = {
  kind: "entitlement";
  entitlementId: string;
  productId: string;
  ownerType: "USER" | "EMAIL";
  ownerRef: string;
  orderId?: string;
  iat: number;
  exp: number;
};

export type DownloadTokenPayload = LegacyDownloadTokenPayload | EntitlementDownloadTokenPayload;

type CreateDownloadTokenData =
  | {
      userId: string;
      productId: string;
    }
  | {
      entitlementId: string;
      productId: string;
      ownerType: "USER" | "EMAIL";
      ownerRef: string;
      orderId?: string;
    };

const DEFAULT_DOWNLOAD_TTL_SECONDS = 600;

const base64UrlEncode = (value: string) =>
  Buffer.from(value, "utf8").toString("base64url");

const base64UrlDecode = (value: string) =>
  Buffer.from(value, "base64url").toString("utf8");

const resolveDownloadSecret = () =>
  (process.env.DOWNLOAD_LINK_SECRET || process.env.PAYLOAD_SECRET || "").trim();

const resolveDownloadTtlSeconds = () => {
  const raw = (process.env.DOWNLOAD_LINK_TTL_SECONDS || "").trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DOWNLOAD_TTL_SECONDS;
  }
  return Math.min(Math.max(parsed, 300), 1800);
};

const signPayload = (encodedPayload: string, secret: string) =>
  createHmac("sha256", secret).update(encodedPayload).digest("base64url");

export const createDownloadToken = (
  data: CreateDownloadTokenData,
  expiresInSeconds = resolveDownloadTtlSeconds()
) => {
  const secret = resolveDownloadSecret();
  if (!secret) {
    throw new Error("Download token secret is not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: DownloadTokenPayload =
    "entitlementId" in data
      ? {
          kind: "entitlement",
          entitlementId: String(data.entitlementId).trim(),
          productId: String(data.productId).trim(),
          ownerType: data.ownerType === "EMAIL" ? "EMAIL" : "USER",
          ownerRef: String(data.ownerRef).trim(),
          orderId: data.orderId ? String(data.orderId).trim() : undefined,
          iat: now,
          exp: now + expiresInSeconds,
        }
      : {
          kind: "legacy",
          userId: String(data.userId).trim(),
          productId: String(data.productId).trim(),
          iat: now,
          exp: now + expiresInSeconds,
        };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
};

export const verifyDownloadToken = (token: string) => {
  const secret = resolveDownloadSecret();
  if (!secret) {
    return { valid: false as const, error: "Download token secret is not configured." };
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return { valid: false as const, error: "Malformed token." };
  }

  const expected = signPayload(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return { valid: false as const, error: "Invalid signature." };
  }

  try {
    const raw = JSON.parse(base64UrlDecode(encodedPayload)) as Record<string, unknown>;
    if (!raw || typeof raw !== "object") {
      return { valid: false as const, error: "Token payload is invalid." };
    }
    const exp = Number(raw.exp);
    if (!Number.isFinite(exp)) {
      return { valid: false as const, error: "Token payload is invalid." };
    }
    if (exp < Math.floor(Date.now() / 1000)) {
      return { valid: false as const, error: "Download link has expired." };
    }

    const kindRaw = typeof raw.kind === "string" ? raw.kind.trim().toLowerCase() : "";
    if (kindRaw === "entitlement" || raw.entitlementId) {
      const entitlementId = String(raw.entitlementId || "").trim();
      const productId = String(raw.productId || "").trim();
      const ownerRef = String(raw.ownerRef || "").trim();
      const ownerTypeRaw = String(raw.ownerType || "").trim().toUpperCase();
      const ownerType = ownerTypeRaw === "EMAIL" ? "EMAIL" : ownerTypeRaw === "USER" ? "USER" : "";
      if (!entitlementId || !productId || !ownerRef || !ownerType) {
        return { valid: false as const, error: "Token payload is invalid." };
      }
      const payload: EntitlementDownloadTokenPayload = {
        kind: "entitlement",
        entitlementId,
        productId,
        ownerType,
        ownerRef,
        orderId: typeof raw.orderId === "string" ? raw.orderId.trim() || undefined : undefined,
        iat: Number(raw.iat) || 0,
        exp,
      };
      return { valid: true as const, payload };
    }

    const userId = String(raw.userId || "").trim();
    const productId = String(raw.productId || "").trim();
    if (!userId || !productId) {
      return { valid: false as const, error: "Token payload is invalid." };
    }
    const payload: LegacyDownloadTokenPayload = {
      kind: "legacy",
      userId,
      productId,
      iat: Number(raw.iat) || 0,
      exp,
    };
    return { valid: true as const, payload };
  } catch {
    return { valid: false as const, error: "Token payload cannot be parsed." };
  }
};
