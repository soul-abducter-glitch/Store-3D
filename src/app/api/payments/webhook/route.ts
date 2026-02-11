import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { resolveServerPaymentsMode } from "@/lib/paymentsMode";

export const dynamic = "force-dynamic";

const getPayloadClient = async () => getPayload({ config: payloadConfig });
const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
const stripeWebhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const stripe = stripeSecretKey !== "" ? new Stripe(stripeSecretKey) : null;
const expectedCurrency = (process.env.PAYMENTS_CURRENCY || "rub").trim().toLowerCase();

const deliveryCostMap: Record<string, number> = {
  cdek: 200,
  yandex: 150,
  ozon: 100,
  pochta: 250,
  pickup: 0,
};

const normalizePaymentStatus = (value?: string) => {
  if (!value) return "pending";
  const raw = String(value).trim().toLowerCase();
  if (raw === "paid" || raw === "success") return "paid";
  if (raw === "failed" || raw === "error") return "failed";
  if (raw === "refunded" || raw === "refund") return "refunded";
  return "pending";
};

const resolveExpectedAmountCents = (order: any) => {
  const baseTotal =
    typeof order?.total === "number" && Number.isFinite(order.total) ? order.total : 0;
  const shippingMethod =
    typeof order?.shipping?.method === "string" ? order.shipping.method : "";
  const deliveryCost = deliveryCostMap[shippingMethod] ?? 0;
  const total = Math.max(0, baseTotal + deliveryCost);
  return Math.round(total * 100);
};

const normalizeOrderStatus = (value?: unknown) => {
  if (!value) return "";
  return String(value).trim().toLowerCase();
};

const normalizeProvider = (value?: unknown) => {
  if (!value) return "";
  return String(value).trim().toLowerCase();
};

const isWebhookAuthorized = (request: NextRequest) => {
  const expected = (process.env.PAYMENTS_WEBHOOK_TOKEN || "").trim();
  if (!expected) {
    return process.env.NODE_ENV !== "production";
  }
  const provided =
    request.headers.get("x-payment-token") || request.headers.get("x-webhook-token") || "";
  return expected === provided;
};

const resolveOrderIdFromIntent = async (payload: any, paymentIntentId: string) => {
  if (!paymentIntentId) return null;
  const result = await payload.find({
    collection: "orders",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      paymentIntentId: {
        equals: paymentIntentId,
      },
    },
  });
  return result?.docs?.[0]?.id ?? null;
};

const mapStripeEventToStatus = (eventType: string) => {
  if (eventType === "payment_intent.succeeded") return "paid";
  if (eventType === "payment_intent.payment_failed") return "failed";
  if (eventType === "charge.refunded") return "refunded";
  return null;
};

export async function POST(request: NextRequest) {
  try {
    const paymentsMode = resolveServerPaymentsMode();
    const payload = await getPayloadClient();

    if (paymentsMode === "stripe" && stripe && stripeWebhookSecret) {
      const signature = request.headers.get("stripe-signature") || "";
      if (!signature) {
        return NextResponse.json({ success: false, error: "Missing stripe signature." }, { status: 401 });
      }

      const rawBody = await request.text();
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
      } catch (error: any) {
        return NextResponse.json(
          { success: false, error: error?.message || "Invalid stripe signature." },
          { status: 401 }
        );
      }

      const nextStatus = mapStripeEventToStatus(event.type);
      if (!nextStatus) {
        return NextResponse.json({ success: true, ignored: true, type: event.type }, { status: 200 });
      }

      const paymentIntent =
        event.type === "charge.refunded"
          ? ((event.data.object as Stripe.Charge).payment_intent as string | null)
          : ((event.data.object as Stripe.PaymentIntent).id || null);
      const paymentIntentObject =
        event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed"
          ? (event.data.object as Stripe.PaymentIntent)
          : null;
      const metaOrderId =
        event.type === "charge.refunded"
          ? (event.data.object as Stripe.Charge).metadata?.orderId
          : (event.data.object as Stripe.PaymentIntent).metadata?.orderId;
      const orderIdFromMetadata = metaOrderId ? String(metaOrderId).trim() : "";
      const orderId =
        orderIdFromMetadata || (await resolveOrderIdFromIntent(payload, paymentIntent || ""));

      if (!orderId) {
        return NextResponse.json(
          { success: false, error: "Order not found for webhook event." },
          { status: 404 }
        );
      }

      const order = await payload.findByID({
        collection: "orders",
        id: orderId,
        depth: 0,
        overrideAccess: true,
      });
      if (!order) {
        return NextResponse.json(
          { success: false, error: "Order not found." },
          { status: 404 }
        );
      }

      const orderStatus = normalizeOrderStatus(order?.status);
      const currentPaymentStatus = normalizePaymentStatus(order?.paymentStatus);
      const currentProvider = normalizeProvider(order?.paymentProvider);
      const currentIntentId =
        typeof order?.paymentIntentId === "string" ? order.paymentIntentId.trim() : "";
      if (
        nextStatus === "paid" &&
        (orderStatus === "cancelled" || orderStatus === "canceled" || orderStatus === "completed")
      ) {
        return NextResponse.json(
          { success: true, ignored: true, reason: "order_terminal_status", orderId },
          { status: 200 }
        );
      }

      if (nextStatus === "paid" && paymentIntentObject) {
        const expectedAmount = resolveExpectedAmountCents(order);
        const paidAmount =
          typeof paymentIntentObject.amount_received === "number" &&
          paymentIntentObject.amount_received > 0
            ? paymentIntentObject.amount_received
            : paymentIntentObject.amount;
        const paidCurrency = String(paymentIntentObject.currency || "").trim().toLowerCase();

        if (paidCurrency && paidCurrency !== expectedCurrency) {
          return NextResponse.json(
            {
              success: true,
              ignored: true,
              reason: "currency_mismatch",
              orderId,
              paidCurrency,
              expectedCurrency,
            },
            { status: 200 }
          );
        }

        if (expectedAmount > 0 && paidAmount < expectedAmount) {
          return NextResponse.json(
            {
              success: true,
              ignored: true,
              reason: "amount_mismatch",
              orderId,
              paidAmount,
              expectedAmount,
            },
            { status: 200 }
          );
        }
      }

      const sameIntent = !paymentIntent || currentIntentId === paymentIntent;
      const paidStateAlreadyApplied =
        nextStatus !== "paid" ||
        ((orderStatus === "paid" || orderStatus === "completed") && Boolean(order?.paidAt));
      const isDuplicateStripeEvent =
        currentPaymentStatus === nextStatus &&
        currentProvider === "stripe" &&
        sameIntent &&
        paidStateAlreadyApplied;

      if (isDuplicateStripeEvent) {
        return NextResponse.json(
          { success: true, ignored: true, reason: "duplicate_event", orderId, type: event.type },
          { status: 200 }
        );
      }

      const updateData: Record<string, unknown> = {
        paymentStatus: nextStatus,
        paymentProvider: "stripe",
      };
      if (paymentIntent) {
        updateData.paymentIntentId = paymentIntent;
      }
      if (nextStatus === "paid") {
        updateData.status = "paid";
        updateData.paidAt = new Date().toISOString();
      }

      await payload.update({
        collection: "orders",
        id: orderId,
        data: updateData,
        overrideAccess: true,
        req: {
          headers: new Headers({
            "x-internal-payment": "stripe",
          }),
        } as any,
      });

      return NextResponse.json(
        { success: true, orderId, paymentStatus: nextStatus, type: event.type },
        { status: 200 }
      );
    }

    if (!isWebhookAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const data = await request.json().catch(() => null);
    const orderId = data?.orderId ? String(data.orderId).trim() : "";
    if (!orderId) {
      return NextResponse.json({ success: false, error: "Missing orderId." }, { status: 400 });
    }

    const paymentStatus = normalizePaymentStatus(data?.status ?? data?.paymentStatus);
    const paymentProvider =
      typeof data?.provider === "string" ? data.provider : data?.paymentProvider;
    const paymentIntentId =
      typeof data?.paymentIntentId === "string" ? data.paymentIntentId : undefined;

    const order = await payload.findByID({
      collection: "orders",
      id: orderId,
      depth: 0,
      overrideAccess: true,
    });
    if (!order) {
      return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
    }

    const currentPaymentStatus = normalizePaymentStatus(order?.paymentStatus);
    const currentProvider = normalizeProvider(order?.paymentProvider);
    const currentIntentId =
      typeof order?.paymentIntentId === "string" ? order.paymentIntentId.trim() : "";
    const normalizedIncomingProvider = normalizeProvider(paymentProvider);
    const incomingOrderStatus = normalizeOrderStatus(order?.status);
    const sameProvider =
      !normalizedIncomingProvider || currentProvider === normalizedIncomingProvider;
    const sameIntent = !paymentIntentId || currentIntentId === paymentIntentId;
    const paidStateAlreadyApplied =
      paymentStatus !== "paid" ||
      ((incomingOrderStatus === "paid" || incomingOrderStatus === "completed") &&
        Boolean(order?.paidAt));
    const isDuplicateNonStripeEvent =
      currentPaymentStatus === paymentStatus && sameProvider && sameIntent && paidStateAlreadyApplied;

    if (isDuplicateNonStripeEvent) {
      return NextResponse.json(
        { success: true, ignored: true, reason: "duplicate_event", orderId, paymentStatus },
        { status: 200 }
      );
    }

    const updateData: Record<string, unknown> = {
      paymentStatus,
      ...(paymentProvider ? { paymentProvider } : {}),
      ...(paymentIntentId ? { paymentIntentId } : {}),
    };

    if (paymentStatus === "paid") {
      updateData.status = "paid";
      updateData.paidAt = new Date().toISOString();
    }

    await payload.update({
      collection: "orders",
      id: orderId,
      data: updateData,
      overrideAccess: true,
    });

    return NextResponse.json({ success: true, orderId, paymentStatus }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Webhook failed." },
      { status: 500 }
    );
  }
}

