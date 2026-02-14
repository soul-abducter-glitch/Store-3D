import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { refundUserAiCredits } from "@/lib/aiCredits";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { resolveServerPaymentsMode } from "@/lib/paymentsMode";
import { getAiPlanByPriceId, normalizeAiPlanCode } from "@/lib/aiSubscriptionConfig";
import {
  finalizeProcessedWebhookEvent,
  findAiSubscriptionByStripeCustomerId,
  findAiSubscriptionByStripeSubscriptionId,
  normalizeRelationshipId,
  reserveProcessedWebhookEvent,
  toIsoFromUnixSeconds,
  upsertAiSubscriptionRecord,
} from "@/lib/aiSubscriptions";
import {
  isYookassaWebhookAuthorized,
  resolveYookassaConfig,
  yookassaAmountToMinor,
} from "@/lib/yookassa";

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

const toPositiveInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
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

const mapYookassaEventToStatus = (eventType: string) => {
  if (eventType === "payment.succeeded") return "paid";
  if (eventType === "payment.canceled") return "failed";
  if (eventType === "payment.waiting_for_capture") return "pending";
  return null;
};

const parseJsonSafe = (value?: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const hasTopupIdempotencyEvent = async (payload: any, idempotencyKey: string) => {
  if (!idempotencyKey) return false;
  const found = await payload.find({
    collection: "ai_token_events",
    depth: 0,
    limit: 1,
    sort: "-createdAt",
    overrideAccess: true,
    where: {
      and: [
        {
          reason: {
            equals: "topup",
          },
        },
        {
          idempotencyKey: {
            equals: idempotencyKey,
          },
        },
      ],
    },
  });
  return Boolean(found?.docs?.[0]);
};

const handleStripeTopupWebhook = async (payload: any, event: Stripe.Event) => {
  if (event.type !== "checkout.session.completed") {
    return null;
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const meta = (session.metadata || {}) as Record<string, string>;
  const kind = String(meta.kind || "").trim().toLowerCase();
  if (kind !== "ai_token_topup") {
    return null;
  }

  await ensureAiLabSchemaOnce(payload as any);

  const paid =
    String(session.payment_status || "").trim().toLowerCase() === "paid" ||
    String(session.status || "").trim().toLowerCase() === "complete";
  if (!paid) {
    return NextResponse.json(
      { success: true, ignored: true, reason: "topup_not_paid", type: event.type },
      { status: 200 }
    );
  }

  const userId = normalizeRelationshipId(meta.userId);
  const credits = toPositiveInt(meta.credits, 0);
  const packId = String(meta.packId || "").trim().toLowerCase();

  if (!userId || !credits || !packId) {
    return NextResponse.json(
      {
        success: true,
        ignored: true,
        reason: "topup_metadata_missing",
        type: event.type,
      },
      { status: 200 }
    );
  }

  const idempotencyKey = `stripe_topup_session:${session.id}`;
  const isDuplicate = await hasTopupIdempotencyEvent(payload, idempotencyKey);
  if (isDuplicate) {
    return NextResponse.json(
      {
        success: true,
        ignored: true,
        reason: "duplicate_topup_event",
        type: event.type,
        sessionId: session.id,
      },
      { status: 200 }
    );
  }

  const tokens = await refundUserAiCredits(payload as any, userId, credits, {
    reason: "topup",
    source: "ai_tokens:topup_stripe",
    referenceId: session.id,
    idempotencyKey,
    meta: {
      provider: "stripe",
      eventId: event.id,
      checkoutSessionId: session.id,
      paymentIntentId:
        typeof session.payment_intent === "string" ? session.payment_intent : undefined,
      customerEmail: session.customer_details?.email || session.customer_email || undefined,
      livemode: Boolean(session.livemode),
      packId,
      credits,
      requestIdempotencyKey: meta.requestIdempotencyKey || undefined,
    },
  });

  return NextResponse.json(
    {
      success: true,
      topup: true,
      sessionId: session.id,
      creditsAdded: credits,
      tokens,
      type: event.type,
    },
    { status: 200 }
  );
};

const extractStripeCustomerId = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof (value as any).id === "string") {
    return String((value as any).id).trim();
  }
  return "";
};

const extractStripeSubscriptionId = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof (value as any).id === "string") {
    return String((value as any).id).trim();
  }
  return "";
};

const extractInvoicePriceId = (invoice: Stripe.Invoice) => {
  const lines = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
  for (const line of lines) {
    const price = (line as any)?.price;
    const recurring = price?.recurring;
    if (!price?.id) continue;
    if (!recurring || recurring.interval === "month") {
      return String(price.id).trim();
    }
  }
  return "";
};

const mapStripeSubscriptionStatus = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "active") return "active" as const;
  if (raw === "past_due") return "past_due" as const;
  if (raw === "canceled" || raw === "cancelled") return "canceled" as const;
  if (raw === "incomplete") return "incomplete" as const;
  return "incomplete" as const;
};

const resolveUserIdForStripeSubscription = async (
  payload: any,
  input: {
    metadata?: Record<string, unknown> | null;
    customerId?: string;
    subscriptionId?: string;
  }
) => {
  const metadataUser = normalizeRelationshipId(input.metadata?.userId);
  if (metadataUser) return metadataUser;

  if (input.subscriptionId) {
    const bySubscription = await findAiSubscriptionByStripeSubscriptionId(
      payload as any,
      input.subscriptionId
    );
    const userId = normalizeRelationshipId(bySubscription?.user);
    if (userId) return userId;
  }

  if (input.customerId) {
    const byCustomer = await findAiSubscriptionByStripeCustomerId(payload as any, input.customerId);
    const userId = normalizeRelationshipId(byCustomer?.user);
    if (userId) return userId;
  }

  return null;
};

const handleStripeSubscriptionWebhook = async (payload: any, event: Stripe.Event) => {
  const type = String(event.type || "").trim();
  if (
    type !== "checkout.session.completed" &&
    type !== "invoice.paid" &&
    type !== "invoice.payment_failed" &&
    type !== "customer.subscription.updated" &&
    type !== "customer.subscription.deleted"
  ) {
    return null;
  }

  if (type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (String(session.mode || "").trim().toLowerCase() !== "subscription") {
      return null;
    }
    const metadata = (session.metadata || {}) as Record<string, string>;
    const userId = await resolveUserIdForStripeSubscription(payload, {
      metadata,
      customerId: extractStripeCustomerId(session.customer),
      subscriptionId: extractStripeSubscriptionId(session.subscription),
    });
    if (!userId) {
      return NextResponse.json(
        {
          success: true,
          ignored: true,
          reason: "subscription_user_not_found",
          type,
        },
        { status: 200 }
      );
    }

    const stripeSubscriptionId = extractStripeSubscriptionId(session.subscription);
    const stripeCustomerId = extractStripeCustomerId(session.customer);
    const planCode = normalizeAiPlanCode(metadata.planCode);

    await upsertAiSubscriptionRecord(payload as any, {
      userId,
      stripeCustomerId: stripeCustomerId || null,
      stripeSubscriptionId: stripeSubscriptionId || null,
      planCode: planCode || null,
      status: "incomplete",
      meta: {
        checkoutSessionId: session.id,
        eventId: event.id,
        livemode: Boolean(session.livemode),
      },
    });

    return NextResponse.json(
      {
        success: true,
        subscription: true,
        type,
      },
      { status: 200 }
    );
  }

  if (type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const invoiceAny = invoice as any;
    const stripeSubscriptionId = extractStripeSubscriptionId(invoiceAny?.subscription);
    const stripeCustomerId = extractStripeCustomerId(invoiceAny?.customer);
    const priceId = extractInvoicePriceId(invoice);
    const plan = getAiPlanByPriceId(priceId);
    if (!plan) {
      return NextResponse.json(
        {
          success: true,
          ignored: true,
          reason: "subscription_plan_not_mapped",
          type,
          priceId,
        },
        { status: 200 }
      );
    }

    const userId = await resolveUserIdForStripeSubscription(payload, {
      metadata: (invoice.metadata || {}) as Record<string, string>,
      customerId: stripeCustomerId,
      subscriptionId: stripeSubscriptionId,
    });
    if (!userId) {
      return NextResponse.json(
        {
          success: true,
          ignored: true,
          reason: "subscription_user_not_found",
          type,
        },
        { status: 200 }
      );
    }

    const monthlyTokens = Math.max(0, Math.trunc(plan.monthlyTokens));
    const tokenIdempotencyKey = `stripe_subscription_invoice:${invoice.id}`;
    const tokens = await refundUserAiCredits(payload as any, userId, monthlyTokens, {
      reason: "topup",
      source: "subscription_cycle",
      referenceId: String(invoice.id || ""),
      idempotencyKey: tokenIdempotencyKey,
      meta: {
        provider: "stripe",
        eventId: event.id,
        invoiceId: invoiceAny?.id,
        stripeSubscriptionId,
        stripeCustomerId,
        stripePriceId: priceId,
        planCode: plan.code,
        billingReason: String(invoiceAny?.billing_reason || ""),
        livemode: Boolean(invoiceAny?.livemode),
      },
    });

    await upsertAiSubscriptionRecord(payload as any, {
      userId,
      stripeCustomerId: stripeCustomerId || null,
      stripeSubscriptionId: stripeSubscriptionId || null,
      stripePriceId: priceId || null,
      planCode: plan.code,
      status: "active",
      currentPeriodStart: toIsoFromUnixSeconds(invoiceAny?.period_start),
      currentPeriodEnd: toIsoFromUnixSeconds(invoiceAny?.period_end),
      cancelAtPeriodEnd: false,
      lastInvoiceId: String(invoiceAny?.id || ""),
      meta: {
        eventId: event.id,
        billingReason: String(invoiceAny?.billing_reason || ""),
      },
    });

    return NextResponse.json(
      {
        success: true,
        subscription: true,
        type,
        tokens,
        creditsAdded: monthlyTokens,
      },
      { status: 200 }
    );
  }

  if (type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const invoiceAny = invoice as any;
    const stripeSubscriptionId = extractStripeSubscriptionId(invoiceAny?.subscription);
    const stripeCustomerId = extractStripeCustomerId(invoiceAny?.customer);
    const userId = await resolveUserIdForStripeSubscription(payload, {
      metadata: (invoice.metadata || {}) as Record<string, string>,
      customerId: stripeCustomerId,
      subscriptionId: stripeSubscriptionId,
    });
    if (!userId) {
      return NextResponse.json(
        {
          success: true,
          ignored: true,
          reason: "subscription_user_not_found",
          type,
        },
        { status: 200 }
      );
    }

    await upsertAiSubscriptionRecord(payload as any, {
      userId,
      stripeCustomerId: stripeCustomerId || null,
      stripeSubscriptionId: stripeSubscriptionId || null,
      status: "past_due",
      currentPeriodStart: toIsoFromUnixSeconds(invoiceAny?.period_start),
      currentPeriodEnd: toIsoFromUnixSeconds(invoiceAny?.period_end),
      lastInvoiceId: String(invoiceAny?.id || ""),
      meta: {
        eventId: event.id,
        paymentFailed: true,
      },
    });

    return NextResponse.json(
      {
        success: true,
        subscription: true,
        type,
        status: "past_due",
      },
      { status: 200 }
    );
  }

  const subscription = event.data.object as Stripe.Subscription;
  const subscriptionAny = subscription as any;
  const stripeSubscriptionId = toNonEmptyString(subscriptionAny?.id);
  const stripeCustomerId = extractStripeCustomerId(subscriptionAny?.customer);
  const userId = await resolveUserIdForStripeSubscription(payload, {
    metadata: (subscriptionAny?.metadata || {}) as Record<string, string>,
    customerId: stripeCustomerId,
    subscriptionId: stripeSubscriptionId,
  });
  if (!userId) {
    return NextResponse.json(
      {
        success: true,
        ignored: true,
        reason: "subscription_user_not_found",
        type,
      },
      { status: 200 }
    );
  }

  const firstItem = Array.isArray(subscriptionAny?.items?.data) ? subscriptionAny.items.data[0] : null;
  const stripePriceId = toNonEmptyString(firstItem?.price?.id);
  const mappedPlan = getAiPlanByPriceId(stripePriceId);
  const fallbackPlanCode = normalizeAiPlanCode((subscriptionAny?.metadata || {}).planCode);
  const planCode = mappedPlan?.code || fallbackPlanCode || null;
  const status =
    type === "customer.subscription.deleted"
      ? "canceled"
      : mapStripeSubscriptionStatus(subscriptionAny?.status);

  await upsertAiSubscriptionRecord(payload as any, {
    userId,
    stripeCustomerId: stripeCustomerId || null,
    stripeSubscriptionId: stripeSubscriptionId || null,
    stripePriceId: stripePriceId || null,
    planCode,
    status,
    currentPeriodStart: toIsoFromUnixSeconds(subscriptionAny?.current_period_start),
    currentPeriodEnd: toIsoFromUnixSeconds(subscriptionAny?.current_period_end),
    cancelAtPeriodEnd: Boolean(subscriptionAny?.cancel_at_period_end),
    meta: {
      eventId: event.id,
      canceledAt: toIsoFromUnixSeconds(subscriptionAny?.canceled_at),
      endedAt: toIsoFromUnixSeconds(subscriptionAny?.ended_at),
    },
  });

  return NextResponse.json(
    {
      success: true,
      subscription: true,
      type,
      status,
    },
    { status: 200 }
  );
};

const handleYookassaWebhook = async (
  payload: any,
  eventType: string,
  paymentObject: any
) => {
  const nextStatus = mapYookassaEventToStatus(eventType);
  if (!nextStatus) {
    return NextResponse.json(
      { success: true, ignored: true, type: eventType },
      { status: 200 }
    );
  }

  const paymentIntentId =
    typeof paymentObject?.id === "string" ? paymentObject.id.trim() : "";
  const metadataOrderId =
    typeof paymentObject?.metadata?.orderId === "string"
      ? paymentObject.metadata.orderId.trim()
      : "";
  const orderId =
    metadataOrderId || (await resolveOrderIdFromIntent(payload, paymentIntentId || ""));

  if (!orderId) {
    return NextResponse.json(
      { success: true, ignored: true, reason: "order_not_found", type: eventType },
      { status: 200 }
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
      { success: true, ignored: true, reason: "order_not_found", type: eventType, orderId },
      { status: 200 }
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
      { success: true, ignored: true, reason: "order_terminal_status", orderId, type: eventType },
      { status: 200 }
    );
  }

  if (nextStatus === "paid") {
    const expectedAmount = resolveExpectedAmountCents(order);
    const paidAmount = yookassaAmountToMinor(
      typeof paymentObject?.amount?.value === "string" ? paymentObject.amount.value : undefined
    );
    const paidCurrency = String(paymentObject?.amount?.currency || "").trim().toLowerCase();

    if (paidCurrency && paidCurrency !== expectedCurrency) {
      return NextResponse.json(
        {
          success: true,
          ignored: true,
          reason: "currency_mismatch",
          orderId,
          paidCurrency,
          expectedCurrency,
          type: eventType,
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
          type: eventType,
        },
        { status: 200 }
      );
    }
  }

  const sameIntent = !paymentIntentId || currentIntentId === paymentIntentId;
  const paidStateAlreadyApplied =
    nextStatus !== "paid" ||
    ((orderStatus === "paid" || orderStatus === "completed") && Boolean(order?.paidAt));
  const isDuplicateEvent =
    currentPaymentStatus === nextStatus &&
    currentProvider === "yookassa" &&
    sameIntent &&
    paidStateAlreadyApplied;

  if (isDuplicateEvent) {
    return NextResponse.json(
      { success: true, ignored: true, reason: "duplicate_event", orderId, type: eventType },
      { status: 200 }
    );
  }

  const updateData: Record<string, unknown> = {
    paymentStatus: nextStatus,
    paymentProvider: "yookassa",
  };
  if (paymentIntentId) {
    updateData.paymentIntentId = paymentIntentId;
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
        "x-internal-payment": "yookassa",
      }),
    } as any,
  });

  return NextResponse.json(
    { success: true, orderId, paymentStatus: nextStatus, type: eventType },
    { status: 200 }
  );
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    const rawBody = await request.text();

    const stripeSignature = request.headers.get("stripe-signature") || "";
    if (stripeSignature) {
      if (!stripe || !stripeWebhookSecret) {
        return NextResponse.json(
          { success: false, error: "Stripe webhook is not configured." },
          { status: 401 }
        );
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, stripeSignature, stripeWebhookSecret);
      } catch (error: any) {
        return NextResponse.json(
          { success: false, error: error?.message || "Invalid stripe signature." },
          { status: 401 }
        );
      }

      await ensureAiLabSchemaOnce(payload as any);
      const reservation = await reserveProcessedWebhookEvent(payload as any, {
        provider: "stripe",
        eventId: String(event.id || ""),
        eventType: String(event.type || ""),
        meta: {
          livemode: Boolean(event.livemode),
          created: event.created,
        },
      });
      if (reservation.duplicate) {
        return NextResponse.json(
          { success: true, ignored: true, reason: "duplicate_webhook_event", type: event.type },
          { status: 200 }
        );
      }

      const processedWebhookId = reservation.record?.id ?? null;
      const finalizeFromResponse = async (response: NextResponse) => {
        const body = await response.clone().json().catch(() => null);
        const ignored = Boolean(body?.ignored);
        await finalizeProcessedWebhookEvent(
          payload as any,
          processedWebhookId,
          ignored ? "ignored" : "processed",
          {
            meta: {
              type: event.type,
              status: response.status,
              ignored,
              response: body,
            },
          }
        );
      };

      try {
        const stripeResponse = await (async () => {
          const topupResponse = await handleStripeTopupWebhook(payload, event);
          if (topupResponse) {
            return topupResponse;
          }

          const subscriptionResponse = await handleStripeSubscriptionWebhook(payload, event);
          if (subscriptionResponse) {
            return subscriptionResponse;
          }

          const nextStatus = mapStripeEventToStatus(event.type);
          if (!nextStatus) {
            return NextResponse.json(
              { success: true, ignored: true, type: event.type },
              { status: 200 }
            );
          }

          const paymentIntent =
            event.type === "charge.refunded"
              ? ((event.data.object as Stripe.Charge).payment_intent as string | null)
              : ((event.data.object as Stripe.PaymentIntent).id || null);
          const paymentIntentObject =
            event.type === "payment_intent.succeeded" ||
            event.type === "payment_intent.payment_failed"
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
        })();

        await finalizeFromResponse(stripeResponse);
        return stripeResponse;
      } catch (error: any) {
        await finalizeProcessedWebhookEvent(payload as any, processedWebhookId, "failed", {
          failureReason: error?.message || "Unhandled stripe webhook error.",
          meta: {
            type: event.type,
          },
        });
        throw error;
      }
    }

    const jsonBody = parseJsonSafe(rawBody);
    const yookassaEventType =
      typeof jsonBody?.event === "string" ? jsonBody.event.trim().toLowerCase() : "";
    const yookassaObject =
      jsonBody?.object && typeof jsonBody.object === "object" ? jsonBody.object : null;
    const looksLikeYookassa = Boolean(yookassaEventType.startsWith("payment.") && yookassaObject);

    if (looksLikeYookassa) {
      const paymentsMode = resolveServerPaymentsMode();
      if (paymentsMode !== "yookassa") {
        return NextResponse.json(
          { success: true, ignored: true, reason: "payments_mode_mismatch", type: yookassaEventType },
          { status: 200 }
        );
      }

      const yookassaConfig = resolveYookassaConfig();
      if (!yookassaConfig.shopId || !yookassaConfig.secretKey) {
        return NextResponse.json(
          { success: false, error: "YooKassa webhook received but credentials are missing." },
          { status: 500 }
        );
      }

      if (!isYookassaWebhookAuthorized(request, yookassaConfig)) {
        return NextResponse.json(
          { success: false, error: "Unauthorized YooKassa webhook." },
          { status: 401 }
        );
      }

      return handleYookassaWebhook(payload, yookassaEventType, yookassaObject);
    }

    if (!isWebhookAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const data = jsonBody && typeof jsonBody === "object" ? jsonBody : {};
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
