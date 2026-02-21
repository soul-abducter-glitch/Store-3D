import {
  buildSupportPreview,
  buildSupportPublicId,
  normalizeString,
  normalizeSupportCategory,
  normalizeSupportMeta,
  normalizeSupportStatus,
  sanitizeSupportText,
  toIsoDateTime,
  type SupportLinkedEntityType,
  type SupportMessage,
} from "@/lib/supportCenter";

export const normalizeRelationshipId = (value: unknown): string | number | null => {
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
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return raw;
};

const withSupportAdminMessage = (ticket: any, messages: SupportMessage[]) => {
  const adminReply = sanitizeSupportText(ticket?.adminReply, 5000);
  if (!adminReply) return messages;
  const exists = messages.some((entry) => entry.authorType === "SUPPORT" && entry.body === adminReply);
  if (exists) return messages;
  return [
    ...messages,
    {
      id: "admin_reply",
      authorType: "SUPPORT" as const,
      body: adminReply,
      createdAt:
        toIsoDateTime(ticket?.lastAdminReplyAt) ||
        toIsoDateTime(ticket?.updatedAt) ||
        toIsoDateTime(ticket?.createdAt) ||
        new Date().toISOString(),
      attachments: [],
    },
  ];
};

const withInitialMessage = (ticket: any, messages: SupportMessage[]) => {
  const body = sanitizeSupportText(ticket?.message, 5000);
  if (!body) return messages;
  const exists = messages.some((entry) => entry.authorType === "USER" && entry.body === body);
  if (exists) return messages;
  return [
    {
      id: "initial",
      authorType: "USER" as const,
      body,
      createdAt: toIsoDateTime(ticket?.createdAt) || new Date().toISOString(),
      attachments: [],
    },
    ...messages,
  ];
};

export const buildTicketMessages = (ticket: any) => {
  const meta = normalizeSupportMeta(ticket?.meta);
  let messages = [...meta.messages];
  messages = withInitialMessage(ticket, messages);
  messages = withSupportAdminMessage(ticket, messages);
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { messages, meta };
};

const resolveLastReply = (ticket: any, messages: SupportMessage[]) => {
  const lastTimeline = messages[messages.length - 1];
  if (lastTimeline?.createdAt) {
    return {
      at: lastTimeline.createdAt,
      by: lastTimeline.authorType,
    } as const;
  }

  const adminAt = toIsoDateTime(ticket?.lastAdminReplyAt);
  const userAt = toIsoDateTime(ticket?.lastUserMessageAt);
  if (adminAt && (!userAt || adminAt >= userAt)) {
    return { at: adminAt, by: "SUPPORT" as const };
  }
  if (userAt) {
    return { at: userAt, by: "USER" as const };
  }
  return {
    at: toIsoDateTime(ticket?.updatedAt) || toIsoDateTime(ticket?.createdAt) || "",
    by: "USER" as const,
  };
};

export const mapTicketListItem = (ticket: any) => {
  const { messages } = buildTicketMessages(ticket);
  const lastReply = resolveLastReply(ticket, messages);
  return {
    id: normalizeString(ticket?.id || ""),
    publicId: buildSupportPublicId(ticket?.id),
    subject: normalizeString(ticket?.title),
    category: normalizeSupportCategory(ticket?.category),
    priority: normalizeString(ticket?.priority || "normal"),
    status: normalizeSupportStatus(ticket?.status),
    descriptionPreview: buildSupportPreview(ticket?.message, 180),
    createdAt: toIsoDateTime(ticket?.createdAt),
    updatedAt: toIsoDateTime(ticket?.updatedAt),
    lastReplyAt: lastReply.at || undefined,
    lastReplyBy: lastReply.by,
    hasSupportReply: messages.some((entry) => entry.authorType === "SUPPORT"),
  };
};

export const mapTicketDetails = (ticket: any) => {
  const { messages, meta } = buildTicketMessages(ticket);
  const listItem = mapTicketListItem(ticket);
  const linked = meta.linkedEntity
    ? {
        type: meta.linkedEntity.type as SupportLinkedEntityType,
        id: meta.linkedEntity.id,
      }
    : null;

  return {
    ...listItem,
    description: sanitizeSupportText(ticket?.message, 5000),
    email: normalizeString(ticket?.email),
    linkedEntity: linked,
    messages,
  };
};

export const normalizeTicketIdParam = (value: string) => {
  const raw = normalizeString(value);
  if (!raw) return null;
  const supMatch = raw.match(/^sup-(\d+)$/i);
  if (supMatch) return Number.parseInt(supMatch[1], 10);
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return raw;
};
