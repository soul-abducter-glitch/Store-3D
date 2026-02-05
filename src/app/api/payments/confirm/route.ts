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

const normalizeEmail = (value?: string) => {
  if (!value) return "";
  return value.trim().toLowerCase();
};

export async function POST(request: NextRequest) {
  try {
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
    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "Missing orderId." },
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

    const paymentsMode = resolvePaymentsMode();
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
        id: orderId,
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
