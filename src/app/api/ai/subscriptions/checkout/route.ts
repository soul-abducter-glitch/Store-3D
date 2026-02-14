import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import {
  getAiPlanByCode,
  resolveAiPlans,
  resolveAiSubscriptionMode,
} from "@/lib/aiSubscriptionConfig";
import {
  normalizeRelationshipId,
  upsertAiSubscriptionRecord,
  getUserAiSubscriptionRecord,
} from "@/lib/aiSubscriptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });
const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const toBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const isStripeTestModeAllowed = () => {
  if (!stripeSecretKey) return false;
  const allowLive = toBoolean(process.env.AI_SUBSCRIPTIONS_STRIPE_ALLOW_LIVE, false);
  if (allowLive) return true;
  return stripeSecretKey.startsWith("sk_test_");
};

const resolveCheckoutUrl = (
  request: NextRequest,
  type: "success" | "cancel"
) => {
  const envUrl =
    type === "success"
      ? (process.env.AI_SUBSCRIPTION_SUCCESS_URL || "").trim()
      : (process.env.AI_SUBSCRIPTION_CANCEL_URL || "").trim();
  if (envUrl) return envUrl;
  const url = new URL("/ai-lab", request.nextUrl.origin);
  url.searchParams.set("subscription", type);
  if (type === "success") {
    url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  }
  return url.toString();
};

export async function POST(request: NextRequest) {
  try {
    const mode = resolveAiSubscriptionMode();
    if (mode !== "stripe") {
      return NextResponse.json(
        {
          success: false,
          error: "AI subscriptions are disabled.",
          mode,
        },
        { status: 503 }
      );
    }
    if (!stripe) {
      return NextResponse.json(
        {
          success: false,
          error: "Stripe is not configured. Missing STRIPE_SECRET_KEY.",
        },
        { status: 503 }
      );
    }
    if (!isStripeTestModeAllowed()) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Subscriptions are locked to test mode. Use sk_test_ key or set AI_SUBSCRIPTIONS_STRIPE_ALLOW_LIVE=1 after QA.",
        },
        { status: 503 }
      );
    }

    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(authResult?.user?.id);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const planCode = toNonEmptyString(body?.planCode).toLowerCase();
    const plan = getAiPlanByCode(planCode);
    if (!plan) {
      return NextResponse.json({ success: false, error: "Invalid plan code." }, { status: 400 });
    }
    if (!plan.stripePriceId) {
      return NextResponse.json(
        {
          success: false,
          error: `Stripe price is missing for plan ${plan.code.toUpperCase()}.`,
        },
        { status: 503 }
      );
    }

    const existingSubscription = await getUserAiSubscriptionRecord(payload as any, userId);
    let customerId =
      toNonEmptyString(existingSubscription?.stripeCustomerId) ||
      toNonEmptyString(authResult?.user?.stripeCustomerId);

    if (!customerId) {
      const createdCustomer = await stripe.customers.create({
        email: toNonEmptyString(authResult?.user?.email) || undefined,
        name: toNonEmptyString(authResult?.user?.name) || undefined,
        metadata: {
          userId: String(userId),
        },
      });
      customerId = createdCustomer.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      success_url: resolveCheckoutUrl(request, "success"),
      cancel_url: resolveCheckoutUrl(request, "cancel"),
      line_items: [
        {
          price: plan.stripePriceId,
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      metadata: {
        kind: "ai_plan_subscription",
        userId: String(userId),
        planCode: plan.code,
      },
      subscription_data: {
        metadata: {
          kind: "ai_plan_subscription",
          userId: String(userId),
          planCode: plan.code,
        },
      },
      client_reference_id: String(userId),
    });

    await upsertAiSubscriptionRecord(payload as any, {
      userId,
      stripeCustomerId: customerId,
      stripePriceId: plan.stripePriceId,
      planCode: plan.code,
      status: "incomplete",
      meta: {
        checkoutSessionId: session.id,
        planCode: plan.code,
      },
    });

    return NextResponse.json(
      {
        success: true,
        checkoutSessionId: session.id,
        checkoutUrl: session.url,
        plan: {
          code: plan.code,
          label: plan.label,
          monthlyTokens: plan.monthlyTokens,
        },
        plans: Object.values(resolveAiPlans()).map((item) => ({
          code: item.code,
          label: item.label,
          monthlyTokens: item.monthlyTokens,
          monthlyAmountCents: item.monthlyAmountCents,
          proAccess: item.proAccess,
          configured: Boolean(item.stripePriceId),
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/subscriptions/checkout] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to create subscription checkout session.",
      },
      { status: 500 }
    );
  }
}
