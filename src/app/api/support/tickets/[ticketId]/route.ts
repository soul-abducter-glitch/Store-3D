import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { mapTicketDetails, normalizeRelationshipId, normalizeTicketIdParam } from "@/lib/supportTicketApi";
import { normalizeString } from "@/lib/supportCenter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeEmail = (value: unknown) => normalizeString(value).toLowerCase();

const isTicketOwner = (ticket: any, userId: string | number, userEmail: string) => {
  const ticketUserId = normalizeRelationshipId(ticket?.user);
  if (ticketUserId !== null && String(ticketUserId) === String(userId)) {
    return true;
  }
  const ticketEmail = normalizeEmail(ticket?.email);
  return Boolean(ticketEmail && userEmail && ticketEmail === userEmail);
};

export async function GET(request: NextRequest, context: { params: Promise<{ ticketId: string }> }) {
  try {
    const params = await context.params;
    const normalizedId = normalizeTicketIdParam(params.ticketId);
    if (!normalizedId) {
      return NextResponse.json(
        { success: false, error: "\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 ID \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f." },
        { status: 400 }
      );
    }

    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const auth = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(auth?.user?.id);
    const userEmail = normalizeEmail(auth?.user?.email);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const ticket = await payload
      .findByID({
        collection: "support_tickets",
        id: normalizedId as any,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);

    if (!ticket) {
      return NextResponse.json(
        { success: false, error: "\u041e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e." },
        { status: 404 }
      );
    }

    if (!isTicketOwner(ticket, userId, userEmail)) {
      return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
    }

    return NextResponse.json(
      {
        success: true,
        ticket: mapTicketDetails(ticket),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[support/tickets:details] failed", error);
    return NextResponse.json(
      { success: false, error: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435." },
      { status: 500 }
    );
  }
}

