import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { resolveServerPaymentsMode } from "@/lib/paymentsMode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });
const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
const stripe = stripeSecretKey !== "" ? new Stripe(stripeSecretKey) : null;
const expectedCurrency = (process.env.PAYMENTS_CURRENCY || "rub").trim().toLowerCase();
const paymentsMode = resolveServerPaymentsMode();

const normalizeEmail = (value?: string) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const normalizeRelationshipId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const candidate =
      (value as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (value as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (value as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
    return normalizeRelationshipId(candidate);
  }

  const raw = String(value).trim();
  if (!raw) return null;
  const base = raw.split(":")[0].trim();
  if (!base || /\s/.test(base)) return null;
  if (/^\d+$/.test(base)) return Number(base);
  return base;
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

const normalizePaymentStatus = (value?: unknown) => {
  if (!value) return "pending";
  const raw = String(value).trim().toLowerCase();
  if (raw === "paid" || raw === "success") return "paid";
  if (raw === "failed" || raw === "error") return "failed";
  if (raw === "refunded" || raw === "refund") return "refunded";
  return "pending";
};

const isDigitalFormat = (value: unknown) => {
  if (!value) return false;
  const raw = String(value).trim().toLowerCase();
  return raw.includes("digital") || raw.includes("цифров");
};

const DIGITAL_CANCEL_WINDOW_MINUTES = 30;
const PHYSICAL_CANCEL_WINDOW_MINUTES = 12 * 60;

const isWithinCancelWindow = (createdAt: unknown, windowMinutes: number) => {
  if (!createdAt) return false;
  const createdAtMs = new Date(String(createdAt)).getTime();
  if (!Number.isFinite(createdAtMs)) return false;
  return Date.now() - createdAtMs <= windowMinutes * 60 * 1000;
};

const resolveCancelWindowForItems = (items: any[]) => {
  const hasPhysical = items.some((item) => !isDigitalFormat(item?.format));
  const hasDigital = items.some((item) => isDigitalFormat(item?.format));
  if (hasPhysical && !hasDigital) {
    return PHYSICAL_CANCEL_WINDOW_MINUTES;
  }
  return DIGITAL_CANCEL_WINDOW_MINUTES;
};

const getCancelWindowMessage = (windowMinutes: number) => {
  if (windowMinutes === PHYSICAL_CANCEL_WINDOW_MINUTES) {
    return "Физические заказы можно отменить только в течение 12 часов после оформления.";
  }
  return "Цифровые заказы можно отменить только в течение 30 минут после оформления.";
};

const safeReadJson = async (request: NextRequest) => {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
};

const deliveryCostMap: Record<string, number> = {
  cdek: 200,
  yandex: 150,
  ozon: 100,
  pochta: 250,
  pickup: 0,
};

const getItemLineTotal = (item: any) => {
  const quantity =
    typeof item?.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
      ? item.quantity
      : 1;
  const unitPrice =
    typeof item?.unitPrice === "number" && Number.isFinite(item.unitPrice) && item.unitPrice >= 0
      ? item.unitPrice
      : 0;
  return Math.max(0, quantity * unitPrice);
};

const getItemsSubtotal = (items: any[]) =>
  items.reduce((sum, item) => sum + getItemLineTotal(item), 0);

const resolveDeliveryCost = (order: any) => {
  const shippingMethod =
    typeof order?.shipping?.method === "string" ? order.shipping.method : "";
  return deliveryCostMap[shippingMethod] ?? 0;
};

const toMinorUnits = (amount: number) => Math.round(Math.max(0, amount) * 100);

type CancelMode = "order" | "item";

type RefundResult = {
  attempted: boolean;
  refunded: boolean;
  provider: "stripe" | "internal" | null;
  amountMinor: number;
  currency: string;
  refundId?: string;
  reason?: string;
};

const resolveRequestedRefundAmountMinor = (args: {
  mode: CancelMode;
  order: any;
  targetItem?: any;
}) => {
  if (args.mode === "item") {
    return toMinorUnits(getItemLineTotal(args.targetItem));
  }
  const subtotal = getItemsSubtotal(Array.isArray(args.order?.items) ? args.order.items : []);
  const delivery = resolveDeliveryCost(args.order);
  return toMinorUnits(subtotal + delivery);
};

const resolveRefundForCancellation = async (args: {
  mode: CancelMode;
  order: any;
  targetItem?: any;
}): Promise<RefundResult> => {
  const paymentStatus = normalizePaymentStatus(args.order?.paymentStatus);
  if (paymentStatus !== "paid") {
    return {
      attempted: false,
      refunded: false,
      provider: null,
      amountMinor: 0,
      currency: expectedCurrency,
      reason: "order_not_paid",
    };
  }

  const requestedAmountMinor = resolveRequestedRefundAmountMinor(args);
  if (requestedAmountMinor <= 0) {
    return {
      attempted: true,
      refunded: false,
      provider: null,
      amountMinor: 0,
      currency: expectedCurrency,
      reason: "zero_amount",
    };
  }

  const providerRaw =
    typeof args.order?.paymentProvider === "string"
      ? args.order.paymentProvider.trim().toLowerCase()
      : "";
  const paymentIntentId =
    typeof args.order?.paymentIntentId === "string" ? args.order.paymentIntentId.trim() : "";
  const shouldUseStripe = providerRaw === "stripe" && paymentIntentId.startsWith("pi_");

  if (shouldUseStripe) {
    if (paymentsMode !== "stripe") {
      throw new Error("Stripe refund unavailable: PAYMENTS_MODE is not stripe.");
    }
    if (!stripe) {
      throw new Error("Stripe refund unavailable: STRIPE_SECRET_KEY is missing.");
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const paidCurrency = String(paymentIntent.currency || "").trim().toLowerCase();
    if (paidCurrency && paidCurrency !== expectedCurrency) {
      throw new Error(`Cannot refund: currency mismatch (${paidCurrency} != ${expectedCurrency}).`);
    }

    const refunds = await stripe.refunds.list({
      payment_intent: paymentIntentId,
      limit: 100,
    });
    const alreadyRefundedMinor = refunds.data
      .filter((refund) => refund.status !== "canceled")
      .reduce((sum, refund) => sum + (typeof refund.amount === "number" ? refund.amount : 0), 0);

    const paidMinor =
      typeof paymentIntent.amount_received === "number" && paymentIntent.amount_received > 0
        ? paymentIntent.amount_received
        : paymentIntent.amount;

    const refundableMinor = Math.max(0, paidMinor - alreadyRefundedMinor);
    const refundAmountMinor = Math.min(requestedAmountMinor, refundableMinor);

    if (refundAmountMinor <= 0) {
      return {
        attempted: true,
        refunded: false,
        provider: "stripe",
        amountMinor: 0,
        currency: paidCurrency || expectedCurrency,
        reason: "nothing_to_refund",
      };
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: refundAmountMinor,
      reason: "requested_by_customer",
      metadata: {
        orderId: String(args.order?.id || ""),
        cancelMode: args.mode,
      },
    });

    return {
      attempted: true,
      refunded: refund.status === "succeeded" || refund.status === "pending",
      provider: "stripe",
      amountMinor: refundAmountMinor,
      currency: paidCurrency || expectedCurrency,
      refundId: refund.id,
    };
  }

  return {
    attempted: true,
    refunded: true,
    provider: "internal",
    amountMinor: requestedAmountMinor,
    currency: expectedCurrency,
    reason: "virtual_refund",
  };
};

const buildInternalReq = (authUser: any, refundResult: RefundResult) =>
  ({
    user: authUser ?? undefined,
    headers: new Headers({
      "x-internal-payment": refundResult.provider === "stripe" ? "stripe" : "mock",
    }),
  }) as any;

const resolveItemProductId = (item: any) => {
  const id = normalizeRelationshipId(item?.product);
  return id === null ? null : String(id);
};

const hasDownloadedEntitlementForOrderProducts = async (args: {
  payload: any;
  orderId: string | number;
  productIds: string[];
}) => {
  const { payload, orderId, productIds } = args;
  if (!productIds.length) {
    return { hasDownload: false, matches: 0 };
  }

  const productSet = new Set(productIds.map((id) => String(id)));
  const entitlementsResult = await payload.find({
    collection: "digital_entitlements",
    depth: 0,
    limit: 500,
    overrideAccess: true,
    where: {
      order: {
        equals: orderId as any,
      },
    },
  });
  const entitlementDocs = Array.isArray(entitlementsResult?.docs) ? entitlementsResult.docs : [];
  const matchedEntitlementIds = entitlementDocs
    .filter((doc: any) => {
      const productId = normalizeRelationshipId(doc?.product);
      return productId !== null && productSet.has(String(productId));
    })
    .map((doc: any) => normalizeRelationshipId(doc?.id))
    .filter((id: string | number | null): id is string | number => id !== null);

  if (!matchedEntitlementIds.length) {
    return { hasDownload: false, matches: 0 };
  }

  const downloadWhere =
    matchedEntitlementIds.length === 1
      ? {
          and: [
            { status: { equals: "OK" } },
            { entitlement: { equals: matchedEntitlementIds[0] as any } },
          ],
        }
      : {
          and: [
            { status: { equals: "OK" } },
            {
              or: matchedEntitlementIds.map((id: string | number) => ({
                entitlement: { equals: id as any },
              })),
            },
          ],
        };

  const downloadsResult = await payload.find({
    collection: "download_events",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: downloadWhere,
  });

  const hasDownload =
    typeof downloadsResult?.totalDocs === "number"
      ? downloadsResult.totalDocs > 0
      : Array.isArray(downloadsResult?.docs) && downloadsResult.docs.length > 0;

  return { hasDownload, matches: matchedEntitlementIds.length };
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const orderId = resolvedParams?.id ? String(resolvedParams.id) : "";
  if (!orderId) {
    return NextResponse.json(
      { success: false, error: "Order id is required." },
      { status: 400 }
    );
  }

  const body = await safeReadJson(request);
  const requestedItemId = typeof body?.itemId === "string" ? body.itemId.trim() : "";
  const requestedItemIndex =
    typeof body?.itemIndex === "number" && Number.isInteger(body.itemIndex)
      ? body.itemIndex
      : null;
  const cancelSingleItem = Boolean(requestedItemId || requestedItemIndex !== null);

  const payload = await getPayloadClient();
  const siteUrl = request.nextUrl.origin;
  const cookie = request.headers.get("cookie") || "";
  let authUser: any = null;

  try {
    const response = await fetch(`${siteUrl}/api/users/me?depth=0`, {
      headers: cookie ? { cookie } : undefined,
      cache: "no-store",
    });
    if (response.ok) {
      const data = await response.json();
      authUser = data?.user ?? data?.doc ?? null;
    }
  } catch {
    authUser = null;
  }

  if (!authUser) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }

  let order: any = null;
  try {
    order = await payload.findByID({
      collection: "orders",
      id: orderId,
      depth: 2,
      overrideAccess: true,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Order not found." },
      { status: 404 }
    );
  }

  const userEmail = normalizeEmail(authUser?.email);
  const orderEmail = normalizeEmail(order?.customer?.email);
  const orderUserId = normalizeRelationshipId(order?.user);
  const isOwner =
    (orderUserId !== null && String(orderUserId) === String(authUser?.id)) ||
    (userEmail && orderEmail && userEmail === orderEmail);

  if (!isOwner) {
    return NextResponse.json(
      { success: false, error: "Not allowed to cancel this order." },
      { status: 403 }
    );
  }

  const statusKey = normalizeOrderStatus(order?.status);
  if (statusKey === "ready" || statusKey === "completed" || statusKey === "cancelled") {
    return NextResponse.json(
      { success: false, error: "Order cannot be cancelled in current status." },
      { status: 400 }
    );
  }

  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) {
    return NextResponse.json(
      { success: false, error: "Order has no items." },
      { status: 400 }
    );
  }

  try {
    if (cancelSingleItem) {
      let itemIndex = -1;
      if (requestedItemId) {
        itemIndex = items.findIndex((item: any) => String(item?.id ?? "") === requestedItemId);
      }
      if (
        itemIndex < 0 &&
        requestedItemIndex !== null &&
        requestedItemIndex >= 0 &&
        requestedItemIndex < items.length
      ) {
        itemIndex = requestedItemIndex;
      }

      if (itemIndex < 0) {
        return NextResponse.json(
          { success: false, error: "Order item not found." },
          { status: 404 }
        );
      }

      const targetItem = items[itemIndex];
      const windowMinutes = isDigitalFormat(targetItem?.format)
        ? DIGITAL_CANCEL_WINDOW_MINUTES
        : PHYSICAL_CANCEL_WINDOW_MINUTES;

      if (!isWithinCancelWindow(order?.createdAt, windowMinutes)) {
        return NextResponse.json(
          { success: false, error: getCancelWindowMessage(windowMinutes) },
          { status: 400 }
        );
      }

      const isPaidOrder = normalizePaymentStatus(order?.paymentStatus) === "paid";
      if (isPaidOrder && isDigitalFormat(targetItem?.format)) {
        const productId = resolveItemProductId(targetItem);
        if (productId) {
          const downloadState = await hasDownloadedEntitlementForOrderProducts({
            payload,
            orderId: order.id,
            productIds: [productId],
          });
          if (downloadState.hasDownload) {
            return NextResponse.json(
              {
                success: false,
                error:
                  "Для этой цифровой позиции уже было скачивание. Автовозврат недоступен.",
              },
              { status: 400 }
            );
          }
        }
      }

      const mode: CancelMode = items.length === 1 ? "order" : "item";
      const refundResult = await resolveRefundForCancellation({
        mode,
        order,
        targetItem,
      });

      if (items.length === 1) {
        const shouldMarkRefunded =
          refundResult.refunded && normalizePaymentStatus(order?.paymentStatus) === "paid";

        const updated = await payload.update({
          collection: "orders",
          id: orderId,
          data: {
            status: "cancelled",
            ...(shouldMarkRefunded ? { paymentStatus: "refunded" } : {}),
          },
          overrideAccess: true,
          req: buildInternalReq(authUser, refundResult),
        });

        return NextResponse.json({ success: true, doc: updated, mode: "item", refund: refundResult });
      }

      const nextItems = items.filter((_: any, index: number) => index !== itemIndex);
      const updated = await payload.update({
        collection: "orders",
        id: orderId,
        data: { items: nextItems },
        overrideAccess: true,
        req: buildInternalReq(authUser, refundResult),
      });

      return NextResponse.json({ success: true, doc: updated, mode: "item", refund: refundResult });
    }

    const windowMinutes = resolveCancelWindowForItems(items);
    if (!isWithinCancelWindow(order?.createdAt, windowMinutes)) {
      return NextResponse.json(
        { success: false, error: getCancelWindowMessage(windowMinutes) },
        { status: 400 }
      );
    }

    const isPaidOrder = normalizePaymentStatus(order?.paymentStatus) === "paid";
    if (isPaidOrder) {
      const digitalProductIds = items
        .filter((item: any) => isDigitalFormat(item?.format))
        .map((item: any) => resolveItemProductId(item))
        .filter((id: string | null): id is string => Boolean(id));
      if (digitalProductIds.length > 0) {
        const downloadState = await hasDownloadedEntitlementForOrderProducts({
          payload,
          orderId: order.id,
          productIds: Array.from(new Set(digitalProductIds)),
        });
        if (downloadState.hasDownload) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Цифровые файлы из этого заказа уже скачивались. Автовозврат недоступен.",
            },
            { status: 400 }
          );
        }
      }
    }

    const refundResult = await resolveRefundForCancellation({ mode: "order", order });
    const shouldMarkRefunded =
      refundResult.refunded && normalizePaymentStatus(order?.paymentStatus) === "paid";

    const updated = await payload.update({
      collection: "orders",
      id: orderId,
      data: {
        status: "cancelled",
        ...(shouldMarkRefunded ? { paymentStatus: "refunded" } : {}),
      },
      overrideAccess: true,
      req: buildInternalReq(authUser, refundResult),
    });

    return NextResponse.json({ success: true, doc: updated, mode: "order", refund: refundResult });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to cancel order.",
      },
      { status: 400 }
    );
  }
}
