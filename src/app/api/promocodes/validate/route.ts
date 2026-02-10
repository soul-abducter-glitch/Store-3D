import { NextResponse, type NextRequest } from "next/server";

import { validatePromoCode } from "@/lib/promocodes";

export const dynamic = "force-dynamic";

const parseSubtotalFromItems = (items: any[]) => {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum: number, item: any) => {
    const quantity =
      typeof item?.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
    const unitPrice =
      typeof item?.priceValue === "number" && item.priceValue >= 0
        ? item.priceValue
        : typeof item?.unitPrice === "number" && item.unitPrice >= 0
          ? item.unitPrice
          : 0;
    return sum + unitPrice * quantity;
  }, 0);
};

const parseFlagsFromItems = (items: any[]) => {
  if (!Array.isArray(items)) {
    return { hasDigital: false, hasPhysical: false };
  }
  let hasDigital = false;
  let hasPhysical = false;
  for (const item of items) {
    const formatRaw =
      typeof item?.formatKey === "string"
        ? item.formatKey
        : typeof item?.format === "string"
          ? item.format
          : "";
    const format = formatRaw.toLowerCase();
    if (format.includes("physical")) hasPhysical = true;
    if (format.includes("digital")) hasDigital = true;
  }
  return { hasDigital, hasPhysical };
};

export async function POST(request: NextRequest) {
  try {
    const data = await request.json().catch(() => null);
    const code = typeof data?.code === "string" ? data.code : "";
    const items = Array.isArray(data?.items) ? data.items : [];
    const subtotalRaw =
      typeof data?.subtotal === "number" && Number.isFinite(data.subtotal)
        ? data.subtotal
        : parseSubtotalFromItems(items);
    const flags = parseFlagsFromItems(items);
    const result = validatePromoCode({
      code,
      subtotal: subtotalRaw,
      hasDigital: flags.hasDigital,
      hasPhysical: flags.hasPhysical,
    });

    if (!result.valid) {
      return NextResponse.json(
        {
          success: false,
          valid: false,
          error: result.message || "Промокод не применен.",
          discountAmount: 0,
          finalSubtotal: Math.max(0, subtotalRaw),
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        valid: true,
        code: result.code,
        discountAmount: result.discountAmount,
        finalSubtotal: result.finalSubtotal,
        description: result.description,
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        valid: false,
        error: error?.message || "Не удалось проверить промокод.",
      },
      { status: 500 }
    );
  }
}
