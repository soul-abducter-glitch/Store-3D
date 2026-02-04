import { randomUUID } from "crypto";
import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { getPayloadHMR } from "@payloadcms/next/utilities";

import payloadConfig from "../../../../../payload.config";
import { importMap } from "../../../(payload)/admin/importMap";

export const dynamic = "force-dynamic";

const getPayload = async () =>
  getPayloadHMR({
    config: payloadConfig,
    importMap,
  });

const resolvePaymentsMode = () => {
  const raw = (process.env.PAYMENTS_MODE || "off").trim().toLowerCase();
  if (raw === "mock" || raw === "live" || raw === "stripe") return raw;
  return "off";
};

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

export async function POST(request: NextRequest) {
  try {
    const data = await request.json().catch(() => null);
    const orderId = data?.orderId ? String(data.orderId).trim() : "";
    if (!orderId) {
      return NextResponse.json({ success: false, error: "Missing orderId." }, { status: 400 });
    }

    const payload = await getPayload();
    const order = await payload.findByID({
      collection: "orders",
      id: orderId,
      depth: 0,
      overrideAccess: true,
    });

    if (!order) {
      return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
    }

    const paymentsMode = resolvePaymentsMode();
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
