import { randomUUID } from "crypto";
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
  if (raw === "mock" || raw === "live") return raw;
  return "off";
};

const buildIntentId = () => `mock_${randomUUID().slice(0, 12)}`;

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
