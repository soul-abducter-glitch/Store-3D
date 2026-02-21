import { createHmac, timingSafeEqual } from "crypto";

export type GiftTokenPayload = {
  transferId: string;
  recipientEmail: string;
  productName?: string;
  iat: number;
  exp: number;
};

const DEFAULT_GIFT_EXP_HOURS = 72;

const base64UrlEncode = (value: string) =>
  Buffer.from(value, "utf8").toString("base64url");

const base64UrlDecode = (value: string) =>
  Buffer.from(value, "base64url").toString("utf8");

const resolveGiftSecret = () =>
  (process.env.GIFT_LINK_SECRET || process.env.PAYLOAD_SECRET || "").trim();

const signPayload = (encodedPayload: string, secret: string) =>
  createHmac("sha256", secret).update(encodedPayload).digest("base64url");

export const normalizeEmail = (value?: string | null) =>
  (value || "").trim().toLowerCase();

export const createGiftToken = (
  data: Omit<GiftTokenPayload, "iat" | "exp">,
  expiresInHours = DEFAULT_GIFT_EXP_HOURS
) => {
  const secret = resolveGiftSecret();
  if (!secret) {
    throw new Error("Gift secret is not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = Math.min(Math.max(1, Math.round(expiresInHours)), 24 * 14);
  const payload: GiftTokenPayload = {
    ...data,
    iat: now,
    exp: now + expiresIn * 3600,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
};

export const verifyGiftToken = (token: string) => {
  const secret = resolveGiftSecret();
  if (!secret) {
    return { valid: false as const, error: "Gift secret is not configured." };
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
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as GiftTokenPayload;
    if (!payload?.transferId || !payload?.recipientEmail || !payload?.exp) {
      return { valid: false as const, error: "Token payload is invalid." };
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false as const, error: "Gift link has expired." };
    }
    return { valid: true as const, payload };
  } catch {
    return { valid: false as const, error: "Token payload cannot be parsed." };
  }
};
