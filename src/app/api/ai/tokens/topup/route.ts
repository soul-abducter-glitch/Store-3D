import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { getUserAiCredits, refundUserAiCredits } from "@/lib/aiCredits";
import { resolveAiTopupMode, resolveAiTopupPacks, type AiTopupPackId } from "@/lib/aiConfig";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { enforceUserAndIpQuota } from "@/lib/aiQuota";
import { resolveClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
const stripeWebhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

const toBoolean = (value: unknown, fallback: boolean) => {
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

const toPackId = (value: unknown): AiTopupPackId | "" => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "starter" || normalized === "pro" || normalized === "max") return normalized;
  return "";
};

const toIdempotencyKey = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 120);
};

const getTopupQuota = () => ({
  userMinute: Number.parseInt(process.env.AI_TOPUP_LIMIT_USER_MINUTE || "", 10) || 2,
  userHour: Number.parseInt(process.env.AI_TOPUP_LIMIT_USER_HOUR || "", 10) || 8,
  userDay: Number.parseInt(process.env.AI_TOPUP_LIMIT_USER_DAY || "", 10) || 24,
  ipMinute: Number.parseInt(process.env.AI_TOPUP_LIMIT_IP_MINUTE || "", 10) || 6,
  ipHour: Number.parseInt(process.env.AI_TOPUP_LIMIT_IP_HOUR || "", 10) || 24,
  ipDay: Number.parseInt(process.env.AI_TOPUP_LIMIT_IP_DAY || "", 10) || 120,
});

const isStripeTopupTestModeAllowed = () => {
  if (!stripeSecretKey) return false;
  const allowLive = toBoolean(process.env.AI_TOPUP_STRIPE_ALLOW_LIVE, false);
  if (allowLive) return true;
  return stripeSecretKey.startsWith("sk_test_");
};

const resolveCheckoutUrl = (request: NextRequest, type: "success" | "cancel") => {
  const envUrl =
    type === "success"
      ? (process.env.AI_TOPUP_STRIPE_SUCCESS_URL || "").trim()
      : (process.env.AI_TOPUP_STRIPE_CANCEL_URL || "").trim();
  if (envUrl) return envUrl;
  const url = new URL("/ai-lab", request.nextUrl.origin);
  url.searchParams.set("topup", type === "success" ? "success" : "cancel");
  if (type === "success") {
    url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  }
  return url.toString();
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

    const userIp = resolveClientIp(request.headers);
    const quotaConfig = getTopupQuota();
    const quota = enforceUserAndIpQuota({
      scope: "ai-topup",
      userId,
      ip: userIp,
      actionLabel: "token top-up",
      ...quotaConfig,
    });
    if (!quota.ok) {
      return NextResponse.json(
        {
          success: false,
          error: quota.message,
          retryAfter: quota.retryAfterSec,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(quota.retryAfterSec),
          },
        }
      );
    }

    const body = await request.json().catch(() => null);
    const packId = toPackId(body?.packId);
    const idempotencyKey =
      toIdempotencyKey(request.headers.get("idempotency-key")) ||
      toIdempotencyKey(body?.idempotencyKey);

    const packs = resolveAiTopupPacks();
    const selectedPack = packId ? packs[packId] : null;
    if (!selectedPack) {
      return NextResponse.json({ success: false, error: "Invalid top-up package." }, { status: 400 });
    }

    const mode = resolveAiTopupMode();
    if (mode === "stripe") {
      if (!stripe) {
        return NextResponse.json(
          {
            success: false,
            error: "Stripe top-up is not configured: STRIPE_SECRET_KEY is missing.",
            mode,
          },
          { status: 503 }
        );
      }
      if (!stripeWebhookSecret) {
        return NextResponse.json(
          {
            success: false,
            error: "Stripe top-up is not configured: STRIPE_WEBHOOK_SECRET is missing.",
            mode,
          },
          { status: 503 }
        );
      }
      if (!isStripeTopupTestModeAllowed()) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Stripe top-up is locked to test mode. Use sk_test_ key or set AI_TOPUP_STRIPE_ALLOW_LIVE=1 after QA.",
            mode,
          },
          { status: 503 }
        );
      }

      const metadata: Record<string, string> = {
        kind: "ai_token_topup",
        userId: String(userId),
        packId,
        credits: String(selectedPack.credits),
      };
      if (idempotencyKey) {
        metadata.requestIdempotencyKey = idempotencyKey;
      }

      const lineItem = selectedPack.stripePriceId
        ? { price: selectedPack.stripePriceId, quantity: 1 }
        : {
            price_data: {
              currency: selectedPack.currency,
              product_data: {
                name: `AI Tokens ${selectedPack.label}`,
                description: `${selectedPack.credits} AI tokens pack`,
              },
              unit_amount: selectedPack.amountCents,
            },
            quantity: 1,
          };

      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          success_url: resolveCheckoutUrl(request, "success"),
          cancel_url: resolveCheckoutUrl(request, "cancel"),
          payment_method_types: ["card"],
          line_items: [lineItem],
          metadata,
          client_reference_id: `${userId}:${packId}`,
          customer_email:
            typeof authResult?.user?.email === "string" ? authResult.user.email : undefined,
        },
        idempotencyKey
          ? {
              idempotencyKey: `ai-topup:${String(userId)}:${idempotencyKey}`,
            }
          : undefined
      );

      return NextResponse.json(
        {
          success: true,
          mode,
          requiresWebhookConfirmation: true,
          checkoutSessionId: session.id,
          checkoutUrl: session.url,
          packId,
          packLabel: selectedPack.label,
          creditsAdded: selectedPack.credits,
        },
        { status: 200 }
      );
    }

    const transactionId = `mock_topup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    if (idempotencyKey) {
      const existing = await payload.find({
        collection: "ai_token_events",
        depth: 0,
        limit: 1,
        sort: "-createdAt",
        overrideAccess: true,
        where: {
          and: [
            {
              user: {
                equals: userId as any,
              },
            },
            {
              reason: {
                equals: "topup",
              },
            },
            {
              idempotencyKey: {
                equals: idempotencyKey,
              },
            },
          ],
        },
      });

      const existingEvent = existing?.docs?.[0] as
        | {
            balanceAfter?: unknown;
            delta?: unknown;
            referenceId?: unknown;
          }
        | undefined;
      if (existingEvent) {
        const tokens =
          typeof existingEvent.balanceAfter === "number" &&
          Number.isFinite(existingEvent.balanceAfter)
            ? Math.max(0, Math.trunc(existingEvent.balanceAfter))
            : await getUserAiCredits(payload as any, userId);

        return NextResponse.json(
          {
            success: true,
            mode: "mock",
            idempotent: true,
            transactionId: String(existingEvent.referenceId ?? transactionId),
            packId,
            packLabel: selectedPack.label,
            creditsAdded:
              typeof existingEvent.delta === "number" && Number.isFinite(existingEvent.delta)
                ? Math.max(0, Math.trunc(existingEvent.delta))
                : selectedPack.credits,
            tokens,
          },
          { status: 200 }
        );
      }
    }

    const tokens = await refundUserAiCredits(payload as any, userId, selectedPack.credits, {
      reason: "topup",
      source: "ai_tokens:topup_mock",
      referenceId: transactionId,
      idempotencyKey: idempotencyKey || undefined,
      meta: {
        packId,
        packLabel: selectedPack.label,
        mode: "mock",
      },
    });

    return NextResponse.json(
      {
        success: true,
        mode: "mock",
        transactionId,
        packId,
        packLabel: selectedPack.label,
        creditsAdded: selectedPack.credits,
        tokens,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/tokens:topup] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to top up AI tokens.",
      },
      { status: 500 }
    );
  }
}
