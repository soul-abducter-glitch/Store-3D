import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { AI_TOKEN_COST, getUserAiCredits } from "@/lib/aiCredits";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

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

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(authResult?.user?.id);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const tokens = await getUserAiCredits(payload as any, userId);

    return NextResponse.json(
      {
        success: true,
        tokens,
        tokenCost: AI_TOKEN_COST,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/tokens] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch AI tokens.",
      },
      { status: 500 }
    );
  }
}
