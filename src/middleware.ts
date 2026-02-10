import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const isAdminMode =
  process.env.NEXT_PUBLIC_MODE === "admin" ||
  process.env.PORT === "3001" ||
  (process.env.NEXT_PUBLIC_SERVER_URL || "").includes("3001");

const allowlistRaw = process.env.ADMIN_IP_ALLOWLIST || "";
const adminAllowlist = allowlistRaw
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const parseEnvInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const authWindowMs = parseEnvInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 600000);
const authMax = parseEnvInt(process.env.AUTH_RATE_LIMIT_MAX, 20);
const registerMax = parseEnvInt(process.env.REGISTER_RATE_LIMIT_MAX, 8);

type RateLimitEntry = { count: number; resetAt: number };
const rateLimitStore = new Map<string, RateLimitEntry>();

const getClientIp = (request: NextRequest) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const maybeIp = (request as { ip?: string }).ip;
  if (maybeIp) return maybeIp;
  return "unknown";
};

const isIPv4 = (ip: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);

const ipToNumber = (ip: string) => {
  return ip
    .split(".")
    .map((segment) => Number.parseInt(segment, 10))
    .reduce((acc, segment) => (acc << 8) + segment, 0);
};

const isIpAllowed = (ip: string) => {
  if (!adminAllowlist.length) return true;
  if (adminAllowlist.includes("*")) return true;
  const normalizedIp = ip.replace(/^::ffff:/, "");
  for (const entry of adminAllowlist) {
    if (entry === normalizedIp) return true;
    if (entry.includes("/") && isIPv4(normalizedIp)) {
      const [range, bitsRaw] = entry.split("/");
      if (!range || !bitsRaw || !isIPv4(range)) continue;
      const bits = Number.parseInt(bitsRaw, 10);
      if (Number.isNaN(bits) || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if ((ipToNumber(normalizedIp) & mask) === (ipToNumber(range) & mask)) {
        return true;
      }
    }
  }
  return false;
};

const applyRateLimit = (key: string, max: number, windowMs: number) => {
  const now = Date.now();
  if (rateLimitStore.size > 1000) {
    for (const [storedKey, entry] of rateLimitStore.entries()) {
      if (entry.resetAt <= now) {
        rateLimitStore.delete(storedKey);
      }
    }
  }
  const existing = rateLimitStore.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  existing.count += 1;
  if (existing.count > max) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true };
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = getClientIp(request);

  if (adminAllowlist.length && isAdminMode && !isIpAllowed(ip)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (request.method === "POST") {
    if (pathname === "/api/users/login") {
      const rate = applyRateLimit(`login:${ip}`, authMax, authWindowMs);
      if (!rate.ok) {
        return NextResponse.json(
          { error: "Too many login attempts. Try again later." },
          {
            status: 429,
            headers: {
              "Retry-After": String(rate.retryAfter ?? 60),
              "Cache-Control": "no-store",
            },
          }
        );
      }
    } else if (pathname === "/api/users") {
      const rate = applyRateLimit(`register:${ip}`, registerMax, authWindowMs);
      if (!rate.ok) {
        return NextResponse.json(
          { error: "Too many registrations. Try again later." },
          {
            status: 429,
            headers: {
              "Retry-After": String(rate.retryAfter ?? 60),
              "Cache-Control": "no-store",
            },
          }
        );
      }
    }
  }

  if (!isAdminMode) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/admin";
  return NextResponse.redirect(url);
}
