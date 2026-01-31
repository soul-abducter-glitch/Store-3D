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
  if (!value) return "accepted";
  const raw = String(value);
  const normalized = raw.trim().toLowerCase();
  if (normalized === "paid" || raw === "Paid") return "paid";
  if (normalized === "accepted" || normalized === "in_progress") return "accepted";
  if (normalized === "printing" || raw === "Printing") return "printing";
  if (normalized === "ready" || raw === "Shipped") return "ready";
  if (normalized === "completed" || normalized === "done") return "completed";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  return "accepted";
};

const resolvePaymentsMode = () => {
  const raw = (process.env.PAYMENTS_MODE || "off").trim().toLowerCase();
  if (raw === "mock" || raw === "live") return raw;
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

const normalizePaymentMethod = (value?: string) => {
  if (!value) return "card";
  const raw = String(value).trim().toLowerCase();
  if (raw === "sbp") return "sbp";
  if (raw === "cash" || raw === "cod") return "cash";
  return "card";
};

const NAME_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\\s'-]{1,49}$/;
const CITY_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\\s'.-]{1,49}$/;
const ADDRESS_REGEX = /^[A-Za-zА-Яа-яЁё\\s.,-]{3,120}$/;

const validateCustomerName = (value?: string) => {
  if (!value) return false;
  return NAME_REGEX.test(value.trim());
};

const validateCity = (value?: string) => {
  if (!value) return false;
  return CITY_REGEX.test(value.trim());
};

const validateAddress = (value?: string) => {
  if (!value) return false;
  return ADDRESS_REGEX.test(value.trim());
};

const PRINT_BASE_FEE = 350;
const PRINT_TECH_SURCHARGE: Record<string, number> = {
  "SLA Resin": 120,
  "FDM Plastic": 0,
};
const PRINT_MATERIAL_SURCHARGE: Record<string, number> = {
  "Tough Resin": 50,
  "Standard Resin": 0,
  "Standard PLA": 0,
  "ABS Pro": 60,
};
const PRINT_QUALITY_SURCHARGE: Record<string, number> = {
  pro: 100,
  standard: 0,
};

const normalizePrintTech = (value?: string) => {
  if (!value) return "SLA Resin";
  return value.toLowerCase().includes("fdm") ? "FDM Plastic" : "SLA Resin";
};

const normalizePrintQuality = (value?: string) => {
  if (!value) return "standard";
  const raw = value.toLowerCase();
  if (raw.includes("0.05") || raw.includes("pro")) return "pro";
  return "standard";
};

const normalizePrintMaterial = (value?: string, tech?: string) => {
  const resolvedTech = normalizePrintTech(tech);
  if (!value) {
    return resolvedTech === "SLA Resin" ? "Standard Resin" : "Standard PLA";
  }
  if (resolvedTech === "SLA Resin") {
    if (value === "Tough Resin" || value === "Standard Resin") return value;
    return "Standard Resin";
  }
  if (value === "Standard PLA" || value === "ABS Pro") return value;
  return "Standard PLA";
};

const resolvePrintPrice = (printSpecs?: {
  technology?: string;
  material?: string;
  quality?: string;
}) => {
  if (!printSpecs) return null;
  const tech = normalizePrintTech(printSpecs.technology);
  const material = normalizePrintMaterial(printSpecs.material, tech);
  const quality = normalizePrintQuality(printSpecs.quality);
  const techFee = PRINT_TECH_SURCHARGE[tech] ?? 0;
  const materialFee = PRINT_MATERIAL_SURCHARGE[material] ?? 0;
  const qualityFee = PRINT_QUALITY_SURCHARGE[quality] ?? 0;
  return Math.max(0, Math.round(PRINT_BASE_FEE + techFee + materialFee + qualityFee));
};

const collectDigitalProductIds = (items: Array<{ format?: string; product?: unknown }>) => {
  if (!Array.isArray(items)) return [];
  const ids = items
    .filter((item) => String(item?.format || "").toLowerCase().includes("digital"))
    .map((item) => normalizeRelationshipId(item?.product))
    .filter((id): id is string | number => id !== null)
    .map((id) => String(id));
  return Array.from(new Set(ids));
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
            delete next.items;
            delete next.status;
            delete next.total;
            delete next.paymentStatus;
            delete next.paymentMethod;
            delete next.paymentProvider;
            delete next.paymentIntentId;
            delete next.paidAt;
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
    const hasPhysical = items.some((item: { format?: string }) => item.format === "Physical");
    const paymentsMode = resolvePaymentsMode();
    const requestedPaymentMethod = normalizePaymentMethod(data?.paymentMethod);
    const paymentStatus = normalizePaymentStatus(
      paymentsMode === "off" ? "paid" : "pending"
    );
    const paymentMethod = hasPhysical ? requestedPaymentMethod : "card";
    const status =
      paymentStatus === "paid" && !hasPhysical ? "paid" : normalizeOrderStatus("accepted");
    const orderData = {
      ...baseData,
      items,
      status,
      paymentStatus,
      paymentMethod,
      customFile: incomingCustomFile ?? undefined,
      technicalSpecs: incomingSpecs,
    };

    if (!orderData.customFile || !orderData.technicalSpecs) {
      const firstPrintItem = items.find(
        (item: { customerUpload?: unknown; printSpecs?: unknown }) =>
          item.customerUpload || item.printSpecs
      );
      if (firstPrintItem) {
        if (!orderData.customFile && firstPrintItem.customerUpload) {
          orderData.customFile = firstPrintItem.customerUpload;
        }
        if (!orderData.technicalSpecs && firstPrintItem.printSpecs) {
          orderData.technicalSpecs = {
            technology: firstPrintItem.printSpecs.technology,
            material: firstPrintItem.printSpecs.material,
            quality: firstPrintItem.printSpecs.quality,
            dimensions: firstPrintItem.printSpecs.dimensions,
            volumeCm3: firstPrintItem.printSpecs.volumeCm3,
          };
        }
      }
    }

    const rawCustomerEmail =
      typeof (baseData as any)?.customer?.email === "string"
        ? (baseData as any).customer.email
        : "";
    const customerEmail = normalizeEmail(rawCustomerEmail);
    if ((baseData as any)?.customer && customerEmail) {
      (baseData as any).customer.email = customerEmail;
    }
    const rawCustomerName =
      typeof (baseData as any)?.customer?.name === "string"
        ? (baseData as any).customer.name
        : "";
    if (!validateCustomerName(rawCustomerName)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid customer name.",
        },
        { status: 400 }
      );
    }
    if (hasPhysical) {
      const rawCity =
        typeof (baseData as any)?.shipping?.city === "string"
          ? (baseData as any).shipping.city
          : "";
      const rawAddress =
        typeof (baseData as any)?.shipping?.address === "string"
          ? (baseData as any).shipping.address
          : "";
      if (!validateCity(rawCity)) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid shipping city.",
          },
          { status: 400 }
        );
      }
      if (!validateAddress(rawAddress)) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid shipping address.",
          },
          { status: 400 }
        );
      }
    }

    const productCache = new Map<string, any>();

    // Verify referenced products exist to avoid relationship validation errors
    for (const item of items) {
      try {
        const productDoc = await payload.findByID({
          collection: "products",
          id: item.product as any,
          depth: 0,
          overrideAccess: true,
        });
        productCache.set(String(productDoc?.id ?? item.product), productDoc);
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
        const mediaDoc = await payload.findByID({
          collection: "media",
          id: item.customerUpload as any,
          depth: 0,
          overrideAccess: true,
        });
        if (!mediaDoc?.isCustomerUpload) {
          return NextResponse.json(
            {
              success: false,
              error: `Customer upload ${String(item.customerUpload)} is not a customer file.`,
            },
            { status: 400 }
          );
        }
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
        const mediaDoc = await payload.findByID({
          collection: "media",
          id: orderData.customFile as any,
          depth: 0,
          overrideAccess: true,
        });
        if (!mediaDoc?.isCustomerUpload) {
          return NextResponse.json(
            {
              success: false,
              error: `Custom file ${String(orderData.customFile)} is not a customer upload.`,
            },
            { status: 400 }
          );
        }
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

    const normalizedItems = items.map(
      (item: {
        product: unknown;
        quantity?: number;
        unitPrice?: number;
        customerUpload?: unknown;
        printSpecs?: unknown;
      }) => {
      const productDoc = productCache.get(String(item.product));
      const productPrice =
        typeof productDoc?.price === "number" && productDoc.price >= 0
          ? productDoc.price
          : 0;
      const printPrice = resolvePrintPrice(
        item.printSpecs as { technology?: string; material?: string; quality?: string } | undefined
      );
      const unitPrice =
        item.customerUpload || item.printSpecs
          ? Math.max(productPrice, printPrice ?? productPrice)
          : productPrice;

      return {
        ...item,
        unitPrice,
      };
    });

    orderData.items = normalizedItems;

    // Create order using Payload Local API
    const result = await payload.create({
      collection: "orders",
      data: orderData,
      overrideAccess: false, // Use normal access control
    });

    try {
      const customerEmail = normalizeEmail((baseData as any)?.customer?.email);
      const isPaid =
        orderData?.paymentStatus === "paid" || orderData?.status === "paid";
      const digitalProductIds = collectDigitalProductIds(orderData.items || []);

      if (customerEmail && isPaid && digitalProductIds.length > 0) {
        const userResult = await payload.find({
          collection: "users",
          depth: 0,
          limit: 1,
          overrideAccess: true,
          where: {
            email: {
              equals: customerEmail,
            },
          },
        });
        const userDoc = userResult?.docs?.[0];
        if (userDoc?.id) {
          const existingRaw = Array.isArray((userDoc as any)?.purchasedProducts)
            ? (userDoc as any).purchasedProducts
            : [];
          const existing = existingRaw
            .map((id: any) => normalizeRelationshipId(id))
            .filter((id: string | number | null): id is string | number => id !== null)
            .map((id: string | number) => String(id));
          const merged = Array.from(new Set([...existing, ...digitalProductIds]));

          if (merged.length !== existing.length) {
            await payload.update({
              collection: "users",
              id: userDoc.id,
              data: { purchasedProducts: merged },
              overrideAccess: true,
            });
          }
        }
      }
    } catch (error) {
      console.warn("Failed to update purchasedProducts from create-order", error);
    }

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
