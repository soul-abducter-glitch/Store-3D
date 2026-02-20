import { NextResponse, type NextRequest } from "next/server";

import { addCartItem, readCart, resolveOwner, respondWithCart } from "@/lib/cartServer";
import { resolveCartUserId } from "../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveCartUserId(request);
    const owner = resolveOwner(userId);
    const { envelope } = readCart(request, owner);
    const body = await request.json().catch(() => null);
    const snapshot = addCartItem(envelope, owner, body?.item);
    return respondWithCart(owner, envelope, snapshot);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Не удалось добавить позицию.",
      },
      { status: 500 }
    );
  }
}
