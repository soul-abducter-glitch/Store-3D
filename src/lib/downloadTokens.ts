import { createHmac, timingSafeEqual } from "crypto";

export type DownloadTokenPayload = {
  userId: string;
  productId: string;
  iat: number;
  exp: number;
};

const DEFAULT_DOWNLOAD_TTL_SECONDS = 90;

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
  return Math.min(Math.max(parsed, 30), 900);
};

const signPayload = (encodedPayload: string, secret: string) =>
  createHmac("sha256", secret).update(encodedPayload).digest("base64url");

export const createDownloadToken = (
  data: Omit<DownloadTokenPayload, "iat" | "exp">,
  expiresInSeconds = resolveDownloadTtlSeconds()
) => {
  const secret = resolveDownloadSecret();
  if (!secret) {
    throw new Error("Download token secret is not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: DownloadTokenPayload = {
    ...data,
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
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as DownloadTokenPayload;
    if (!payload?.userId || !payload?.productId || !payload?.exp) {
      return { valid: false as const, error: "Token payload is invalid." };
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false as const, error: "Download link has expired." };
    }
    return { valid: true as const, payload };
  } catch {
    return { valid: false as const, error: "Token payload cannot be parsed." };
  }
};

