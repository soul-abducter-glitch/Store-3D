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

const normalizePaymentStatus = (value?: string) => {
  if (!value) return "pending";
  const raw = String(value).trim().toLowerCase();
  if (raw === "paid" || raw === "success") return "paid";
  if (raw === "failed" || raw === "error") return "failed";
  if (raw === "refunded" || raw === "refund") return "refunded";
  return "pending";
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

export async function POST(request: NextRequest) {
  try {
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

    const updateData: Record<string, unknown> = {
      paymentStatus,
      ...(paymentProvider ? { paymentProvider } : {}),
      ...(paymentIntentId ? { paymentIntentId } : {}),
    };

    if (paymentStatus === "paid") {
      updateData.status = "paid";
      updateData.paidAt = new Date().toISOString();
    }

    const payload = await getPayload();
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
