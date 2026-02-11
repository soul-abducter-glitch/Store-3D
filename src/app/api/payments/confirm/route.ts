import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { resolveServerPaymentsMode } from "@/lib/paymentsMode";

export const dynamic = "force-dynamic";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizePaymentStatus = (value?: string) => {
  if (!value) return "pending";
  const raw = String(value).trim().toLowerCase();
  if (raw === "paid" || raw === "success") return "paid";
  if (raw === "failed" || raw === "error") return "failed";
  if (raw === "refunded" || raw === "refund") return "refunded";
  return "pending";
};

const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
const stripe = stripeSecretKey !== "" ? new Stripe(stripeSecretKey) : null;
const expectedCurrency = (process.env.PAYMENTS_CURRENCY || "rub").trim().toLowerCase();

const deliveryCostMap: Record<string, number> = {
  cdek: 200,
  yandex: 150,
  ozon: 100,
  pochta: 250,
  pickup: 0,
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
    const paymentIntentId = data?.paymentIntentId
      ? String(data.paymentIntentId).trim()
      : "";
    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "Missing orderId." },
        { status: 400 }
      );
    }

    const normalizedOrderId = normalizeRelationshipId(orderId);
    if (normalizedOrderId === null) {
      return NextResponse.json(
        { success: false, error: "Invalid orderId." },
        { status: 400 }
      );
    }

    let order: any = null;
    try {
      order = await payload.findByID({
        collection: "orders",
        id: normalizedOrderId,
        depth: 0,
        overrideAccess: true,
      });
    } catch (error: any) {
      const message = String(error?.message || "").toLowerCase();
      if (message.includes("not found")) {
        order = null;
      } else {
        throw error;
      }
    }

    if (!order) {
      return NextResponse.json(
        { success: false, error: "Order not found." },
        { status: 404 }
      );
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
    if (paymentsMode === "mock") {
      const status = normalizePaymentStatus(data?.status ?? data?.paymentStatus);
      const updateData: Record<string, unknown> = {
        paymentStatus: status,
        paymentProvider: "mock",
      };
      if (status === "paid") {
        updateData.paidAt = new Date().toISOString();
      }

      await payload.update({
        collection: "orders",
        id: order.id,
        data: updateData,
        overrideAccess: true,
        req: {
          user: authUser ?? undefined,
          headers: new Headers({
            "x-internal-payment": "mock",
          }),
        } as any,
      });

      return NextResponse.json(
        { success: true, orderId, paymentStatus: status },
        { status: 200 }
      );
    }

    if (paymentsMode !== "stripe") {
      return NextResponse.json(
        { success: false, error: "Stripe mode is disabled." },
        { status: 400 }
      );
    }
    if (!stripe) {
      return NextResponse.json(
        { success: false, error: "Stripe secret key is missing." },
        { status: 500 }
      );
    }

    if (!paymentIntentId) {
      return NextResponse.json(
        { success: false, error: "Missing paymentIntentId." },
        { status: 400 }
      );
    }

    const storedIntentId =
      typeof order?.paymentIntentId === "string" ? order.paymentIntentId : "";
    if (storedIntentId && storedIntentId !== paymentIntentId) {
      return NextResponse.json(
        { success: false, error: "Payment intent does not match order." },
        { status: 400 }
      );
    }

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error: any) {
      const message = error?.message || "Stripe request failed.";
      const code = error?.code || error?.type;
      const statusCode =
        typeof error?.statusCode === "number" ? error.statusCode : 400;
      return NextResponse.json(
        { success: false, error: message, stripeCode: code },
        { status: statusCode }
      );
    }
    if (paymentIntent.metadata?.orderId && paymentIntent.metadata.orderId !== orderId) {
      return NextResponse.json(
        { success: false, error: "Payment does not match order." },
        { status: 400 }
      );
    }

    if (paymentIntent.status !== "succeeded") {
      return NextResponse.json(
        { success: false, error: `Payment status: ${paymentIntent.status}` },
        { status: 422 }
      );
    }

    const expectedAmount = resolveExpectedAmountCents(order);
    const paidAmount =
      typeof paymentIntent.amount_received === "number" && paymentIntent.amount_received > 0
        ? paymentIntent.amount_received
        : paymentIntent.amount;
    const paidCurrency = String(paymentIntent.currency || "").trim().toLowerCase();
    if (paidCurrency && paidCurrency !== expectedCurrency) {
      return NextResponse.json(
        {
          success: false,
          error: "Payment currency does not match order currency.",
          paidCurrency,
          expectedCurrency,
        },
        { status: 422 }
      );
    }
    if (expectedAmount > 0 && paidAmount < expectedAmount) {
      return NextResponse.json(
        {
          success: false,
          error: "Paid amount is less than order total.",
          paidAmount,
          expectedAmount,
        },
        { status: 422 }
      );
    }

    await payload.update({
      collection: "orders",
      id: order.id,
      data: {
        paymentStatus: "paid",
        status: "paid",
        paidAt: new Date().toISOString(),
        paymentProvider: "stripe",
        paymentIntentId,
      },
      overrideAccess: true,
      req: {
        user: authUser ?? undefined,
        headers: new Headers({
          "x-internal-payment": "stripe",
        }),
      } as any,
    });

    return NextResponse.json(
      { success: true, orderId, paymentStatus: "paid" },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to confirm payment." },
      { status: 500 }
    );
  }
}

