import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import {
  normalizeRelationshipId,
  getUserAiSubscriptionRecord,
  toAiSubscriptionSummary,
} from "@/lib/aiSubscriptions";
import { resolveAiPlans, resolveAiSubscriptionMode } from "@/lib/aiSubscriptionConfig";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(authResult?.user?.id);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const subscriptionRecord = await getUserAiSubscriptionRecord(payload as any, userId);
    const subscription = toAiSubscriptionSummary(subscriptionRecord);
    const plans = Object.values(resolveAiPlans()).map((plan) => ({
      code: plan.code,
      label: plan.label,
      monthlyTokens: plan.monthlyTokens,
      monthlyAmountCents: plan.monthlyAmountCents,
      proAccess: plan.proAccess,
      configured: Boolean(plan.stripePriceId),
    }));

    return NextResponse.json(
      {
        success: true,
        mode: resolveAiSubscriptionMode(),
        subscription,
        plans,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/subscriptions/me] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch subscription status.",
      },
      { status: 500 }
    );
  }
}
