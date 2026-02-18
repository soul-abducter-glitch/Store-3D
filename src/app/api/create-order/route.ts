import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";
import { createHash } from "crypto";

import payloadConfig from "../../../../payload.config";
import {
  KNOWN_CITY_SET,
  normalizeCityInput,
  normalizeNameInput,
} from "@/lib/cities";
import { computePrintPrice } from "@/lib/printPricing";
import { applyPromoDiscountToItems, validatePromoCode } from "@/lib/promocodes";
import { evaluateStlPreflight } from "@/lib/stlPreflight";

export const dynamic = "force-dynamic";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

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

  const normalized: {
    technology?: string;
    material?: string;
    color?: string;
    quality?: string;
    note?: string;
    packaging?: string;
    dimensions?: { x: number; y: number; z: number };
    volumeCm3?: number;
    isHollow?: boolean;
    infillPercent?: number;
    orientationPreset?: {
      key?: string;
      label?: string;
      reason?: string;
      riskStatus?: string;
      riskScore?: number;
      etaMinutes?: number;
      materialUsageCm3?: number;
      estimatedPrice?: number;
    };
  } = {
    technology: typeof value.technology === "string" ? value.technology : undefined,
    material: typeof value.material === "string" ? value.material : undefined,
    color: typeof value.color === "string" ? value.color.slice(0, 64) : undefined,
    quality: typeof value.quality === "string" ? value.quality : undefined,
    note: typeof value.note === "string" ? value.note.slice(0, 400) : undefined,
    packaging: typeof value.packaging === "string" ? value.packaging.slice(0, 64) : undefined,
    dimensions,
    volumeCm3: typeof value.volumeCm3 === "number" ? value.volumeCm3 : undefined,
    isHollow: typeof value.isHollow === "boolean" ? value.isHollow : undefined,
    infillPercent:
      typeof value.infillPercent === "number" && Number.isFinite(value.infillPercent)
        ? value.infillPercent
        : undefined,
    orientationPreset:
      value.orientationPreset && typeof value.orientationPreset === "object"
        ? {
            key:
              typeof value.orientationPreset.key === "string"
                ? value.orientationPreset.key.slice(0, 24)
                : undefined,
            label:
              typeof value.orientationPreset.label === "string"
                ? value.orientationPreset.label.slice(0, 80)
                : undefined,
            reason:
              typeof value.orientationPreset.reason === "string"
                ? value.orientationPreset.reason.slice(0, 240)
                : undefined,
            riskStatus:
              typeof value.orientationPreset.riskStatus === "string"
                ? value.orientationPreset.riskStatus.slice(0, 16)
                : undefined,
            riskScore:
              typeof value.orientationPreset.riskScore === "number" &&
              Number.isFinite(value.orientationPreset.riskScore)
                ? value.orientationPreset.riskScore
                : undefined,
            etaMinutes:
              typeof value.orientationPreset.etaMinutes === "number" &&
              Number.isFinite(value.orientationPreset.etaMinutes)
                ? value.orientationPreset.etaMinutes
                : undefined,
            materialUsageCm3:
              typeof value.orientationPreset.materialUsageCm3 === "number" &&
              Number.isFinite(value.orientationPreset.materialUsageCm3)
                ? value.orientationPreset.materialUsageCm3
                : undefined,
            estimatedPrice:
              typeof value.orientationPreset.estimatedPrice === "number" &&
              Number.isFinite(value.orientationPreset.estimatedPrice)
                ? value.orientationPreset.estimatedPrice
                : undefined,
          }
        : undefined,
  };

  return normalized;
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
  if (raw === "mock" || raw === "yookassa") return raw;
  if (raw === "live" || raw === "stripe") return "stripe";
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

const NAME_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'-]{1,49}$/;
const CITY_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'.-]{1,49}$/;
const ADDRESS_REGEX = /^[A-Za-zА-Яа-яЁё0-9\s.,\\-\\/№]{3,120}$/;

const normalizeAddressInput = (value: string) =>
  value
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const validateCustomerName = (value?: string) => {
  if (!value) return false;
  const trimmed = value.trim();
  if (!NAME_REGEX.test(trimmed)) {
    return false;
  }
  return !KNOWN_CITY_SET.has(normalizeNameInput(trimmed));
};

const validateCity = (value?: string) => {
  if (!value) return false;
  const trimmed = value.trim();
  if (!CITY_REGEX.test(trimmed)) {
    return false;
  }
  return KNOWN_CITY_SET.has(normalizeCityInput(trimmed));
};

const validateAddress = (value?: string) => {
  if (!value) return false;
  return ADDRESS_REGEX.test(value.trim());
};

const resolveSmartPricingEnabled = () =>
  (process.env.PRINT_SMART_ENABLED || "true").trim().toLowerCase() !== "false";

const resolveQueueMultiplier = () => {
  const parsed = Number.parseFloat((process.env.PRINT_QUEUE_MULTIPLIER || "1").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(Math.max(parsed, 1), 2);
};

const resolvePreflightBlockCritical = () =>
  (process.env.PRINT_PREFLIGHT_BLOCK_CRITICAL || "true").trim().toLowerCase() !== "false";

const resolveBedSizeMm = () => {
  const parse = (value: string | undefined, fallback: number) => {
    const parsed = Number.parseFloat((value || "").trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  };

  return {
    x: parse(process.env.PRINT_BED_X_MM, 200),
    y: parse(process.env.PRINT_BED_Y_MM, 200),
    z: parse(process.env.PRINT_BED_Z_MM, 200),
  };
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

const IDEMPOTENCY_HEADER = "x-idempotency-key";
const IDEMPOTENCY_MARKER_PREFIX = "checkout:req:";
const IDEMPOTENCY_WINDOW_MINUTES = 30;

const sanitizeIdempotencyKey = (value?: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!/^[a-z0-9][a-z0-9:_-]{7,120}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
};

const buildFallbackIdempotencyKey = (args: {
  userId?: string | number | null;
  customerEmail?: string;
  paymentMethod?: string;
  promoCode?: string;
  total?: number;
  items: Array<{
    product: string | number;
    format: string;
    quantity: number;
    customerUpload?: string | number;
  }>;
}) => {
  const payload = {
    userId: args.userId ? String(args.userId) : "",
    email: (args.customerEmail || "").trim().toLowerCase(),
    paymentMethod: args.paymentMethod || "",
    promoCode: args.promoCode || "",
    total: Number.isFinite(Number(args.total)) ? Number(args.total) : 0,
    items: args.items
      .map((item) => ({
        product: String(item.product),
        format: String(item.format),
        quantity: Number(item.quantity) || 1,
        customerUpload: item.customerUpload ? String(item.customerUpload) : "",
      }))
      .sort((a, b) => {
        const aKey = `${a.product}|${a.format}|${a.quantity}|${a.customerUpload}`;
        const bKey = `${b.product}|${b.format}|${b.quantity}|${b.customerUpload}`;
        return aKey.localeCompare(bKey);
      }),
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 40);
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    const smartPricingEnabled = resolveSmartPricingEnabled();
    const queueMultiplier = resolveQueueMultiplier();
    let authUser: any = null;
    const authHeaders = request.headers;
    try {
      const authResult = await payload.auth({ headers: request.headers });
      authUser = authResult?.user ?? null;
    } catch {
      authUser = null;
    }
    const data = await request.json();
    const headerIdempotencyKey = sanitizeIdempotencyKey(
      request.headers.get(IDEMPOTENCY_HEADER) ?? undefined
    );
    const bodyIdempotencyKey = sanitizeIdempotencyKey(
      typeof data?.checkoutRequestId === "string" ? data.checkoutRequestId : undefined
    );
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
            delete next.promoCode;
            delete next.checkoutRequestId;
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

    const bedSizeMm = resolveBedSizeMm();
    const shouldBlockCriticalPreflight = resolvePreflightBlockCritical();
    const preflightCriticalIssues = items
      .map((item: any, index: number) => {
        if (item.format !== "Physical" || !item.customerUpload) {
          return null;
        }
        const report = evaluateStlPreflight({
          dimensions: item.printSpecs?.dimensions,
          volumeCm3: item.printSpecs?.volumeCm3,
          bedSizeMm,
        });
        if (report.status !== "critical") {
          return null;
        }
        return {
          itemIndex: index,
          issues: report.issues
            .filter((issue) => issue.severity === "critical")
            .map((issue) => issue.message),
        };
      })
      .filter(
        (item: any): item is { itemIndex: number; issues: string[] } =>
          Boolean(item && item.issues.length)
      );

    if (shouldBlockCriticalPreflight && preflightCriticalIssues.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Авто-проверка модели обнаружила критичные риски печати. Исправьте модель и повторите загрузку.",
          preflight: {
            status: "critical",
            items: preflightCriticalIssues,
          },
        },
        { status: 400 }
      );
    }

    const incomingCustomFile = normalizeRelationshipId(data?.customFile);
    const incomingSpecs = normalizePrintSpecs(data?.technicalSpecs);
    const incomingPromoCode =
      typeof data?.promoCode === "string" ? data.promoCode.trim().toUpperCase() : "";
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
      ...(authUser?.id ? { user: authUser.id } : {}),
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
            color: (firstPrintItem.printSpecs as any).color,
            quality: firstPrintItem.printSpecs.quality,
            note: (firstPrintItem.printSpecs as any).note,
            packaging: (firstPrintItem.printSpecs as any).packaging,
            dimensions: firstPrintItem.printSpecs.dimensions,
            volumeCm3: firstPrintItem.printSpecs.volumeCm3,
            isHollow: firstPrintItem.printSpecs.isHollow,
            infillPercent: firstPrintItem.printSpecs.infillPercent,
            orientationPreset: (firstPrintItem.printSpecs as any).orientationPreset,
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
    const normalizedName = normalizeNameInput(rawCustomerName);
    if (hasPhysical) {
      const rawCity =
        typeof (baseData as any)?.shipping?.city === "string"
          ? (baseData as any).shipping.city
          : "";
      const rawAddress =
        typeof (baseData as any)?.shipping?.address === "string"
          ? (baseData as any).shipping.address
          : "";
      const normalizedAddress = normalizeAddressInput(rawAddress);
      if ((baseData as any)?.shipping) {
        (baseData as any).shipping.address = normalizedAddress;
      }
      if (!validateCity(rawCity)) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid shipping city.",
          },
          { status: 400 }
        );
      }
      if (normalizedName === normalizeCityInput(rawCity)) {
        return NextResponse.json(
          {
            success: false,
            error: "Customer name must not match city.",
          },
          { status: 400 }
        );
      }
      if (!validateAddress(normalizedAddress)) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid shipping address.",
          },
          { status: 400 }
        );
      }
    }

    const fallbackIdempotencyKey = buildFallbackIdempotencyKey({
      userId: authUser?.id ?? null,
      customerEmail,
      paymentMethod,
      promoCode: incomingPromoCode,
      total: typeof data?.total === "number" ? data.total : undefined,
      items: items.map((item: {
        product: unknown;
        format?: string;
        quantity?: number;
        customerUpload?: unknown;
      }) => ({
        product: item.product as string | number,
        format: item.format as string,
        quantity: item.quantity as number,
        customerUpload: item.customerUpload as string | number | undefined,
      })),
    });
    const effectiveIdempotencyKey =
      headerIdempotencyKey ?? bodyIdempotencyKey ?? fallbackIdempotencyKey;
    const idempotencyMarker = `${IDEMPOTENCY_MARKER_PREFIX}${effectiveIdempotencyKey}`;

    const ownerConditions: any[] = [];
    if (authUser?.id) {
      ownerConditions.push({ user: { equals: authUser.id } });
    }
    if (customerEmail) {
      ownerConditions.push({ "customer.email": { equals: customerEmail } });
    }

    if (ownerConditions.length > 0) {
      const dedupeWindowStart = new Date(
        Date.now() - IDEMPOTENCY_WINDOW_MINUTES * 60 * 1000
      ).toISOString();
      const dedupeWhere: any = {
        and: [
          { paymentIntentId: { equals: idempotencyMarker } },
          { createdAt: { greater_than_equal: dedupeWindowStart } },
        ],
      };
      if (ownerConditions.length === 1) {
        dedupeWhere.and.push(ownerConditions[0]);
      } else {
        dedupeWhere.and.push({ or: ownerConditions });
      }

      const existingOrderResult = await payload.find({
        collection: "orders",
        depth: 0,
        limit: 1,
        overrideAccess: true,
        sort: "-createdAt",
        where: dedupeWhere,
      });

      if (existingOrderResult?.docs?.[0]) {
        const existingOrder = existingOrderResult.docs[0];
        return NextResponse.json(
          { success: true, doc: existingOrder, deduplicated: true },
          { status: 200 }
        );
      }
    }

    (orderData as any).paymentIntentId = idempotencyMarker;

    const productCache = new Map<string, any>();
    const physicalUploadIds = new Set(
      items
        .filter(
          (item: { format?: string; customerUpload?: unknown }) =>
            item.format === "Physical" && item.customerUpload
        )
        .map((item: { customerUpload?: unknown }) => String(item.customerUpload))
    );

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
        if (!mediaDoc?.isCustomerUpload && item.format !== "Physical") {
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
        const customFileId = String(orderData.customFile);
        if (!mediaDoc?.isCustomerUpload && !physicalUploadIds.has(customFileId)) {
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

    let normalizedItems = items.map(
      (item: {
        product: unknown;
        quantity?: number;
        unitPrice?: number;
        customerUpload?: unknown;
        printSpecs?: unknown;
        format?: string;
      }) => {
      const productDoc = productCache.get(String(item.product));
      const productPrice =
        typeof productDoc?.price === "number" && productDoc.price >= 0
          ? productDoc.price
          : 0;
      const hasPrint = Boolean(item.customerUpload || item.printSpecs);

      let unitPrice = productPrice;
      if (hasPrint) {
        const printSpecs = item.printSpecs as
          | {
              technology?: string;
              material?: string;
              color?: string;
              quality?: string;
              note?: string;
              packaging?: string;
              dimensions?: { x: number; y: number; z: number };
              volumeCm3?: number;
              isHollow?: boolean;
              infillPercent?: number;
            }
          | undefined;
        const pricing = computePrintPrice({
          technology: printSpecs?.technology,
          material: printSpecs?.material,
          quality: printSpecs?.quality,
          dimensions: printSpecs?.dimensions,
          volumeCm3: printSpecs?.volumeCm3,
          isHollow: printSpecs?.isHollow,
          infillPercent: printSpecs?.infillPercent,
          enableSmart: smartPricingEnabled,
          queueMultiplier,
        });
        unitPrice = Math.max(productPrice, pricing.price);
      }

      return {
        product: item.product,
        quantity: item.quantity,
        format: item.format,
        customerUpload: item.customerUpload,
        printSpecs: item.printSpecs,
        unitPrice,
      };
    });

    if (incomingPromoCode) {
      const subtotalBeforePromo = normalizedItems.reduce((sum: number, item: any) => {
        const qty = typeof item?.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
        const unitPrice =
          typeof item?.unitPrice === "number" && item.unitPrice >= 0 ? item.unitPrice : 0;
        return sum + unitPrice * qty;
      }, 0);
      const hasDigitalItems = normalizedItems.some((item: any) => item?.format === "Digital");
      const hasPhysicalItems = normalizedItems.some((item: any) => item?.format === "Physical");
      const promoValidation = validatePromoCode({
        code: incomingPromoCode,
        subtotal: subtotalBeforePromo,
        hasDigital: hasDigitalItems,
        hasPhysical: hasPhysicalItems,
      });

      if (!promoValidation.valid) {
        return NextResponse.json(
          {
            success: false,
            error: promoValidation.message || "Промокод не применен.",
          },
          { status: 400 }
        );
      }

      normalizedItems = applyPromoDiscountToItems(
        normalizedItems,
        promoValidation.discountAmount
      );
    }

    orderData.items = normalizedItems;

    // Create order using Payload Local API
    const result = await payload.create({
      collection: "orders",
      data: orderData,
      overrideAccess: false, // Use normal access control
      req:
        authUser || authHeaders
          ? {
              user: authUser ?? undefined,
              headers: authHeaders,
            }
          : undefined,
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

