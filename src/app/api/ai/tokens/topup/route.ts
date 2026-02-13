import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { refundUserAiCredits } from "@/lib/aiCredits";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const TOPUP_MODE = (process.env.AI_TOPUP_MODE || "mock").trim().toLowerCase();

const TOPUP_PACKS: Record<string, { credits: number; label: string }> = {
  starter: { credits: 50, label: "Starter 50" },
  pro: { credits: 200, label: "Pro 200" },
  max: { credits: 500, label: "Max 500" },
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

const toPackId = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
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

    const body = await request.json().catch(() => null);
    const packId = toPackId(body?.packId);
    const selectedPack = TOPUP_PACKS[packId];
    if (!selectedPack) {
      return NextResponse.json({ success: false, error: "Invalid top-up package." }, { status: 400 });
    }

    if (TOPUP_MODE !== "mock") {
      return NextResponse.json(
        {
          success: false,
          error: "Top-up provider is not configured yet.",
          mode: TOPUP_MODE || "unknown",
        },
        { status: 503 }
      );
    }

    const tokens = await refundUserAiCredits(payload as any, userId, selectedPack.credits);
    const transactionId = `mock_topup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

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

