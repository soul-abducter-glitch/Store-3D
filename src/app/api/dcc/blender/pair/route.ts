import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { claimBlenderPairCode, createBlenderPairCode } from "@/lib/blenderBridgePairing";
import { checkRateLimit, resolveClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });
const PAIR_CREATE_WINDOW_MS = 60 * 1000;
const PAIR_CREATE_MAX_REQUESTS = 10;
const PAIR_CLAIM_WINDOW_MS = 10 * 60 * 1000;
const PAIR_CLAIM_MAX_REQUESTS = 60;

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const parseBoolean = (value: unknown, fallback: boolean) => {
  if (value === undefined || value === null) return fallback;
  const raw = toNonEmptyString(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
};

const resolveBridgeTokens = () =>
  (process.env.BLENDER_BRIDGE_TOKEN || process.env.BLENDER_BRIDGE_TOKENS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const resolvePublicServerUrl = (request: NextRequest) => {
  const env =
    toNonEmptyString(process.env.NEXT_PUBLIC_SERVER_URL) ||
    toNonEmptyString(process.env.NEXT_PUBLIC_SITE_URL);
  if (env) return env.replace(/\/$/, "");

  const protocol = toNonEmptyString(request.headers.get("x-forwarded-proto")) || "http";
  const host = toNonEmptyString(request.headers.get("x-forwarded-host")) || toNonEmptyString(request.headers.get("host"));
  if (host) return `${protocol}://${host}`.replace(/\/$/, "");
  return request.nextUrl.origin.replace(/\/$/, "");
};

const ensureBridgeReady = () => {
  const tokens = resolveBridgeTokens();
  if (!tokens.length) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "Blender Bridge token is not configured on server." },
        { status: 503 }
      ),
    };
  }
  const bridgeEnabled = parseBoolean(process.env.BLENDER_BRIDGE_ENABLED, tokens.length > 0);
  if (!bridgeEnabled) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "Blender Bridge is not enabled on this server." },
        { status: 412 }
      ),
    };
  }
  return {
    ok: true as const,
    token: tokens[0],
  };
};

export async function POST(request: NextRequest) {
  try {
    const bridge = ensureBridgeReady();
    if (!bridge.ok) return bridge.response;

    const payload = await getPayloadClient();
    const auth = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = auth?.user?.id ? String(auth.user.id) : "";
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const rate = checkRateLimit({
      scope: "blender-pair-create",
      key: `${userId}:${resolveClientIp(request.headers)}`,
      max: PAIR_CREATE_MAX_REQUESTS,
      windowMs: PAIR_CREATE_WINDOW_MS,
    });
    if (!rate.ok) {
      const retryAfter = Math.max(1, Math.ceil(Math.max(0, rate.retryAfterMs) / 1000));
      return NextResponse.json(
        { success: false, error: "Too many pairing attempts. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
          },
        }
      );
    }

    const created = createBlenderPairCode({
      userId,
      token: bridge.token,
      ttlMs: 10 * 60 * 1000,
    });

    return NextResponse.json(
      {
        success: true,
        code: created.code,
        expiresAt: created.expiresAt,
        serverUrl: resolvePublicServerUrl(request),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[dcc/blender/pair:create] failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to create Blender pair code." },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const bridge = ensureBridgeReady();
    if (!bridge.ok) return bridge.response;

    const rate = checkRateLimit({
      scope: "blender-pair-claim",
      key: resolveClientIp(request.headers),
      max: PAIR_CLAIM_MAX_REQUESTS,
      windowMs: PAIR_CLAIM_WINDOW_MS,
    });
    if (!rate.ok) {
      const retryAfter = Math.max(1, Math.ceil(Math.max(0, rate.retryAfterMs) / 1000));
      return NextResponse.json(
        { success: false, error: "Too many code checks. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
          },
        }
      );
    }

    const body = await request.json().catch(() => null);
    const code = toNonEmptyString(body?.code).toUpperCase();
    if (!code) {
      return NextResponse.json(
        { success: false, error: "Pair code is required." },
        { status: 400 }
      );
    }

    const claimed = claimBlenderPairCode(code);
    if (!claimed.ok) {
      return NextResponse.json(
        { success: false, error: claimed.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        token: claimed.token,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[dcc/blender/pair:claim] failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to claim Blender pair code." },
      { status: 500 }
    );
  }
}

