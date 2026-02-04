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

const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
const stripe = stripeSecretKey !== "" ? new Stripe(stripeSecretKey) : null;

const normalizeEmail = (value?: string) => {
  if (!value) return "";
  return value.trim().toLowerCase();
};

export async function POST(request: NextRequest) {
  try {
    if (resolvePaymentsMode() !== "stripe") {
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

    const payload = await getPayload();
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
    if (!orderId || !paymentIntentId) {
      return NextResponse.json(
        { success: false, error: "Missing orderId or paymentIntentId." },
        { status: 400 }
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

    const userId = authUser?.id ? String(authUser.id) : "";
    const orderUserId = order?.user ? String(order.user) : "";
    const orderEmail = normalizeEmail(order?.customer?.email);
    const userEmail = normalizeEmail(authUser?.email);
    const isOwner = (userId && orderUserId === userId) || (userEmail && orderEmail === userEmail);

    if (!isOwner) {
      return NextResponse.json(
        { success: false, error: "Forbidden." },
        { status: 403 }
      );
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
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

    await payload.update({
      collection: "orders",
      id: orderId,
      data: {
        paymentStatus: "paid",
        status: "paid",
        paidAt: new Date().toISOString(),
        paymentProvider: "stripe",
        paymentIntentId,
      },
      overrideAccess: true,
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
