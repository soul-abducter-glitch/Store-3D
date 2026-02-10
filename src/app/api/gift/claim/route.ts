import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { normalizeEmail, verifyGiftToken } from "@/lib/giftLinks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const normalizeRelationshipId = (value: unknown): string | number | null => {
  let current: unknown = value;
  while (typeof current === "object" && current !== null) {
    current =
      (current as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (current as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (current as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
  }
  if (current === null || current === undefined) return null;
  if (typeof current === "number") return current;
  const raw = String(current).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
};

const normalizeId = (value: unknown) => String(value ?? "").trim();

const extractPurchasedIds = (items: unknown[]) =>
  items
    .map((entry: any) => normalizeId(normalizeRelationshipId(entry)))
    .filter(Boolean);

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload({ config: payloadConfig });
    const auth = await payload.auth({ headers: request.headers });
    const recipientId = normalizeRelationshipId(auth?.user?.id);
    if (!recipientId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ success: false, error: "Gift token is required." }, { status: 400 });
    }

    const verified = verifyGiftToken(token);
    if (!verified.valid) {
      return NextResponse.json({ success: false, error: verified.error }, { status: 400 });
    }

    const tokenData = verified.payload;
    const recipient = await payload.findByID({
      collection: "users",
      id: recipientId as any,
      depth: 0,
      overrideAccess: true,
    });
    const recipientEmail = normalizeEmail((recipient as any)?.email);
    if (!recipientEmail || recipientEmail !== normalizeEmail(tokenData.recipientEmail)) {
      return NextResponse.json(
        { success: false, error: "Gift link is assigned to another email." },
        { status: 403 }
      );
    }

    const giver = await payload.findByID({
      collection: "users",
      id: tokenData.giverUserId as any,
      depth: 1,
      overrideAccess: true,
    });
    const giverPurchased = Array.isArray((giver as any)?.purchasedProducts)
      ? ((giver as any).purchasedProducts as unknown[])
      : [];
    const giverPurchasedIds = new Set(extractPurchasedIds(giverPurchased));
    if (!giverPurchasedIds.has(normalizeId(tokenData.productId))) {
      return NextResponse.json(
        { success: false, error: "Gift is no longer available." },
        { status: 409 }
      );
    }

    const recipientPurchased = Array.isArray((recipient as any)?.purchasedProducts)
      ? ((recipient as any).purchasedProducts as unknown[])
      : [];
    const recipientPurchasedIds = new Set(extractPurchasedIds(recipientPurchased));
    const alreadyOwned = recipientPurchasedIds.has(normalizeId(tokenData.productId));

    if (!alreadyOwned) {
      const nextPurchased = Array.from(
        new Set([...recipientPurchasedIds, normalizeId(tokenData.productId)])
      );
      await payload.update({
        collection: "users",
        id: recipientId as any,
        data: {
          purchasedProducts: nextPurchased,
        },
        overrideAccess: true,
      });
    }

    return NextResponse.json(
      {
        success: true,
        alreadyOwned,
        productName: tokenData.productName || "Digital STL",
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to claim gift.",
      },
      { status: 500 }
    );
  }
}

