import { NextResponse, type NextRequest } from "next/server";

import {
  readCart,
  replaceCartItems,
  resolveOwner,
  respondWithCart,
} from "@/lib/cartServer";
import { resolveCartUserId } from "./_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const userId = await resolveCartUserId(request);
  const owner = resolveOwner(userId);
  const { envelope, snapshot } = readCart(request, owner);
  return respondWithCart(owner, envelope, snapshot);
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await resolveCartUserId(request);
    const owner = resolveOwner(userId);
    const { envelope } = readCart(request, owner);
    const body = await request.json().catch(() => null);
    const snapshot = replaceCartItems(envelope, owner, body?.items);
    return respondWithCart(owner, envelope, snapshot);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Не удалось обновить корзину.",
      },
      { status: 500 }
    );
  }
}
