import { NextResponse, type NextRequest } from "next/server";
import { getPayloadHMR } from "@payloadcms/next/utilities";

import payloadConfig from "../../../../../../payload.config";
import { importMap } from "../../../../(payload)/admin/importMap";

export const dynamic = "force-dynamic";

const getPayload = async () =>
  getPayloadHMR({
    config: payloadConfig,
    importMap,
  });

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

const CANCEL_WINDOW_MINUTES = 30;

const isWithinCancelWindow = (createdAt?: unknown) => {
  if (!createdAt) return false;
  const createdAtMs = new Date(String(createdAt)).getTime();
  if (!Number.isFinite(createdAtMs)) return false;
  return Date.now() - createdAtMs <= CANCEL_WINDOW_MINUTES * 60 * 1000;
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

  const payload = await getPayload();
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
      depth: 0,
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
      { success: false, error: "Нельзя отменить заказ после статуса <Готов к выдаче>." },
      { status: 400 }
    );
  }

  const items = Array.isArray(order?.items) ? order.items : [];
  const hasPhysical = items.some((item: any) => !isDigitalFormat(item?.format));
  if (!hasPhysical) {
    return NextResponse.json(
      { success: false, error: "Цифровые заказы нельзя отменить." },
      { status: 400 }
    );
  }
  if (!isWithinCancelWindow(order?.createdAt)) {
    return NextResponse.json(
      { success: false, error: "Отмена доступна в течение 30 минут после оформления." },
      { status: 400 }
    );
  }

  try {
    const updated = await payload.update({
      collection: "orders",
      id: orderId,
      data: { status: "cancelled" },
      overrideAccess: true,
      req: {
        user: authUser ?? undefined,
      },
    });

    return NextResponse.json({ success: true, doc: updated });
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
