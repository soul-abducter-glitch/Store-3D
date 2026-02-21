export const SUPPORT_SUBJECT_MIN = 5;
export const SUPPORT_SUBJECT_MAX = 120;
export const SUPPORT_DESCRIPTION_MIN = 20;
export const SUPPORT_DESCRIPTION_MAX = 5000;
export const SUPPORT_REPLY_MIN = 2;
export const SUPPORT_REPLY_MAX = 5000;
export const SUPPORT_MAX_ATTACHMENTS = 5;
export const SUPPORT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const SUPPORT_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export const SUPPORT_ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".pdf",
  ".txt",
  ".zip",
  ".glb",
  ".gltf",
  ".stl",
]);

export const SUPPORT_CATEGORY_VALUES = [
  "ai_lab",
  "print_order",
  "digital_purchase",
  "payment",
  "delivery",
  "account",
  "bug_ui",
  "other",
] as const;

export const SUPPORT_PRIORITY_VALUES = ["low", "normal", "high", "urgent"] as const;

export const SUPPORT_STATUS_VALUES = [
  "open",
  "in_progress",
  "waiting_user",
  "resolved",
  "closed",
] as const;

export const SUPPORT_LINKED_ENTITY_TYPES = [
  "none",
  "order",
  "ai_generation",
  "ai_asset",
  "digital_purchase",
  "print_order",
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORY_VALUES)[number];
export type SupportPriority = (typeof SUPPORT_PRIORITY_VALUES)[number];
export type SupportStatus = (typeof SUPPORT_STATUS_VALUES)[number];
export type SupportLinkedEntityType = (typeof SUPPORT_LINKED_ENTITY_TYPES)[number];

export type SupportAttachment = {
  id: string;
  fileName: string;
  mimeType?: string;
  size?: number;
  url?: string;
};

export type SupportMessage = {
  id: string;
  authorType: "USER" | "SUPPORT";
  body: string;
  createdAt: string;
  attachments: SupportAttachment[];
};

export type SupportMeta = {
  linkedEntity?: {
    type: SupportLinkedEntityType;
    id: string;
  };
  messages: SupportMessage[];
};

const CATEGORY_ALIASES: Record<string, SupportCategory> = {
  ai_generation: "ai_lab",
  ai_tokens: "ai_lab",
  print: "print_order",
  payment: "payment",
  downloads: "digital_purchase",
  other: "other",
  ai_lab: "ai_lab",
  print_order: "print_order",
  digital_purchase: "digital_purchase",
  delivery: "delivery",
  account: "account",
  bug_ui: "bug_ui",
};

const PRIORITY_SET = new Set<string>(SUPPORT_PRIORITY_VALUES);
const STATUS_SET = new Set<string>(SUPPORT_STATUS_VALUES);
const LINKED_ENTITY_SET = new Set<string>(SUPPORT_LINKED_ENTITY_TYPES);

export const normalizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const normalizeSupportCategory = (value: unknown): SupportCategory => {
  const raw = normalizeString(value).toLowerCase().replace(/-/g, "_");
  return CATEGORY_ALIASES[raw] || "other";
};

export const normalizeSupportPriority = (value: unknown): SupportPriority => {
  const raw = normalizeString(value).toLowerCase().replace(/-/g, "_");
  if (PRIORITY_SET.has(raw)) {
    return raw as SupportPriority;
  }
  return "normal";
};

export const normalizeSupportStatus = (value: unknown): SupportStatus => {
  const raw = normalizeString(value).toLowerCase().replace(/-/g, "_");
  if (STATUS_SET.has(raw)) {
    return raw as SupportStatus;
  }
  return "open";
};

export const normalizeLinkedEntityType = (value: unknown): SupportLinkedEntityType => {
  const raw = normalizeString(value).toLowerCase().replace(/-/g, "_");
  if (LINKED_ENTITY_SET.has(raw)) {
    return raw as SupportLinkedEntityType;
  }
  return "none";
};

export const stripHtml = (value: string) =>
  value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const sanitizeSupportText = (value: unknown, maxLength: number) => {
  const source = normalizeString(value);
  if (!source) return "";
  return stripHtml(source).slice(0, maxLength);
};

export const validateSupportSubject = (value: unknown): string | null => {
  const subject = sanitizeSupportText(value, SUPPORT_SUBJECT_MAX);
  if (subject.length < SUPPORT_SUBJECT_MIN) {
    return "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043c\u0443 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f (\u043c\u0438\u043d\u0438\u043c\u0443\u043c 5 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
  }
  if (subject.length > SUPPORT_SUBJECT_MAX) {
    return "\u0422\u0435\u043c\u0430 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0434\u043b\u0438\u043d\u043d\u0430\u044f (\u043c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 120 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
  }
  return null;
};

export const validateSupportDescription = (value: unknown): string | null => {
  const description = sanitizeSupportText(value, SUPPORT_DESCRIPTION_MAX);
  if (description.length < SUPPORT_DESCRIPTION_MIN) {
    return "\u041e\u043f\u0438\u0448\u0438\u0442\u0435 \u043f\u0440\u043e\u0431\u043b\u0435\u043c\u0443 \u043f\u043e\u0434\u0440\u043e\u0431\u043d\u0435\u0435 (\u043c\u0438\u043d\u0438\u043c\u0443\u043c 20 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
  }
  if (description.length > SUPPORT_DESCRIPTION_MAX) {
    return "\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0434\u043b\u0438\u043d\u043d\u043e\u0435 (\u043c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 5000 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
  }
  return null;
};

export const validateSupportReply = (value: unknown): string | null => {
  const reply = sanitizeSupportText(value, SUPPORT_REPLY_MAX);
  if (reply.length < SUPPORT_REPLY_MIN) {
    return "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435";
  }
  if (reply.length > SUPPORT_REPLY_MAX) {
    return "\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0434\u043b\u0438\u043d\u043d\u043e\u0435";
  }
  return null;
};

export const buildSupportPublicId = (value: unknown) => {
  const raw = normalizeString(value);
  if (!raw) return "SUP-0000";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return `SUP-${Math.trunc(numeric).toString().padStart(4, "0")}`;
  }
  return `SUP-${raw}`;
};

export const buildSupportPreview = (text: unknown, maxLength = 180) => {
  const clean = sanitizeSupportText(text, maxLength + 8);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}...`;
};

const normalizeDate = (value: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString();
};

const normalizeAttachment = (value: unknown): SupportAttachment | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const id = normalizeString(source.id || source.mediaId || source.fileId || source.uploadId);
  const fileName = normalizeString(source.fileName || source.filename || source.name);
  if (!id || !fileName) return null;
  const sizeNumber =
    typeof source.size === "number" && Number.isFinite(source.size) ? source.size : undefined;
  return {
    id,
    fileName: fileName.slice(0, 220),
    mimeType: normalizeString(source.mimeType || source.type) || undefined,
    size: sizeNumber,
    url: normalizeString(source.url) || undefined,
  };
};

export const normalizeSupportAttachments = (value: unknown): SupportAttachment[] => {
  if (!Array.isArray(value)) return [];
  const files: SupportAttachment[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    const parsed = normalizeAttachment(entry);
    if (!parsed) continue;
    if (seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    files.push(parsed);
    if (files.length >= SUPPORT_MAX_ATTACHMENTS) break;
  }

  return files;
};

export const validateAttachmentList = (attachments: SupportAttachment[]) => {
  if (attachments.length > SUPPORT_MAX_ATTACHMENTS) {
    return `\u041c\u043e\u0436\u043d\u043e \u043f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u044c \u043d\u0435 \u0431\u043e\u043b\u0435\u0435 ${SUPPORT_MAX_ATTACHMENTS} \u0444\u0430\u0439\u043b\u043e\u0432`;
  }

  let totalSize = 0;
  for (const attachment of attachments) {
    const lowerName = String(attachment.fileName || "").toLowerCase();
    const dotIdx = lowerName.lastIndexOf(".");
    const fileExt = dotIdx >= 0 ? lowerName.slice(dotIdx) : "";
    if (!fileExt || !SUPPORT_ALLOWED_ATTACHMENT_EXTENSIONS.has(fileExt)) {
      return "\u0424\u043e\u0440\u043c\u0430\u0442 \u0444\u0430\u0439\u043b\u0430 \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f";
    }

    if (typeof attachment.size !== "number" || !Number.isFinite(attachment.size) || attachment.size <= 0) {
      return "\u0424\u0430\u0439\u043b \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0439";
    }

    if (attachment.size > SUPPORT_MAX_ATTACHMENT_BYTES) {
      return "\u0424\u0430\u0439\u043b \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0439";
    }

    totalSize += attachment.size;
  }

  if (totalSize > SUPPORT_TOTAL_ATTACHMENT_BYTES) {
    return "\u0421\u0443\u043c\u043c\u0430\u0440\u043d\u044b\u0439 \u0440\u0430\u0437\u043c\u0435\u0440 \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u0439 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0439";
  }

  return null;
};

export const normalizeSupportMeta = (value: unknown): SupportMeta => {
  const empty: SupportMeta = { messages: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return empty;
  }

  const source = value as Record<string, unknown>;
  const linkedRaw =
    source.linkedEntity && typeof source.linkedEntity === "object"
      ? (source.linkedEntity as Record<string, unknown>)
      : null;

  const linkedEntityType = normalizeLinkedEntityType(linkedRaw?.type);
  const linkedEntityId = normalizeString(linkedRaw?.id);
  const linkedEntity =
    linkedEntityType !== "none" && linkedEntityId
      ? { type: linkedEntityType, id: linkedEntityId.slice(0, 120) }
      : undefined;

  const rawMessages = Array.isArray(source.messages) ? source.messages : [];
  const messages: SupportMessage[] = rawMessages
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Record<string, unknown>;
      const authorType =
        normalizeString(raw.authorType).toUpperCase() === "SUPPORT" ? "SUPPORT" : "USER";
      const body = sanitizeSupportText(raw.body, SUPPORT_DESCRIPTION_MAX);
      if (!body) return null;
      const createdAt =
        normalizeDate(raw.createdAt) || normalizeDate(raw.at) || new Date().toISOString();
      const id = normalizeString(raw.id) || `msg_${index + 1}`;
      const attachments = normalizeSupportAttachments(raw.attachments);
      return { id, authorType, body, createdAt, attachments } satisfies SupportMessage;
    })
    .filter((entry): entry is SupportMessage => Boolean(entry))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    linkedEntity,
    messages,
  };
};

export const appendSupportMessage = (
  meta: unknown,
  message: {
    authorType: "USER" | "SUPPORT";
    body: string;
    createdAt?: string;
    attachments?: SupportAttachment[];
  }
): SupportMeta => {
  const normalized = normalizeSupportMeta(meta);
  normalized.messages.push({
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    authorType: message.authorType,
    body: sanitizeSupportText(message.body, SUPPORT_DESCRIPTION_MAX),
    createdAt: normalizeDate(message.createdAt) || new Date().toISOString(),
    attachments: normalizeSupportAttachments(message.attachments || []),
  });
  normalized.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return normalized;
};

export const resolveSupportPriorityForCreate = (
  category: SupportCategory,
  requestedPriority?: unknown
) => {
  const explicit = normalizeSupportPriority(requestedPriority);
  if (requestedPriority !== undefined && requestedPriority !== null && normalizeString(requestedPriority)) {
    return explicit;
  }
  if (category === "payment" || category === "digital_purchase") {
    return "high" as const;
  }
  return "normal" as const;
};

export const toIsoDateTime = (value: unknown) => {
  const iso = normalizeDate(value);
  return iso || undefined;
};
