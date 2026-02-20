import { NextResponse, type NextRequest } from "next/server";

import {
  deleteCartItem,
  readCart,
  resolveOwner,
  respondWithCart,
  updateCartItem,
} from "@/lib/cartServer";
import { resolveCartUserId } from "../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const decodeParam = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const itemId = decodeParam(params.id || "").trim();
    if (!itemId) {
      return NextResponse.json({ success: false, error: "Item id is required." }, { status: 400 });
    }

    const userId = await resolveCartUserId(request);
    const owner = resolveOwner(userId);
    const { envelope } = readCart(request, owner);
    const body = await request.json().catch(() => null);

    const { snapshot, found } = updateCartItem(envelope, owner, itemId, {
      quantity: body?.quantity,
      item: body?.item,
    });

    if (!found) {
      return NextResponse.json({ success: false, error: "Item not found." }, { status: 404 });
    }

    return respondWithCart(owner, envelope, snapshot);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Не удалось обновить позицию.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const itemId = decodeParam(params.id || "").trim();
    if (!itemId) {
      return NextResponse.json({ success: false, error: "Item id is required." }, { status: 400 });
    }

    const userId = await resolveCartUserId(request);
    const owner = resolveOwner(userId);
    const { envelope } = readCart(request, owner);
    const { snapshot, found } = deleteCartItem(envelope, owner, itemId);

    if (!found) {
      return NextResponse.json({ success: false, error: "Item not found." }, { status: 404 });
    }

    return respondWithCart(owner, envelope, snapshot);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Не удалось удалить позицию.",
      },
      { status: 500 }
    );
  }
}