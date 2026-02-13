import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const normalizeEmail = (value: unknown) => normalizeString(value).toLowerCase();

const getHeaderToken = (request: NextRequest) =>
  normalizeString(request.headers.get("x-support-inbound-token") || "") ||
  normalizeString(request.headers.get("x-support-token") || "");

const extractEmail = (raw: unknown) => {
  const source = normalizeString(raw);
  if (!source) return "";
  const match = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
};

const parseTicketId = (value: unknown) => {
  const source = normalizeString(value);
  if (!source) return "";
  const direct = source.match(/^\d+$/);
  if (direct) return direct[0];
  const hashRef = source.match(/#(\d{1,12})/);
  if (hashRef) return hashRef[1];
  const ticketRef = source.match(/ticket[\s:_-]*(\d{1,12})/i);
  if (ticketRef) return ticketRef[1];
  return "";
};

const parseInboundPayload = async (request: NextRequest) => {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return {
      from: normalizeString(body?.from || body?.sender || body?.email),
      subject: normalizeString(body?.subject),
      text: normalizeString(
        body?.text || body?.message || body?.["stripped-text"] || body?.["body-plain"]
      ),
      html: normalizeString(body?.html || body?.["body-html"]),
      ticketId: parseTicketId(body?.ticketId || body?.ticket_id || body?.subject),
      messageId: normalizeString(body?.messageId || body?.["message-id"]),
    };
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    const from = normalizeString(form.get("from") || form.get("sender") || form.get("email"));
    const subject = normalizeString(form.get("subject"));
    const text = normalizeString(
      form.get("text") ||
        form.get("message") ||
        form.get("stripped-text") ||
        form.get("body-plain")
    );
    const html = normalizeString(form.get("html") || form.get("body-html"));
    const ticketId = parseTicketId(form.get("ticketId") || form.get("ticket_id") || subject);
    const messageId = normalizeString(form.get("messageId") || form.get("message-id"));
    return { from, subject, text, html, ticketId, messageId };
  }

  return {
    from: "",
    subject: "",
    text: "",
    html: "",
    ticketId: "",
    messageId: "",
  };
};

export async function POST(request: NextRequest) {
  try {
    const requiredToken = normalizeString(process.env.SUPPORT_INBOUND_TOKEN || "");
    if (!requiredToken) {
      return NextResponse.json(
        { success: false, error: "Inbound support token is not configured." },
        { status: 503 }
      );
    }

    const token =
      normalizeString(request.nextUrl.searchParams.get("token")) || getHeaderToken(request);
    if (!token || token !== requiredToken) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const inbound = await parseInboundPayload(request);
    const fromEmail = extractEmail(inbound.from);
    const ticketId = parseTicketId(inbound.ticketId || inbound.subject);
    const text = normalizeString(inbound.text || inbound.html).slice(0, 8000);

    if (!fromEmail) {
      return NextResponse.json(
        { success: false, error: "Sender email not detected." },
        { status: 400 }
      );
    }
    if (!ticketId) {
      return NextResponse.json(
        {
          success: false,
          error: "Ticket ID not found in payload. Include #<id> in subject or ticketId field.",
        },
        { status: 400 }
      );
    }
    if (!text) {
      return NextResponse.json(
        { success: false, error: "Empty message body." },
        { status: 400 }
      );
    }

    const ticket = await payload.findByID({
      collection: "support_tickets",
      id: Number.isFinite(Number(ticketId)) ? Number(ticketId) : ticketId,
      depth: 0,
      overrideAccess: true,
    });

    if (!ticket) {
      return NextResponse.json({ success: false, error: "Ticket not found." }, { status: 404 });
    }

    const ticketEmail = normalizeEmail(ticket?.email);
    if (!ticketEmail || ticketEmail !== fromEmail) {
      return NextResponse.json(
        { success: false, error: "Sender email does not match ticket owner." },
        { status: 403 }
      );
    }

    const previousMessage = normalizeString(ticket?.message);
    const nowIso = new Date().toISOString();
    const appended = [
      previousMessage,
      "",
      `--- EMAIL ${nowIso} ---`,
      text,
    ]
      .filter(Boolean)
      .join("\n");

    const currentStatus = normalizeString(ticket?.status).toLowerCase();
    const nextStatus = currentStatus === "resolved" || currentStatus === "closed" ? "open" : currentStatus || "open";

    const previousMeta =
      ticket?.meta && typeof ticket.meta === "object" && !Array.isArray(ticket.meta)
        ? ticket.meta
        : {};

    const updated = await payload.update({
      collection: "support_tickets",
      id: ticket.id,
      overrideAccess: true,
      depth: 0,
      data: {
        message: appended,
        status: nextStatus,
        lastUserMessageAt: nowIso,
        meta: {
          ...previousMeta,
          inboundEmail: {
            at: nowIso,
            from: fromEmail,
            subject: inbound.subject,
            messageId: inbound.messageId,
          },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        ticket: {
          id: String(updated?.id || ticket.id),
          status: normalizeString(updated?.status || nextStatus),
          updatedAt: updated?.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[support/inbound/email] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to process inbound support email.",
      },
      { status: 500 }
    );
  }
}
