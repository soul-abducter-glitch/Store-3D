import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { captureFunnelEvent } from "@/lib/funnelServer";
import { normalizeFunnelEventName } from "@/lib/funnelEvents";

export const dynamic = "force-dynamic";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeRelationshipId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const base = raw.split(":")[0].trim();
  if (!base || /\s/.test(base)) return null;
  if (/^\d+$/.test(base)) return Number(base);
  return base;
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    let authUser: any = null;
    try {
      const authResult = await payload.auth({ headers: request.headers });
      authUser = authResult?.user ?? null;
    } catch {
      authUser = null;
    }

    const body = await request.json().catch(() => null);
    const eventName = normalizeFunnelEventName(body?.name);
    if (!eventName) {
      return NextResponse.json({ success: true, ignored: true }, { status: 202 });
    }

    const sessionFromHeader = request.headers.get("x-funnel-session");
    const pathFromBody =
      typeof body?.path === "string" ? body.path : request.nextUrl.pathname;

    await captureFunnelEvent({
      payload,
      name: eventName,
      sessionId:
        typeof body?.sessionId === "string" ? body.sessionId : sessionFromHeader,
      userId: authUser?.id ?? null,
      productId: normalizeRelationshipId(body?.productId),
      orderId: normalizeRelationshipId(body?.orderId),
      amount:
        typeof body?.amount === "number" && Number.isFinite(body.amount)
          ? body.amount
          : null,
      currency: typeof body?.currency === "string" ? body.currency : "RUB",
      path: pathFromBody,
      metadata:
        body?.metadata && typeof body.metadata === "object"
          ? body.metadata
          : null,
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json({ success: true, ignored: true }, { status: 202 });
  }
}

