import { sendNotificationEmail } from "@/lib/orderNotifications";

type NotifyArgs = {
  doc: any;
  previousDoc?: any;
  operation: "create" | "update";
  logger?: {
    info?: (payload: unknown) => void;
    warn?: (payload: unknown) => void;
    error?: (payload: unknown) => void;
  };
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const normalizeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const normalizeEmail = (value: unknown) => normalizeString(value).toLowerCase();

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean);

const resolveSupportInbox = () => {
  const explicit = normalizeEmail(process.env.SUPPORT_INBOX_EMAIL || "");
  if (explicit) return explicit;
  return parseAdminEmails()[0] || "";
};

const resolveTicketUrl = (ticketId: string | number) => {
  const adminOrigin =
    normalizeString(process.env.NEXT_PUBLIC_ADMIN_URL) ||
    normalizeString(process.env.NEXT_PUBLIC_SERVER_URL) ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3001";
  return `${adminOrigin.replace(/\/$/, "")}/admin/collections/support_tickets/${ticketId}`;
};

const normalizeStatus = (value: unknown) => {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return "open";
  return raw;
};

const isEmailNotificationsEnabled = () => parseBoolean(process.env.SUPPORT_EMAIL_ENABLED, true);

const sendNewTicketNotifications = async (doc: any, logger?: NotifyArgs["logger"]) => {
  const supportInbox = resolveSupportInbox();
  const customerEmail = normalizeEmail(doc?.email);
  const customerName = normalizeString(doc?.name) || "Пользователь";
  const title = normalizeString(doc?.title) || "Без темы";
  const message = normalizeString(doc?.message) || "";
  const category = normalizeString(doc?.category) || "other";
  const ticketId = String(doc?.id || "");
  const ticketUrl = ticketId ? resolveTicketUrl(ticketId) : "";

  if (supportInbox) {
    await sendNotificationEmail({
      to: supportInbox,
      subject: `Новый тикет поддержки #${ticketId}`,
      replyTo: customerEmail || undefined,
      text: [
        `Поступил новый тикет #${ticketId}.`,
        `Пользователь: ${customerName} <${customerEmail || "no-email"}>`,
        `Категория: ${category}`,
        `Тема: ${title}`,
        "",
        "Сообщение:",
        message || "—",
        "",
        ticketUrl ? `Открыть в админке: ${ticketUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      logger,
    });
  }

  if (customerEmail) {
    const supportReplyTo = supportInbox || undefined;
    await sendNotificationEmail({
      to: customerEmail,
      subject: `Тикет принят #${ticketId}`,
      replyTo: supportReplyTo,
      text: [
        `Здравствуйте, ${customerName}.`,
        "Ваше обращение принято в работу.",
        `Номер тикета: #${ticketId}`,
        `Тема: ${title}`,
        "",
        "Мы ответим в ближайшее время.",
      ].join("\n"),
      logger,
    });
  }
};

const sendTicketUpdateNotification = async (
  doc: any,
  previousDoc: any,
  logger?: NotifyArgs["logger"]
) => {
  const supportInbox = resolveSupportInbox();
  const customerEmail = normalizeEmail(doc?.email);
  if (!customerEmail) return;

  const currentStatus = normalizeStatus(doc?.status);
  const previousStatus = normalizeStatus(previousDoc?.status);
  const currentReply = normalizeString(doc?.adminReply);
  const previousReply = normalizeString(previousDoc?.adminReply);
  const hasStatusChange = currentStatus !== previousStatus;
  const hasNewReply = currentReply && currentReply !== previousReply;

  if (!hasStatusChange && !hasNewReply) return;

  const ticketId = String(doc?.id || "");
  const title = normalizeString(doc?.title) || "Без темы";

  await sendNotificationEmail({
    to: customerEmail,
    subject: `Обновление по тикету #${ticketId}`,
    replyTo: supportInbox || undefined,
    text: [
      `Тикет #${ticketId}: ${title}`,
      `Статус: ${currentStatus}`,
      hasNewReply ? "" : "",
      hasNewReply ? "Ответ поддержки:" : "",
      hasNewReply ? currentReply : "",
    ]
      .filter(Boolean)
      .join("\n"),
    logger,
  });
};

export const notifySupportTicketIfNeeded = async (args: NotifyArgs) => {
  if (!isEmailNotificationsEnabled()) return;
  const { doc, previousDoc, operation, logger } = args;
  if (!doc) return;

  try {
    if (operation === "create") {
      await sendNewTicketNotifications(doc, logger);
      return;
    }
    await sendTicketUpdateNotification(doc, previousDoc, logger);
  } catch (error) {
    logger?.warn?.({
      msg: "[support] email notification failed",
      err: error,
      ticketId: doc?.id,
    });
  }
};
