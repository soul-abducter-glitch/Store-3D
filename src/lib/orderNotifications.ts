import nodemailer from "nodemailer";

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

const formatMoney = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0;
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(safe * 100) / 100)} ₽`;
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
  if (!items.length) return "Без позиций";

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
            : "Товар";
      return `- ${name} x${qty}`;
    })
    .join("\n");
};

const getSubject = (event: OrderEvent, orderId: string) => {
  if (event === "paid") return `Оплата получена: заказ #${orderId}`;
  if (event === "cancelled") return `Заказ #${orderId} отменен`;
  return `Возврат по заказу #${orderId}`;
};

const getEventHeader = (event: OrderEvent) => {
  if (event === "paid") return "Мы получили оплату по вашему заказу.";
  if (event === "cancelled") return "Заказ отменен по вашему запросу.";
  return "По заказу оформлен возврат средств.";
};

export const sendNotificationEmail = async (args: {
  to: string;
  subject: string;
  text: string;
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
      replyTo: settings.replyTo,
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
      : "Покупатель";
  const receiptUrl = `${origin}/api/orders/${orderId}/receipt?format=pdf`;
  const profileUrl = `${origin}/profile`;
  const itemLines = getOrderItemList(order);

  const text = [
    `Здравствуйте, ${customerName}.`,
    "",
    getEventHeader(event),
    `Заказ: #${orderId}`,
    `Сумма: ${total}`,
    "",
    "Состав заказа:",
    itemLines,
    "",
    `Личный кабинет: ${profileUrl}`,
    `Чек PDF: ${receiptUrl}`,
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

export const sendTestNotificationEmail = async (args: {
  to?: string;
  logger?: LoggerLike;
}) => {
  const settings = getOrderEmailSettings();
  const recipient = (args.to || settings.user || "").trim().toLowerCase();
  const origin = resolveSiteOrigin();

  const text = [
    "Тест SMTP для 3D-STORE.",
    "",
    `Время: ${new Date().toISOString()}`,
    `Сайт: ${origin}`,
    "",
    "Если вы получили это письмо, SMTP настроен корректно.",
  ].join("\n");

  const result = await sendNotificationEmail({
    to: recipient,
    subject: "Тест SMTP: 3D-STORE",
    text,
    logger: args.logger,
  });

  return {
    ...result,
    to: recipient,
    settings: {
      enabled: settings.enabled,
      ready: settings.ready,
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      from: settings.from,
      replyTo: settings.replyTo,
      hasAuth: settings.hasAuth,
      hasUser: Boolean(settings.user),
      hasPass: Boolean(settings.pass),
    },
  };
};

export const notifyOrderEventIfNeeded = async (args: NotifyArgs) => {
  const { doc, previousDoc, operation, logger } = args;
  if (!doc || operation !== "update") return;

  const event = resolveEvent(doc, previousDoc);
  if (!event) return;

  await sendOrderEventEmail(event, doc, logger);
};

