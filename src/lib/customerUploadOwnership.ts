import { createHash, randomBytes } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

export const CUSTOMER_UPLOAD_OWNER_COOKIE = "store3d_upload_owner";

const OWNER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OWNER_TOKEN_BYTES = 24;

const normalizeToken = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

export const hashCustomerUploadOwnerToken = (token: string) => {
  const normalized = normalizeToken(token);
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex");
};

export const readCustomerUploadOwnerToken = (request: NextRequest) =>
  normalizeToken(request.cookies.get(CUSTOMER_UPLOAD_OWNER_COOKIE)?.value ?? "");

export const ensureCustomerUploadOwnerToken = (request: NextRequest) => {
  const existing = readCustomerUploadOwnerToken(request);
  if (existing) {
    return { token: existing, created: false as const };
  }
  return { token: randomBytes(OWNER_TOKEN_BYTES).toString("hex"), created: true as const };
};

export const attachCustomerUploadOwnerCookie = (
  response: NextResponse,
  token: string
) => {
  const normalized = normalizeToken(token);
  if (!normalized) return;
  response.cookies.set({
    name: CUSTOMER_UPLOAD_OWNER_COOKIE,
    value: normalized,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OWNER_COOKIE_MAX_AGE_SECONDS,
  });
};

