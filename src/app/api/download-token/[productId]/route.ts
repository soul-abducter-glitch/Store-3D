import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { createDownloadToken } from "@/lib/downloadTokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProductDoc = {
  id?: string | number;
  slug?: string;
  value?: unknown;
  _id?: unknown;
};

type UserDoc = {
  id?: string | number;
  purchasedProducts?: Array<ProductDoc | string | number | null> | null;
};

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeId = (value: unknown) => String(value ?? "").trim();

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
  const base = raw.split(":")[0]?.trim() ?? "";
  if (!base || /\s/.test(base)) return null;
  if (/^\d+$/.test(base)) return Number(base);
  return base;
};

const pickPurchasedProduct = (
  products: Array<ProductDoc | string | number | null>,
  target: string
) => {
  for (const entry of products) {
    if (!entry) continue;
    if (typeof entry === "string" || typeof entry === "number") {
      if (normalizeId(entry) === target) {
        return entry;
      }
      continue;
    }
    if (
      normalizeId(entry.id) === target ||
      normalizeId(entry.value) === target ||
      normalizeId(entry._id) === target ||
      entry.slug === target
    ) {
      return entry;
    }
  }
  return null;
};

const fetchUser = async (payload: any, request: NextRequest) => {
  try {
    const authResult = await payload.auth({ headers: request.headers });
    const relationId = normalizeRelationshipId(authResult?.user?.id);
    if (!relationId) return null;
    return (await payload.findByID({
      collection: "users",
      id: relationId,
      depth: 2,
      overrideAccess: true,
    })) as UserDoc;
  } catch {
    return null;
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolvedParams = await params;
  const target = normalizeId(resolvedParams?.productId);
  if (!target) {
    return NextResponse.json({ success: false, error: "Missing product id." }, { status: 400 });
  }

  const payload = await getPayloadClient();
  const user = await fetchUser(payload, request);
  if (!user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  const purchasedProducts = Array.isArray(user?.purchasedProducts)
    ? user.purchasedProducts
    : [];
  const purchasedEntry = pickPurchasedProduct(purchasedProducts, target);
  if (!purchasedEntry) {
    return NextResponse.json({ success: false, error: "Access denied." }, { status: 403 });
  }

  const token = createDownloadToken({
    userId: String(user.id),
    productId: target,
  });

  const downloadUrl = `/api/download/${encodeURIComponent(target)}?token=${encodeURIComponent(
    token
  )}`;
  return NextResponse.json({ success: true, downloadUrl }, { status: 200 });
}

