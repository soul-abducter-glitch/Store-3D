import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { checkRateLimit, resolveClientIp } from "@/lib/rateLimit";
import {
  normalizeString,
  normalizeSupportAttachments,
  normalizeSupportCategory,
  normalizeLinkedEntityType,
  resolveSupportPriorityForCreate,
  sanitizeSupportText,
  SUPPORT_DESCRIPTION_MAX,
  SUPPORT_MAX_ATTACHMENTS,
  validateAttachmentList,
  validateSupportDescription,
  validateSupportSubject,
} from "@/lib/supportCenter";
import { mapTicketListItem, normalizeRelationshipId } from "@/lib/supportTicketApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const parsePage = (value: string | null, fallback: number) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizeSearch = (value: string | null) => normalizeString(value).slice(0, 120);

const normalizeEmail = (value: unknown) => normalizeString(value).toLowerCase();

const isTicketOwner = (ticket: any, userId: string | number, userEmail: string) => {
  const ticketUserId = normalizeRelationshipId(ticket?.user);
  if (ticketUserId !== null && String(ticketUserId) === String(userId)) {
    return true;
  }
  const ticketEmail = normalizeEmail(ticket?.email);
  return Boolean(ticketEmail && userEmail && ticketEmail === userEmail);
};

const verifyLinkedEntityAccess = async (
  payload: any,
  userId: string | number,
  userEmail: string,
  linkedEntityType: string,
  linkedEntityId: string
) => {
  if (!linkedEntityType || linkedEntityType === "none" || !linkedEntityId) return true;

  const safeId = /^\d+$/.test(linkedEntityId) ? Number.parseInt(linkedEntityId, 10) : linkedEntityId;

  if (linkedEntityType === "order" || linkedEntityType === "digital_purchase" || linkedEntityType === "print_order") {
    const order = await payload
      .findByID({
        collection: "orders",
        id: safeId as any,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);

    if (!order || !isTicketOwner(order, userId, userEmail)) return false;

    if (linkedEntityType === "digital_purchase") {
      const items = Array.isArray(order?.items) ? order.items : [];
      const hasDigital = items.some((item: any) => String(item?.format || "").toLowerCase() === "digital");
      return hasDigital;
    }

    if (linkedEntityType === "print_order") {
      const items = Array.isArray(order?.items) ? order.items : [];
      const hasPhysical = items.some((item: any) => String(item?.format || "").toLowerCase() === "physical");
      return hasPhysical;
    }

    return true;
  }

  if (linkedEntityType === "ai_generation") {
    const job = await payload
      .findByID({
        collection: "ai_jobs",
        id: safeId as any,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);
    if (!job) return false;
    return String(normalizeRelationshipId(job?.user)) === String(userId);
  }

  if (linkedEntityType === "ai_asset") {
    const asset = await payload
      .findByID({
        collection: "ai_assets",
        id: safeId as any,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);
    if (!asset) return false;
    return String(normalizeRelationshipId(asset?.user)) === String(userId);
  }

  return false;
};

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const auth = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(auth?.user?.id);
    const userEmail = normalizeEmail(auth?.user?.email);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const statusFilter = normalizeString(request.nextUrl.searchParams.get("status")).toLowerCase();
    const search = normalizeSearch(request.nextUrl.searchParams.get("search"));
    const page = parsePage(request.nextUrl.searchParams.get("page"), 1);
    const limit = Math.min(50, Math.max(1, parsePage(request.nextUrl.searchParams.get("limit"), 20)));

    const whereAnd: any[] = [{ user: { equals: userId as any } }];
    if (statusFilter && statusFilter !== "all") {
      whereAnd.push({ status: { equals: statusFilter } });
    }
    if (search) {
      const searchOr: any[] = [
        { title: { like: search } },
        { message: { like: search } },
      ];
      const supIdMatch = search.match(/^sup-(\d+)$/i);
      if (supIdMatch) {
        searchOr.push({ id: { equals: Number.parseInt(supIdMatch[1], 10) } });
      } else if (/^\d+$/.test(search)) {
        searchOr.push({ id: { equals: Number.parseInt(search, 10) } });
      }
      whereAnd.push({ or: searchOr });
    }

    const found = await payload.find({
      collection: "support_tickets",
      depth: 0,
      page,
      limit,
      sort: "-updatedAt",
      overrideAccess: true,
      where: whereAnd.length > 1 ? { and: whereAnd } : whereAnd[0],
    });

    const docs = Array.isArray(found?.docs) ? found.docs : [];
    const tickets = docs
      .filter((ticket) => isTicketOwner(ticket, userId, userEmail))
      .map(mapTicketListItem);

    return NextResponse.json(
      {
        success: true,
        tickets,
        pagination: {
          page: found?.page || page,
          limit: found?.limit || limit,
          total: found?.totalDocs || tickets.length,
          totalPages: found?.totalPages || 1,
        },
        lastUpdatedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[support/tickets:list] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const auth = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(auth?.user?.id);
    const userEmail = normalizeEmail(auth?.user?.email);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const createRateLimit = checkRateLimit({
      scope: "support:create-ticket",
      key: `${String(userId)}:${resolveClientIp(request.headers)}`,
      max: 6,
      windowMs: 10 * 60 * 1000,
    });
    if (!createRateLimit.ok) {
      return NextResponse.json(
        { success: false, error: "\u0421\u043b\u0438\u0448\u043a\u043e\u043c \u043c\u043d\u043e\u0433\u043e \u043f\u043e\u043f\u044b\u0442\u043e\u043a. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435." },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => null);
    const subjectRaw = body?.subject ?? body?.title;
    const descriptionRaw = body?.description ?? body?.message;
    const category = normalizeSupportCategory(body?.category);
    const subject = sanitizeSupportText(subjectRaw, 120);
    const description = sanitizeSupportText(descriptionRaw, SUPPORT_DESCRIPTION_MAX);

    const fieldErrors: Record<string, string> = {};
    const subjectError = validateSupportSubject(subject);
    if (subjectError) fieldErrors.subject = subjectError;

    const descriptionError = validateSupportDescription(description);
    if (descriptionError) fieldErrors.description = descriptionError;

    if (!category) {
      fieldErrors.category = "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044e \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f";
    }

    const linkedEntityType = normalizeLinkedEntityType(body?.linkedEntityType);
    const linkedEntityId = normalizeString(body?.linkedEntityId).slice(0, 120);
    if (linkedEntityType !== "none" && !linkedEntityId) {
      fieldErrors.linkedEntityId = "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 ID \u0441\u0432\u044f\u0437\u0430\u043d\u043d\u043e\u0433\u043e \u043e\u0431\u044a\u0435\u043a\u0442\u0430";
    }

    const attachments = normalizeSupportAttachments(body?.attachments);
    const attachmentError = validateAttachmentList(attachments);
    if (attachmentError) {
      fieldErrors.attachments = attachmentError;
    }
    if (attachments.length > SUPPORT_MAX_ATTACHMENTS) {
      fieldErrors.attachments = `\u041c\u043e\u0436\u043d\u043e \u043f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u044c \u043d\u0435 \u0431\u043e\u043b\u0435\u0435 ${SUPPORT_MAX_ATTACHMENTS} \u0444\u0430\u0439\u043b\u043e\u0432`;
    }

    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json(
        { success: false, error: "validation_error", fieldErrors },
        { status: 400 }
      );
    }

    if (linkedEntityType !== "none" && linkedEntityId) {
      const canLink = await verifyLinkedEntityAccess(
        payload as any,
        userId,
        userEmail,
        linkedEntityType,
        linkedEntityId
      );
      if (!canLink) {
        return NextResponse.json(
          {
            success: false,
            error: "linked_entity_access_denied",
            fieldErrors: {
              linkedEntityId: "\u041d\u0435\u043b\u044c\u0437\u044f \u043f\u0440\u0438\u0432\u044f\u0437\u0430\u0442\u044c \u043e\u0431\u044a\u0435\u043a\u0442, \u043a \u043a\u043e\u0442\u043e\u0440\u043e\u043c\u0443 \u043d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0430",
            },
          },
          { status: 403 }
        );
      }
    }

    const duplicateCheck = await payload.find({
      collection: "support_tickets",
      depth: 0,
      limit: 1,
      sort: "-createdAt",
      overrideAccess: true,
      where: {
        and: [
          { user: { equals: userId as any } },
          { title: { equals: subject } },
          { message: { equals: description } },
        ],
      },
    });
    if (Array.isArray(duplicateCheck?.docs) && duplicateCheck.docs.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "duplicate_ticket",
          fieldErrors: {
            description: "\u041f\u043e\u0445\u043e\u0436\u0435\u0435 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435 \u0443\u0436\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u043d\u0435\u0434\u0430\u0432\u043d\u043e",
          },
        },
        { status: 409 }
      );
    }

    const email = userEmail;
    const name = normalizeString(auth?.user?.name);
    const nowIso = new Date().toISOString();
    const priority = resolveSupportPriorityForCreate(category, body?.priority);

    const meta: Record<string, unknown> = {
      messages: [
        {
          id: `msg_${Date.now()}`,
          authorType: "USER",
          body: description,
          createdAt: nowIso,
          attachments,
        },
      ],
    };
    if (linkedEntityType !== "none" && linkedEntityId) {
      meta.linkedEntity = {
        type: linkedEntityType,
        id: linkedEntityId,
      };
    }

    const created = await payload.create({
      collection: "support_tickets",
      overrideAccess: true,
      data: {
        user: userId as any,
        status: "open",
        priority,
        category,
        email,
        name,
        title: subject,
        message: description,
        lastUserMessageAt: nowIso,
        meta,
      },
    });

    return NextResponse.json(
      {
        success: true,
        ticket: mapTicketListItem(created),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[support/tickets:create] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0442\u0438\u043a\u0435\u0442. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.",
      },
      { status: 500 }
    );
  }
}

