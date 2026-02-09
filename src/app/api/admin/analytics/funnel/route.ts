import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { hasFunnelAdminAccess, type FunnelEventName } from "@/lib/funnelEvents";

export const dynamic = "force-dynamic";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const percent = (num: number, den: number) => {
  if (!den || den <= 0) return 0;
  return Number(((num / den) * 100).toFixed(2));
};

const stageEventMap: Record<FunnelEventName, "store" | "product" | "cart" | "checkout" | "order" | "paid"> = {
  store_view: "store",
  print_service_view: "store",
  product_view: "product",
  add_to_cart: "cart",
  add_to_cart_print: "cart",
  checkout_view: "checkout",
  checkout_submit: "checkout",
  order_created: "order",
  payment_paid: "paid",
  payment_failed: "checkout",
};

type StageKey = keyof typeof stageEventMap;

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const authUser = authResult?.user ?? null;
    if (!authUser || !hasFunnelAdminAccess(authUser?.email)) {
      return NextResponse.json(
        { success: false, error: "Forbidden." },
        { status: 403 }
      );
    }

    const daysRaw = Number.parseInt(request.nextUrl.searchParams.get("days") || "30", 10);
    const days = clamp(Number.isFinite(daysRaw) ? daysRaw : 30, 1, 365);
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const docs: any[] = [];
    let page = 1;
    const limit = 500;

    while (true) {
      const result = await payload.find({
        collection: "funnel-events",
        overrideAccess: true,
        depth: 0,
        page,
        limit,
        sort: "-occurredAt",
        where: {
          occurredAt: {
            greater_than_equal: fromDate.toISOString(),
          },
        },
      });

      if (Array.isArray(result?.docs) && result.docs.length > 0) {
        docs.push(...result.docs);
      }
      if (!result?.hasNextPage) {
        break;
      }
      page += 1;
    }

    const sessions = {
      store: new Set<string>(),
      product: new Set<string>(),
      cart: new Set<string>(),
      checkout: new Set<string>(),
      order: new Set<string>(),
      paid: new Set<string>(),
    };
    const eventTotals = new Map<string, number>();

    docs.forEach((doc) => {
      const name = String(doc?.name || "").trim() as StageKey;
      const sessionId = String(doc?.sessionId || "").trim();
      if (!sessionId) return;
      const stage = stageEventMap[name as FunnelEventName];
      if (!stage) return;
      sessions[stage].add(sessionId);
      eventTotals.set(name, (eventTotals.get(name) ?? 0) + 1);
    });

    const counts = {
      store: sessions.store.size,
      product: sessions.product.size,
      cart: sessions.cart.size,
      checkout: sessions.checkout.size,
      order: sessions.order.size,
      paid: sessions.paid.size,
    };

    return NextResponse.json(
      {
        success: true,
        period: {
          days,
          from: fromDate.toISOString(),
          to: new Date().toISOString(),
        },
        counts,
        conversion: {
          storeToProduct: percent(counts.product, counts.store),
          productToCart: percent(counts.cart, counts.product),
          cartToCheckout: percent(counts.checkout, counts.cart),
          checkoutToOrder: percent(counts.order, counts.checkout),
          orderToPaid: percent(counts.paid, counts.order),
          storeToPaid: percent(counts.paid, counts.store),
        },
        totals: Object.fromEntries(eventTotals.entries()),
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to build funnel report." },
      { status: 500 }
    );
  }
}

