import { randomUUID } from "crypto";
import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { resolveServerPaymentsMode } from "@/lib/paymentsMode";

export const dynamic = "force-dynamic";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const buildIntentId = () => `mock_${randomUUID().slice(0, 12)}`;

const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
const stripe = stripeSecretKey !== "" ? new Stripe(stripeSecretKey) : null;

const deliveryCostMap: Record<string, number> = {
  cdek: 200,
  yandex: 150,
  ozon: 100,
  pochta: 250,
  pickup: 0,
};

const resolveOrderAmount = (order: any) => {
  const baseTotal =
    typeof order?.total === "number" && Number.isFinite(order.total)
      ? order.total
      : 0;
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

const isStripePaymentIntentId = (value?: unknown) =>
  typeof value === "string" && value.trim().startsWith("pi_");

const REUSABLE_STRIPE_STATUSES = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
]);

const normalizeEmail = (value?: string) => {
  if (!value) return "";
  return value.trim().toLowerCase();
};

const normalizeRelationshipId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  const base = raw.split(":")[0].trim();
  if (!base || /\s/.test(base)) {
    return null;
  }
  if (/^\d+$/.test(base)) {
    return Number(base);
  }
  return base;
};

const extractRelationshipId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const candidate =
      (value as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (value as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (value as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
    return normalizeRelationshipId(candidate);
  }
  return normalizeRelationshipId(value);
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    let authUser: any = null;
    try {
      const authResult = await payload.auth({ headers: request.headers });
      authUser = authResult?.user ?? null;
    } catch {
      authUser = null;
    }
    if (!authUser) {
      return NextResponse.json(
        { success: false, error: "Unauthorized." },
        { status: 401 }
      );
    }

    const data = await request.json().catch(() => null);
    const orderId = data?.orderId ? String(data.orderId).trim() : "";
    if (!orderId) {
      return NextResponse.json({ success: false, error: "Missing orderId." }, { status: 400 });
    }

    const order = await payload.findByID({
      collection: "orders",
      id: orderId,
      depth: 0,
      overrideAccess: true,
    });

    if (!order) {
      return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
    }

    const orderStatus = normalizeOrderStatus(order?.status);
    if (orderStatus === "cancelled" || orderStatus === "canceled") {
      return NextResponse.json(
        { success: false, error: "Order is cancelled." },
        { status: 409 }
      );
    }
    if (orderStatus === "completed") {
      return NextResponse.json(
        { success: false, error: "Order is already completed." },
        { status: 409 }
      );
    }

    const userId = authUser?.id ? String(authUser.id) : "";
    const orderUser = extractRelationshipId(order?.user);
    const orderUserId = orderUser !== null ? String(orderUser) : "";
    const orderEmail = normalizeEmail(order?.customer?.email);
    const userEmail = normalizeEmail(authUser?.email);
    const isOwner = (userId && orderUserId === userId) || (userEmail && orderEmail === userEmail);
    if (!isOwner) {
      return NextResponse.json(
        { success: false, error: "Forbidden." },
        { status: 403 }
      );
    }

    const paymentsMode = resolveServerPaymentsMode();
    if (paymentsMode === "off") {
      return NextResponse.json(
        {
          success: true,
          orderId,
          paymentStatus: "paid",
          paymentIntentId: order.paymentIntentId ?? null,
        },
        { status: 200 }
      );
    }

    if (paymentsMode === "stripe") {
      if (!stripe) {
        return NextResponse.json(
          { success: false, error: "Stripe secret key is not configured." },
          { status: 500 }
        );
      }
      const currentPaymentStatus = String(order?.paymentStatus || "pending").toLowerCase();
      if (currentPaymentStatus === "paid") {
        return NextResponse.json(
          {
            success: true,
            orderId,
            paymentStatus: "paid",
            paymentIntentId:
              typeof order?.paymentIntentId === "string" ? order.paymentIntentId : null,
          },
          { status: 200 }
        );
      }

      const existingPaymentIntentId =
        typeof order?.paymentIntentId === "string" ? order.paymentIntentId.trim() : "";
      if (isStripePaymentIntentId(existingPaymentIntentId)) {
        try {
          const existingIntent = await stripe.paymentIntents.retrieve(existingPaymentIntentId);
          if (existingIntent.status === "succeeded") {
            await payload.update({
              collection: "orders",
              id: orderId,
              data: {
                paymentStatus: "paid",
                paymentProvider: "stripe",
                paymentIntentId: existingIntent.id,
                paidAt: new Date().toISOString(),
              },
              overrideAccess: true,
              req: {
                headers: new Headers({
                  "x-internal-payment": "stripe",
                }),
              } as any,
            });

            return NextResponse.json(
              {
                success: true,
                orderId,
                paymentStatus: "paid",
                paymentIntentId: existingIntent.id,
              },
              { status: 200 }
            );
          }

          if (
            REUSABLE_STRIPE_STATUSES.has(existingIntent.status) &&
            existingIntent.client_secret
          ) {
            await payload.update({
              collection: "orders",
              id: orderId,
              data: {
                paymentStatus: "pending",
                paymentProvider: "stripe",
                paymentIntentId: existingIntent.id,
              },
              overrideAccess: true,
            });

            return NextResponse.json(
              {
                success: true,
                orderId,
                paymentStatus: "pending",
                paymentIntentId: existingIntent.id,
                clientSecret: existingIntent.client_secret,
              },
              { status: 200 }
            );
          }
        } catch {
          // Failed to reuse existing intent, create a new one below.
        }
      }

      const amount = resolveOrderAmount(order);
      if (!amount) {
        return NextResponse.json(
          { success: false, error: "Order total is invalid." },
          { status: 400 }
        );
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "rub",
        receipt_email: order?.customer?.email ?? undefined,
        metadata: { orderId },
      });

      await payload.update({
        collection: "orders",
        id: orderId,
        data: {
          paymentStatus: "pending",
          paymentProvider: "stripe",
          paymentIntentId: paymentIntent.id,
        },
        overrideAccess: true,
      });

      return NextResponse.json(
        {
          success: true,
          orderId,
          paymentStatus: "pending",
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
        },
        { status: 200 }
      );
    }

    const paymentIntentId = order.paymentIntentId ?? buildIntentId();
    await payload.update({
      collection: "orders",
      id: orderId,
      data: {
        paymentStatus: "pending",
        paymentProvider: "mock",
        paymentIntentId,
      },
      overrideAccess: true,
    });

    return NextResponse.json(
      {
        success: true,
        orderId,
        paymentStatus: "pending",
        paymentIntentId,
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to create intent." },
      { status: 500 }
    );
  }
}

