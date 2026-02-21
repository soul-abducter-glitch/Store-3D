import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { refundUserAiCredits } from "@/lib/aiCredits";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_TOPUP_AMOUNT = 1;
const MAX_TOPUP_AMOUNT = 100000;

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toBoolean = (value: unknown, fallback = false) => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const normalizeRelationshipId = (value: unknown): string | number | null => {
  let current: unknown = value;
  while (typeof current === "object" && current !== null) {
    current =
      (current as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (current as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (current as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
  }
  if (current === null || current === undefined) return null;
  if (typeof current === "number") return current;
  const raw = String(current).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
};

const normalizeEmail = (value?: unknown) => normalizeString(value).toLowerCase();

const parseAdminEmails = () =>
  normalizeString(process.env.ADMIN_EMAILS)
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean);

const isAdminUser = (user?: { email?: unknown } | null) => {
  const email = normalizeEmail(user?.email);
  if (!email) return false;
  return parseAdminEmails().includes(email);
};

const parseTopupAmount = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const ensureMockTopupAllowed = (user?: { email?: unknown } | null) => {
  if (process.env.NODE_ENV !== "production") return true;
  if (toBoolean(process.env.AI_DEV_TOPUP_ENABLED, false)) return true;
  return isAdminUser(user);
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(authResult?.user?.id);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    if (!ensureMockTopupAllowed(authResult?.user as { email?: unknown } | null)) {
      return NextResponse.json(
        {
          success: false,
          error: "Mock top-up is disabled in production.",
        },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const amount = parseTopupAmount(body?.amount);
    if (!amount) {
      return NextResponse.json(
        {
          success: false,
          error: "Amount must be a positive integer.",
        },
        { status: 400 }
      );
    }
    if (amount < MIN_TOPUP_AMOUNT || amount > MAX_TOPUP_AMOUNT) {
      return NextResponse.json(
        {
          success: false,
          error: `Amount must be between ${MIN_TOPUP_AMOUNT} and ${MAX_TOPUP_AMOUNT}.`,
        },
        { status: 400 }
      );
    }

    const transactionId = `dev_mock_topup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const sourceSuffix = normalizeString(body?.source).slice(0, 60);
    const tokens = await refundUserAiCredits(payload as any, userId, amount, {
      reason: "topup",
      source: sourceSuffix ? `ai_tokens:dev_mock_topup:${sourceSuffix}` : "ai_tokens:dev_mock_topup",
      referenceId: transactionId,
      meta: {
        mode: "mock",
        endpoint: "dev_mock_topup_tokens",
      },
    });

    return NextResponse.json(
      {
        success: true,
        mode: "mock",
        transactionId,
        creditsAdded: amount,
        newBalance: tokens,
        tokens,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[api/dev/mock-topup-tokens] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to top up AI tokens (mock).",
      },
      { status: 500 }
    );
  }
}
