import { NextResponse, type NextRequest } from "next/server";

import { readCart, resolveOwner, respondWithCart, undoDeleteCartItem } from "@/lib/cartServer";
import { resolveCartUserId } from "../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveCartUserId(request);
    const owner = resolveOwner(userId);
    const { envelope } = readCart(request, owner);
    const { snapshot, restored } = undoDeleteCartItem(envelope, owner);

    if (!restored) {
      return NextResponse.json(
        {
          success: false,
          error: "Nothing to restore.",
        },
        { status: 409 }
      );
    }

    return respondWithCart(owner, envelope, snapshot);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Не удалось восстановить позицию.",
      },
      { status: 500 }
    );
  }
}
