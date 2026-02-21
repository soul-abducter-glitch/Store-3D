import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { checkRateLimit, resolveClientIp } from "@/lib/rateLimit";
import { mapTicketDetails, normalizeRelationshipId, normalizeTicketIdParam } from "@/lib/supportTicketApi";
import {
  appendSupportMessage,
  normalizeString,
  normalizeSupportAttachments,
  normalizeSupportStatus,
  sanitizeSupportText,
  validateAttachmentList,
  validateSupportReply,
} from "@/lib/supportCenter";

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

export async function POST(request: NextRequest, context: { params: Promise<{ ticketId: string }> }) {
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

    const messageRateLimit = checkRateLimit({
      scope: "support:reply",
      key: `${String(userId)}:${resolveClientIp(request.headers)}`,
      max: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (!messageRateLimit.ok) {
      return NextResponse.json(
        { success: false, error: "\u0421\u043b\u0438\u0448\u043a\u043e\u043c \u043c\u043d\u043e\u0433\u043e \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435." },
        { status: 429 }
      );
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

    const status = normalizeSupportStatus(ticket?.status);
    if (status === "closed") {
      return NextResponse.json(
        { success: false, error: "\u0422\u0438\u043a\u0435\u0442 \u0437\u0430\u043a\u0440\u044b\u0442. \u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u043d\u043e\u0432\u043e\u0435 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435." },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    const replyText = sanitizeSupportText(body?.message, 5000);
    const replyError = validateSupportReply(replyText);
    const attachments = normalizeSupportAttachments(body?.attachments);
    const attachmentError = validateAttachmentList(attachments);

    if (replyError || attachmentError) {
      return NextResponse.json(
        {
          success: false,
          error: "validation_error",
          fieldErrors: {
            ...(replyError ? { message: replyError } : {}),
            ...(attachmentError ? { attachments: attachmentError } : {}),
          },
        },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const nextMeta = appendSupportMessage(ticket?.meta, {
      authorType: "USER",
      body: replyText,
      attachments,
      createdAt: nowIso,
    });

    const nextStatus =
      status === "waiting_user" || status === "resolved" ? "in_progress" : status;

    const updated = await payload.update({
      collection: "support_tickets",
      id: ticket.id,
      overrideAccess: true,
      depth: 0,
      data: {
        meta: nextMeta,
        status: nextStatus,
        lastUserMessageAt: nowIso,
      },
    });

    const details = mapTicketDetails(updated);
    const lastMessage = details.messages[details.messages.length - 1] || null;

    return NextResponse.json(
      {
        success: true,
        message: lastMessage,
        ticket: details,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[support/tickets:messages] failed", error);
    return NextResponse.json(
      { success: false, error: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043e\u0442\u0432\u0435\u0442." },
      { status: 500 }
    );
  }
}

