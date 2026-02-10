import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { createGiftToken, normalizeEmail } from "@/lib/giftLinks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const fetchProductByIdOrSlug = async (payload: any, target: string) => {
  if (!target) return null;
  const where: { or: Array<Record<string, { equals: string | number }>> } = {
    or: [{ slug: { equals: target } }, { id: { equals: target } }],
  };
  if (/^\d+$/.test(target)) {
    where.or.unshift({ id: { equals: Number(target) } });
  }
  const result = await payload.find({
    collection: "products",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where,
  });
  return result?.docs?.[0] ?? null;
};

const hasPurchasedProduct = (purchasedProducts: unknown[], product: any, target: string) => {
  const targetSet = new Set(
    [target, normalizeId(product?.id), normalizeId(product?.slug)].filter(Boolean)
  );
  return purchasedProducts.some((entry: any) => {
    const relId = normalizeRelationshipId(entry);
    const id = normalizeId(relId);
    const slug = normalizeId(entry?.slug);
    return targetSet.has(id) || targetSet.has(slug);
  });
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload({ config: payloadConfig });
    const auth = await payload.auth({ headers: request.headers });
    const giverId = normalizeRelationshipId(auth?.user?.id);
    if (!giverId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const target = normalizeId(body?.productId);
    const recipientEmail = normalizeEmail(body?.recipientEmail);
    const requestedHours = Number(body?.expiresInHours);
    const expiresInHours =
      Number.isFinite(requestedHours) && requestedHours > 0 ? requestedHours : 72;

    if (!target) {
      return NextResponse.json(
        { success: false, error: "Product id is required." },
        { status: 400 }
      );
    }
    if (!recipientEmail || !EMAIL_REGEX.test(recipientEmail)) {
      return NextResponse.json(
        { success: false, error: "Recipient email is invalid." },
        { status: 400 }
      );
    }

    const giver = await payload.findByID({
      collection: "users",
      id: giverId as any,
      depth: 1,
      overrideAccess: true,
    });
    const purchasedProducts = Array.isArray((giver as any)?.purchasedProducts)
      ? ((giver as any).purchasedProducts as unknown[])
      : [];
    const product = await fetchProductByIdOrSlug(payload, target);
    if (!product) {
      return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });
    }
    if (!hasPurchasedProduct(purchasedProducts, product, target)) {
      return NextResponse.json(
        { success: false, error: "You can gift only purchased products." },
        { status: 403 }
      );
    }

    const token = createGiftToken(
      {
        giverUserId: String(giverId),
        productId: String(product.id),
        recipientEmail,
        productName: typeof product.name === "string" ? product.name : undefined,
      },
      expiresInHours
    );
    const giftUrl = `${request.nextUrl.origin}/gift/claim?token=${encodeURIComponent(token)}`;

    return NextResponse.json(
      {
        success: true,
        giftUrl,
        expiresInHours: Math.min(Math.max(1, Math.round(expiresInHours)), 24 * 14),
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to create gift link.",
      },
      { status: 500 }
    );
  }
}

