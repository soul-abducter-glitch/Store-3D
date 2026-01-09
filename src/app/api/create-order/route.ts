import { NextResponse, type NextRequest } from "next/server";
import { getPayloadHMR } from "@payloadcms/next/utilities";

import payloadConfig from "../../../../payload.config";
import { importMap } from "../../(payload)/admin/importMap";

export const dynamic = "force-dynamic";

const getPayload = async () =>
  getPayloadHMR({
    config: payloadConfig,
    importMap,
  });

const normalizeRelationshipId = (value: unknown) => {
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

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload();
    const data = await request.json();

    const rawItems = Array.isArray(data?.items) ? data.items : [];
    const items =
      rawItems
        .map((item: any) => {
          const productId = normalizeRelationshipId(item?.product);
          if (!productId) return null;
          const quantity =
            typeof item?.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
          const unitPrice =
            typeof item?.unitPrice === "number" && item.unitPrice >= 0 ? item.unitPrice : 0;
          const format = item?.format === "Physical" ? "Physical" : "Digital";

          return { product: productId, quantity, unitPrice, format };
        })
        .filter(Boolean) ?? [];

    if (items.length === 0) {
      return NextResponse.json(
        { success: false, error: "Order must contain at least one valid item." },
        { status: 400 }
      );
    }

    if (items.length !== rawItems.length) {
      return NextResponse.json(
        { success: false, error: "Order contains invalid product references." },
        { status: 400 }
      );
    }

    const orderData = {
      ...data,
      items,
    };

    // Verify referenced products exist to avoid relationship validation errors
    for (const item of items) {
      try {
        await payload.findByID({
          collection: "products",
          id: item.product as any,
          depth: 0,
          overrideAccess: true,
        });
      } catch {
        return NextResponse.json(
          {
            success: false,
            error: `Product ${String(item.product)} not found.`,
          },
          { status: 400 }
        );
      }
    }

    console.log("=== Create Order API Called ===");
    console.log("Request data:", JSON.stringify(orderData, null, 2));

    // Debug: Check items structure
    if (orderData.items && Array.isArray(orderData.items)) {
      console.log("Items count:", orderData.items.length);
      orderData.items.forEach((item: any, index: number) => {
        console.log(`Item ${index}:`, JSON.stringify(item, null, 2));
      });
    }

    // Create order using Payload Local API
    const result = await payload.create({
      collection: "orders",
      data: orderData,
      overrideAccess: false, // Use normal access control
    });

    console.log("Order created successfully:", result.id);

    return NextResponse.json({ success: true, doc: result }, { status: 201 });
  } catch (error: any) {
    console.error("=== Create Order Error ===");
    console.error("Error:", error);
    console.error("Error details:", error.data || error.message || error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to create order",
        details: error.data || {},
      },
      { status: 400 }
    );
  }
}
