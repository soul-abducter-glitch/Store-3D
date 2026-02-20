import { createHmac, timingSafeEqual } from "crypto";

export type DigitalGuestTokenPayload = {
  email: string;
  orderId?: string;
  iat: number;
  exp: number;
};

const DEFAULT_GUEST_TOKEN_EXP_HOURS = 72;

const base64UrlEncode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const base64UrlDecode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

const resolveSecret = () =>
  (process.env.DIGITAL_GUEST_LINK_SECRET || process.env.PAYLOAD_SECRET || "").trim();

const signPayload = (encodedPayload: string, secret: string) =>
  createHmac("sha256", secret).update(encodedPayload).digest("base64url");

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const createDigitalGuestToken = (
  data: Omit<DigitalGuestTokenPayload, "iat" | "exp">,
  expiresInHours = DEFAULT_GUEST_TOKEN_EXP_HOURS
) => {
  const secret = resolveSecret();
  if (!secret) {
    throw new Error("Digital guest secret is not configured.");
  }

  const email = normalizeEmail(data.email || "");
  if (!email) {
    throw new Error("Guest email is required for digital token.");
  }

  const now = Math.floor(Date.now() / 1000);
  const expHours = Math.min(Math.max(1, Math.round(expiresInHours)), 24 * 14);
  const payload: DigitalGuestTokenPayload = {
    email,
    orderId: data.orderId ? String(data.orderId).trim() : undefined,
    iat: now,
    exp: now + expHours * 3600,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
};

export const verifyDigitalGuestToken = (token: string) => {
  const secret = resolveSecret();
  if (!secret) {
    return { valid: false as const, error: "Digital guest secret is not configured." };
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
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as DigitalGuestTokenPayload;
    const email = normalizeEmail(payload?.email || "");
    if (!email || !payload?.exp) {
      return { valid: false as const, error: "Token payload is invalid." };
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false as const, error: "Guest link has expired." };
    }
    return {
      valid: true as const,
      payload: {
        ...payload,
        email,
        orderId: payload.orderId ? String(payload.orderId).trim() : undefined,
      },
    };
  } catch {
    return { valid: false as const, error: "Token payload cannot be parsed." };
  }
};
