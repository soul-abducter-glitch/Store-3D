import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
const stripe = stripeSecretKey !== "" ? new Stripe(stripeSecretKey) : null;
const fallbackCurrency = (process.env.PAYMENTS_CURRENCY || "rub").trim().toLowerCase();

type AuditEvent = {
  id: string;
  code:
    | "order_created"
    | "paid_marked"
    | "intent_created"
    | "intent_received"
    | "intent_status"
    | "refund"
    | "note"
    | "error";
  label: string;
  at?: string;
  amountMinor?: number;
  currency?: string;
  status?: string;
  source?: "order" | "stripe" | "system";
};

const normalizeEmail = (value?: string) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const normalizeRelationshipId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const candidate =
      (value as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (value as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (value as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
    return normalizeRelationshipId(candidate);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const base = raw.split(":")[0].trim();
  if (!base || /\s/.test(base)) return null;
  if (/^\d+$/.test(base)) return Number(base);
  return base;
};

const normalizeOrderStatus = (value?: unknown) => {
  if (!value) return "accepted";
  const raw = String(value).trim().toLowerCase();
  if (raw === "cancelled" || raw === "canceled") return "cancelled";
  if (raw === "completed" || raw === "done") return "completed";
  if (raw === "paid" || raw === "success") return "paid";
  if (raw === "ready" || raw === "shipped") return "ready";
  if (raw === "printing") return "printing";
  return "accepted";
};

const normalizePaymentStatus = (value?: unknown) => {
  if (!value) return "pending";
  const raw = String(value).trim().toLowerCase();
  if (raw === "paid" || raw === "success") return "paid";
  if (raw === "failed" || raw === "error") return "failed";
  if (raw === "refunded" || raw === "refund") return "refunded";
  return "pending";
};

const deliveryCostMap: Record<string, number> = {
  cdek: 200,
  yandex: 150,
  ozon: 100,
  pochta: 250,
  pickup: 0,
};

const resolveOrderAmountMinor = (order: any) => {
  const baseTotal =
    typeof order?.total === "number" && Number.isFinite(order.total) ? order.total : 0;
  const shippingMethod =
    typeof order?.shipping?.method === "string" ? order.shipping.method : "";
  const deliveryCost = deliveryCostMap[shippingMethod] ?? 0;
  return Math.round(Math.max(0, baseTotal + deliveryCost) * 100);
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const orderId = resolvedParams?.id ? String(resolvedParams.id).trim() : "";
  if (!orderId) {
    return NextResponse.json(
      { success: false, error: "Order id is required." },
      { status: 400 }
    );
  }

  const payload = await getPayloadClient();
  let authUser: any = null;
  try {
    const authResult = await payload.auth({ headers: request.headers });
    authUser = authResult?.user ?? null;
  } catch {
    authUser = null;
  }
  if (!authUser) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  let order: any = null;
  try {
    order = await payload.findByID({
      collection: "orders",
      id: orderId,
      depth: 0,
      overrideAccess: true,
    });
  } catch {
    return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  }

  const userEmail = normalizeEmail(authUser?.email);
  const orderEmail = normalizeEmail(order?.customer?.email);
  const orderUserId = normalizeRelationshipId(order?.user);
  const isOwner =
    (orderUserId !== null && String(orderUserId) === String(authUser?.id)) ||
    (userEmail && orderEmail && userEmail === orderEmail);
  if (!isOwner) {
    return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
  }

  const orderAmountMinor = resolveOrderAmountMinor(order);
  const paymentProvider =
    typeof order?.paymentProvider === "string" ? order.paymentProvider.trim().toLowerCase() : "";
  const paymentIntentId =
    typeof order?.paymentIntentId === "string" ? order.paymentIntentId.trim() : "";
  const paymentStatus = normalizePaymentStatus(order?.paymentStatus);
  const orderStatus = normalizeOrderStatus(order?.status);

  const events: AuditEvent[] = [
    {
      id: `order-created-${String(order?.id)}`,
      code: "order_created",
      label: "Заказ создан",
      at: typeof order?.createdAt === "string" ? order.createdAt : undefined,
      source: "order",
    },
  ];

  if (typeof order?.paidAt === "string" && order.paidAt) {
    events.push({
      id: `order-paid-${String(order?.id)}`,
      code: "paid_marked",
      label: "Заказ отмечен как оплаченный",
      at: order.paidAt,
      amountMinor: orderAmountMinor,
      currency: fallbackCurrency,
      source: "order",
      status: paymentStatus,
    });
  }

  if (
    paymentProvider === "stripe" &&
    paymentIntentId.startsWith("pi_") &&
    stripe
  ) {
    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const intentCurrency = (intent.currency || fallbackCurrency).toLowerCase();
      events.push({
        id: `intent-created-${intent.id}`,
        code: "intent_created",
        label: "Создан платежный intent",
        at: typeof intent.created === "number" ? new Date(intent.created * 1000).toISOString() : undefined,
        amountMinor: typeof intent.amount === "number" ? intent.amount : undefined,
        currency: intentCurrency,
        source: "stripe",
        status: intent.status,
      });

      const amountReceived =
        typeof intent.amount_received === "number" && intent.amount_received > 0
          ? intent.amount_received
          : 0;
      if (amountReceived > 0) {
        events.push({
          id: `intent-received-${intent.id}`,
          code: "intent_received",
          label: "Платеж получен",
          amountMinor: amountReceived,
          currency: intentCurrency,
          source: "stripe",
          status: intent.status,
        });
      } else {
        events.push({
          id: `intent-status-${intent.id}`,
          code: "intent_status",
          label: "Текущий статус платежа",
          source: "stripe",
          status: intent.status,
        });
      }

      const refunds = await stripe.refunds.list({
        payment_intent: paymentIntentId,
        limit: 100,
      });
      refunds.data.forEach((refund) => {
        events.push({
          id: `refund-${refund.id}`,
          code: "refund",
          label: "Возврат по платежу",
          at: typeof refund.created === "number" ? new Date(refund.created * 1000).toISOString() : undefined,
          amountMinor: typeof refund.amount === "number" ? refund.amount : undefined,
          currency: (refund.currency || intentCurrency || fallbackCurrency).toLowerCase(),
          source: "stripe",
          status: refund.status || undefined,
        });
      });
    } catch (error: any) {
      events.push({
        id: `stripe-error-${String(order?.id)}`,
        code: "error",
        label: `Stripe audit error: ${error?.message || "unknown"}`,
        source: "system",
      });
    }
  } else if (paymentProvider === "stripe" && !stripe) {
    events.push({
      id: `stripe-note-${String(order?.id)}`,
      code: "note",
      label: "Stripe secret key не настроен, детали Stripe недоступны.",
      source: "system",
    });
  }

  const sortedEvents = [...events].sort((a, b) => {
    const aTime = a.at ? new Date(a.at).getTime() : 0;
    const bTime = b.at ? new Date(b.at).getTime() : 0;
    return bTime - aTime;
  });

  return NextResponse.json(
    {
      success: true,
      audit: {
        orderId: String(order.id),
        orderStatus,
        paymentStatus,
        paymentProvider: paymentProvider || "unknown",
        paymentIntentId: paymentIntentId || null,
        amountMinor: orderAmountMinor,
        currency: fallbackCurrency,
        events: sortedEvents,
      },
    },
    { status: 200 }
  );
}
