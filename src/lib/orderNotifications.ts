import nodemailer from "nodemailer";
import { createDigitalGuestToken } from "./digitalGuestTokens";

const deliveryCostMap: Record<string, number> = {
  cdek: 200,
  yandex: 150,
  ozon: 100,
  pochta: 250,
  pickup: 0,
};

type OrderEvent = "paid" | "cancelled" | "refunded";

type LoggerLike = {
  info?: (payload: unknown) => void;
  warn?: (payload: unknown) => void;
  error?: (payload: unknown) => void;
};

type NotifyArgs = {
  doc: any;
  previousDoc?: any;
  operation: "create" | "update";
  logger?: LoggerLike;
};

type SmtpSettings = {
  enabled: boolean;
  ready: boolean;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  replyTo?: string;
  user?: string;
  pass?: string;
  hasAuth: boolean;
};

type SendResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  messageId?: string;
  error?: string;
};

const normalizeStatus = (value?: unknown) => {
  if (!value) return "";
  return String(value).trim().toLowerCase();
};

const normalizePaymentStatus = (value?: unknown) => {
  const raw = normalizeStatus(value);
  if (raw === "paid" || raw === "success") return "paid";
  if (raw === "refunded" || raw === "refund") return "refunded";
  if (raw === "failed" || raw === "error") return "failed";
  return raw || "pending";
};

const normalizeOrderStatus = (value?: unknown) => {
  const raw = normalizeStatus(value);
  if (raw === "canceled") return "cancelled";
  return raw || "accepted";
};

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
  return raw || null;
};

const isDigitalFormat = (value: unknown) => {
  const raw = normalizeStatus(value);
  return raw.includes("digital") || raw.includes("\u0446\u0438\u0444\u0440\u043e\u0432");
};

const hasDigitalItems = (order: any) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.some((item: any) =>
    isDigitalFormat(item?.format ?? item?.formatKey ?? item?.type ?? item?.formatLabel)
  );
};

const formatMoney = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0;
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(safe * 100) / 100)} \u20bd`;
};

const resolveDeliveryCost = (order: any) => {
  const shippingMethod =
    typeof order?.shipping?.method === "string" ? order.shipping.method : "";
  return deliveryCostMap[shippingMethod] ?? 0;
};

const resolveOrderTotal = (order: any) => {
  const base =
    typeof order?.total === "number" && Number.isFinite(order.total) ? order.total : 0;
  return Math.max(0, base + resolveDeliveryCost(order));
};

const resolveSiteOrigin = () => {
  const explicit = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const front = (process.env.NEXT_PUBLIC_FRONTEND_URL || "").trim();
  if (front) return front.replace(/\/$/, "");

  const server = (process.env.NEXT_PUBLIC_SERVER_URL || "").trim();
  if (server) return server.replace(/\/$/, "");

  const vercel = (process.env.VERCEL_URL || "").trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  return "http://localhost:3000";
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const isEmailEnabled = () => parseBoolean(process.env.ORDER_EMAIL_ENABLED, true);

export const getOrderEmailSettings = (): SmtpSettings => {
  const host = (process.env.SMTP_HOST || "").trim();
  const portRaw = (process.env.SMTP_PORT || "").trim();
  const port = Number(portRaw || "587");
  const user = (process.env.SMTP_USER || "").trim() || undefined;
  const pass = (process.env.SMTP_PASS || "").trim() || undefined;
  const from = (process.env.SMTP_FROM || "").trim();
  const secure = parseBoolean(process.env.SMTP_SECURE, port === 465);
  const replyTo = (process.env.SMTP_REPLY_TO || "").trim() || undefined;
  const enabled = isEmailEnabled();

  return {
    enabled,
    ready: Boolean(enabled && host && Number.isFinite(port) && port > 0 && from),
    host,
    port,
    secure,
    from,
    replyTo,
    user,
    pass,
    hasAuth: Boolean(user && pass),
  };
};

let transporterPromise: Promise<nodemailer.Transporter | null> | null = null;

const getTransporter = async () => {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      const settings = getOrderEmailSettings();
      if (!settings.ready) return null;

      const transporter = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        auth: settings.hasAuth
          ? {
              user: settings.user,
              pass: settings.pass,
            }
          : undefined,
      });

      return transporter;
    })();
  }

  return transporterPromise;
};

const describeError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message || "Unknown error";
  }
  return String(error || "Unknown error");
};

const resolveEvent = (doc: any, previousDoc?: any): OrderEvent | null => {
  const prevPayment = normalizePaymentStatus(previousDoc?.paymentStatus);
  const nextPayment = normalizePaymentStatus(doc?.paymentStatus);
  const prevStatus = normalizeOrderStatus(previousDoc?.status);
  const nextStatus = normalizeOrderStatus(doc?.status);

  if (prevPayment !== "refunded" && nextPayment === "refunded") return "refunded";
  if (prevStatus !== "cancelled" && nextStatus === "cancelled") return "cancelled";
  if (prevPayment !== "paid" && nextPayment === "paid") return "paid";
  return null;
};

const getOrderItemList = (order: any) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) return "\u0411\u0435\u0437 \u043f\u043e\u0437\u0438\u0446\u0438\u0439";

  return items
    .map((item: any) => {
      const qty =
        typeof item?.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
          ? item.quantity
          : 1;
      const product = item?.product;
      const name =
        typeof product?.name === "string" && product.name.trim()
          ? product.name.trim()
          : typeof product === "string" && product.trim()
            ? product.trim()
            : "\u0422\u043e\u0432\u0430\u0440";
      return `- ${name} x${qty}`;
    })
    .join("\n");
};

const getSubject = (event: OrderEvent, orderId: string) => {
  if (event === "paid") {
    return `\u041e\u043f\u043b\u0430\u0442\u0430 \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u0430: \u0437\u0430\u043a\u0430\u0437 #${orderId}`;
  }
  if (event === "cancelled") {
    return `\u0417\u0430\u043a\u0430\u0437 #${orderId} \u043e\u0442\u043c\u0435\u043d\u0435\u043d`;
  }
  return `\u0412\u043e\u0437\u0432\u0440\u0430\u0442 \u043f\u043e \u0437\u0430\u043a\u0430\u0437\u0443 #${orderId}`;
};

const getEventHeader = (event: OrderEvent) => {
  if (event === "paid") {
    return "\u041c\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u043b\u0438 \u043e\u043f\u043b\u0430\u0442\u0443 \u043f\u043e \u0432\u0430\u0448\u0435\u043c\u0443 \u0437\u0430\u043a\u0430\u0437\u0443.";
  }
  if (event === "cancelled") {
    return "\u0417\u0430\u043a\u0430\u0437 \u043e\u0442\u043c\u0435\u043d\u0435\u043d \u043f\u043e \u0432\u0430\u0448\u0435\u043c\u0443 \u0437\u0430\u043f\u0440\u043e\u0441\u0443.";
  }
  return "\u041f\u043e \u0437\u0430\u043a\u0430\u0437\u0443 \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d \u0432\u043e\u0437\u0432\u0440\u0430\u0442 \u0441\u0440\u0435\u0434\u0441\u0442\u0432.";
};

const buildGuestDigitalLibraryUrl = (order: any, origin: string) => {
  const orderUserId = normalizeRelationshipId(order?.user);
  const emailRaw =
    typeof order?.customer?.email === "string" ? order.customer.email.trim().toLowerCase() : "";
  const orderIdRaw = normalizeRelationshipId(order?.id);
  if (!emailRaw || orderUserId !== null || orderIdRaw === null || !hasDigitalItems(order)) {
    return null;
  }

  const token = createDigitalGuestToken({
    email: emailRaw,
    orderId: String(orderIdRaw),
  });
  return `${origin}/digital/library?token=${encodeURIComponent(token)}`;
};

export const sendNotificationEmail = async (args: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  logger?: LoggerLike;
}): Promise<SendResult> => {
  const settings = getOrderEmailSettings();
  if (!settings.enabled) {
    return { ok: false, skipped: true, reason: "email_disabled" };
  }

  const to = (args.to || "").trim().toLowerCase();
  if (!to) {
    return { ok: false, skipped: true, reason: "missing_recipient" };
  }

  const transporter = await getTransporter();
  if (!transporter) {
    return { ok: false, skipped: true, reason: "smtp_not_configured" };
  }

  try {
    const info = await transporter.sendMail({
      from: settings.from,
      to,
      replyTo: args.replyTo || settings.replyTo,
      subject: args.subject,
      text: args.text,
    });
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    const message = describeError(error);
    args.logger?.warn?.({
      msg: "[orders] failed to send notification email",
      to,
      subject: args.subject,
      err: error,
      errorMessage: message,
    });
    return { ok: false, error: message };
  }
};

const sendOrderEventEmail = async (event: OrderEvent, order: any, logger?: LoggerLike) => {
  const emailRaw =
    typeof order?.customer?.email === "string" ? order.customer.email.trim().toLowerCase() : "";
  if (!emailRaw) return;

  const origin = resolveSiteOrigin();
  const orderId = String(order?.id || "");
  const total = formatMoney(resolveOrderTotal(order));
  const customerName =
    typeof order?.customer?.name === "string" && order.customer.name.trim()
      ? order.customer.name.trim()
      : "\u041f\u043e\u043a\u0443\u043f\u0430\u0442\u0435\u043b\u044c";
  const receiptUrl = `${origin}/api/orders/${orderId}/receipt`;
  const profileUrl = `${origin}/profile?tab=downloads`;
  const guestDigitalUrl =
    event === "paid"
      ? (() => {
          try {
            return buildGuestDigitalLibraryUrl(order, origin);
          } catch (error) {
            logger?.warn?.({
              msg: "[orders] failed to build guest digital library url",
              orderId,
              err: error,
            });
            return null;
          }
        })()
      : null;
  const itemLines = getOrderItemList(order);

  const text = [
    `\u0417\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435, ${customerName}.`,
    "",
    getEventHeader(event),
    `\u0417\u0430\u043a\u0430\u0437: #${orderId}`,
    `\u0421\u0443\u043c\u043c\u0430: ${total}`,
    "",
    "\u0421\u043e\u0441\u0442\u0430\u0432 \u0437\u0430\u043a\u0430\u0437\u0430:",
    itemLines,
    "",
    `\u041b\u0438\u0447\u043d\u044b\u0439 \u043a\u0430\u0431\u0438\u043d\u0435\u0442: ${profileUrl}`,
    ...(guestDigitalUrl
      ? [`\u0424\u0430\u0439\u043b\u044b \u0434\u043b\u044f \u0441\u043a\u0430\u0447\u0438\u0432\u0430\u043d\u0438\u044f: ${guestDigitalUrl}`]
      : []),
    `\u0427\u0435\u043a PDF: ${receiptUrl}`,
  ].join("\n");

  const result = await sendNotificationEmail({
    to: emailRaw,
    subject: getSubject(event, orderId),
    text,
    logger,
  });

  if (result.skipped) {
    logger?.info?.({
      msg: "[orders] skip order notification email",
      orderId,
      event,
      reason: result.reason,
    });
  }
};

export const notifyOrderEventIfNeeded = async (args: NotifyArgs) => {
  const { doc, previousDoc, operation, logger } = args;
  if (!doc || operation !== "update") return;

  const event = resolveEvent(doc, previousDoc);
  if (!event) return;

  await sendOrderEventEmail(event, doc, logger);
};
