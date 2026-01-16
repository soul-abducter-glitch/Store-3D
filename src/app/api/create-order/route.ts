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

const normalizeEmail = (value?: string) => {
  if (!value) return "";
  return value.trim().toLowerCase();
};

const normalizePrintSpecs = (value: any) => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const dimensionsRaw = value.dimensions;
  const dimensions =
    dimensionsRaw && typeof dimensionsRaw === "object"
      ? {
          x: Number(dimensionsRaw.x) || 0,
          y: Number(dimensionsRaw.y) || 0,
          z: Number(dimensionsRaw.z) || 0,
        }
      : undefined;

  return {
    technology: typeof value.technology === "string" ? value.technology : undefined,
    material: typeof value.material === "string" ? value.material : undefined,
    quality: typeof value.quality === "string" ? value.quality : undefined,
    dimensions,
    volumeCm3: typeof value.volumeCm3 === "number" ? value.volumeCm3 : undefined,
  };
};

const normalizeOrderStatus = (value?: string) => {
  if (!value) return "paid";
  const raw = String(value);
  const normalized = raw.trim().toLowerCase();
  if (normalized === "paid" || raw === "Paid") return "paid";
  if (normalized === "accepted" || normalized === "in_progress") return "accepted";
  if (normalized === "printing" || raw === "Printing") return "printing";
  if (normalized === "ready" || raw === "Shipped") return "ready";
  if (normalized === "completed" || normalized === "done") return "completed";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  return "paid";
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload();
    const data = await request.json();
    const baseData =
      data && typeof data === "object"
        ? (() => {
            const next = { ...data } as Record<string, unknown>;
            delete next.user;
            return next;
          })()
        : {};

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
          const customerUpload = normalizeRelationshipId(
            item?.customerUpload ?? item?.customerUploadId ?? item?.customPrint?.uploadId
          );
          const printSpecs = normalizePrintSpecs(item?.printSpecs ?? item?.customPrint);

          return {
            product: productId,
            quantity,
            unitPrice,
            format,
            customerUpload: customerUpload ?? undefined,
            printSpecs,
          };
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

    const incomingCustomFile = normalizeRelationshipId(data?.customFile);
    const incomingSpecs = normalizePrintSpecs(data?.technicalSpecs);
    const orderData = {
      ...baseData,
      items,
      status: normalizeOrderStatus(data?.status),
      customFile: incomingCustomFile ?? undefined,
      technicalSpecs: incomingSpecs,
    };

    if (!orderData.customFile || !orderData.technicalSpecs) {
      const firstPrintItem = items.find((item) => item.customerUpload || item.printSpecs);
      if (firstPrintItem) {
        if (!orderData.customFile && firstPrintItem.customerUpload) {
          orderData.customFile = firstPrintItem.customerUpload;
        }
        if (!orderData.technicalSpecs && firstPrintItem.printSpecs) {
          orderData.technicalSpecs = {
            material: firstPrintItem.printSpecs.material,
            dimensions: firstPrintItem.printSpecs.dimensions,
            volumeCm3: firstPrintItem.printSpecs.volumeCm3,
          };
        }
      }
    }

    const rawCustomerEmail =
      typeof orderData?.customer?.email === "string" ? orderData.customer.email : "";
    const customerEmail = normalizeEmail(rawCustomerEmail);
    if (orderData?.customer && customerEmail) {
      orderData.customer.email = customerEmail;
    }

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

    for (const item of items) {
      if (!item.customerUpload) {
        continue;
      }
      try {
        await payload.findByID({
          collection: "media",
          id: item.customerUpload as any,
          depth: 0,
          overrideAccess: true,
        });
      } catch {
        return NextResponse.json(
          {
            success: false,
            error: `Customer upload ${String(item.customerUpload)} not found.`,
          },
          { status: 400 }
        );
      }
    }

    if (orderData.customFile) {
      try {
        await payload.findByID({
          collection: "media",
          id: orderData.customFile as any,
          depth: 0,
          overrideAccess: true,
        });
      } catch {
        return NextResponse.json(
          {
            success: false,
            error: `Custom file ${String(orderData.customFile)} not found.`,
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
