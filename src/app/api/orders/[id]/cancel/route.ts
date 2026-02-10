import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";

export const dynamic = "force-dynamic";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeEmail = (value?: string) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

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
  const isOwner =
    (order?.user && String(order.user) === String(authUser?.id)) ||
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
      { success: false, error: "Заказ нельзя отменить в текущем статусе." },
      { status: 400 }
    );
  }

  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) {
    return NextResponse.json(
      { success: false, error: "Заказ не содержит позиций." },
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
          { success: false, error: "Позиция заказа не найдена." },
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

      if (items.length === 1) {
        const updated = await payload.update({
          collection: "orders",
          id: orderId,
          data: { status: "cancelled" },
          overrideAccess: true,
          req: { user: authUser ?? undefined },
        });
        return NextResponse.json({ success: true, doc: updated, mode: "item" });
      }

      const nextItems = items.filter((_: any, index: number) => index !== itemIndex);
      const updated = await payload.update({
        collection: "orders",
        id: orderId,
        data: { items: nextItems },
        overrideAccess: true,
        req: { user: authUser ?? undefined },
      });

      return NextResponse.json({ success: true, doc: updated, mode: "item" });
    }

    const windowMinutes = resolveCancelWindowForItems(items);
    if (!isWithinCancelWindow(order?.createdAt, windowMinutes)) {
      return NextResponse.json(
        { success: false, error: getCancelWindowMessage(windowMinutes) },
        { status: 400 }
      );
    }

    const updated = await payload.update({
      collection: "orders",
      id: orderId,
      data: { status: "cancelled" },
      overrideAccess: true,
      req: { user: authUser ?? undefined },
    });

    return NextResponse.json({ success: true, doc: updated, mode: "order" });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Не удалось отменить заказ.",
      },
      { status: 400 }
    );
  }
}

