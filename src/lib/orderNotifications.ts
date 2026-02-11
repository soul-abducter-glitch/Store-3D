import nodemailer from "nodemailer";

const deliveryCostMap: Record<string, number> = {
  cdek: 200,
  yandex: 150,
  ozon: 100,
  pochta: 250,
  pickup: 0,
};

type OrderEvent = "paid" | "cancelled" | "refunded";

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

const isEmailEnabled = () => {
  const raw = (process.env.ORDER_EMAIL_ENABLED || "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return true;
};

const smtpConfig = () => {
  const host = (process.env.SMTP_HOST || "").trim();
  const portRaw = (process.env.SMTP_PORT || "").trim();
  const port = Number(portRaw || "587");
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();
  const from = (process.env.SMTP_FROM || "").trim();
  const secureRaw = (process.env.SMTP_SECURE || "").trim().toLowerCase();
  const secure = secureRaw ? secureRaw === "1" || secureRaw === "true" : port === 465;
  const replyTo = (process.env.SMTP_REPLY_TO || "").trim() || undefined;

  return {
    ready: Boolean(host && port && from),
    host,
    port,
    user,
    pass,
    from,
    secure,
    replyTo,
  };
};

let transporterPromise: Promise<nodemailer.Transporter | null> | null = null;

const getTransporter = async () => {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      const smtp = smtpConfig();
      if (!smtp.ready || !isEmailEnabled()) return null;

      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
      });

      return transporter;
    })();
  }
  return transporterPromise;
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

const sendOrderEventEmail = async (event: OrderEvent, order: any, logger?: NotifyArgs["logger"]) => {
  const emailRaw =
    typeof order?.customer?.email === "string" ? order.customer.email.trim().toLowerCase() : "";
  if (!emailRaw) return;

  const transporter = await getTransporter();
  if (!transporter) {
    logger?.info?.({
      msg: "[orders] email transport is not configured, skip order notification",
      orderId: order?.id,
      event,
    });
    return;
  }

  const smtp = smtpConfig();
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

  try {
    await transporter.sendMail({
      from: smtp.from,
      to: emailRaw,
      replyTo: smtp.replyTo,
      subject: getSubject(event, orderId),
      text,
    });
  } catch (error) {
    logger?.warn?.({
      msg: "[orders] failed to send order notification email",
      err: error,
      orderId,
      event,
      to: emailRaw,
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

