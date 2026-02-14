import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { normalizeRelationshipId, getUserAiSubscriptionRecord } from "@/lib/aiSubscriptions";
import { resolveAiSubscriptionMode } from "@/lib/aiSubscriptionConfig";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });
const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const resolvePortalReturnUrl = (request: NextRequest) => {
  const envUrl = (process.env.AI_SUBSCRIPTION_PORTAL_RETURN_URL || "").trim();
  if (envUrl) return envUrl;
  return new URL("/ai-lab", request.nextUrl.origin).toString();
};

export async function POST(request: NextRequest) {
  try {
    if (resolveAiSubscriptionMode() !== "stripe") {
      return NextResponse.json(
        { success: false, error: "AI subscriptions are disabled." },
        { status: 503 }
      );
    }
    if (!stripe) {
      return NextResponse.json(
        { success: false, error: "Stripe is not configured." },
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

    const subscription = await getUserAiSubscriptionRecord(payload as any, userId);
    const stripeCustomerId = toNonEmptyString(subscription?.stripeCustomerId);
    if (!stripeCustomerId) {
      return NextResponse.json(
        {
          success: false,
          error: "No subscription customer found. Start subscription checkout first.",
        },
        { status: 404 }
      );
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: resolvePortalReturnUrl(request),
    });

    return NextResponse.json(
      {
        success: true,
        url: portalSession.url,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/subscriptions/portal] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to create Customer Portal session.",
      },
      { status: 500 }
    );
  }
}
