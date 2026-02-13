import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
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

const normalizeReason = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "spend" || raw === "refund" || raw === "topup" || raw === "adjust") return raw;
  return "adjust";
};

const toInt = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.trunc(parsed);
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

    const rawLimit = Number(request.nextUrl.searchParams.get("limit") || 25);
    const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 25));

    const found = await payload.find({
      collection: "ai_token_events",
      depth: 0,
      limit,
      sort: "-createdAt",
      where: {
        user: {
          equals: userId as any,
        },
      },
      overrideAccess: true,
    });

    const docs = Array.isArray(found?.docs) ? found.docs : [];
    const events = docs.map((event) => ({
      id: String(event?.id ?? ""),
      reason: normalizeReason(event?.reason),
      delta: toInt(event?.delta),
      balanceAfter: toInt(event?.balanceAfter),
      source: typeof event?.source === "string" ? event.source : "system",
      referenceId: typeof event?.referenceId === "string" ? event.referenceId : "",
      createdAt: typeof event?.createdAt === "string" ? event.createdAt : "",
    }));

    return NextResponse.json(
      {
        success: true,
        events,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/tokens:history] failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch token history." },
      { status: 500 }
    );
  }
}

