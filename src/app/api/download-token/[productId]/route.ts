import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "@payload-config";
import { normalizeEmail, normalizeRelationshipId, resolveEntitlementForAccess } from "@/lib/digitalEntitlements";
import { issueDownloadLinkForEntitlement } from "@/lib/digitalDownloads";
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
  email?: string;
  purchasedProducts?: Array<ProductDoc | string | number | null> | null;
};

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeId = (value: unknown) => String(value ?? "").trim();

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
      depth: 0,
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

  const entitlement = await resolveEntitlementForAccess({
    payload,
    productId: target,
    userId: user.id,
    userEmail: normalizeEmail(user.email),
  });

  if (entitlement) {
    const issued = await issueDownloadLinkForEntitlement({
      payload,
      entitlement,
      request,
    });

    if (!issued.ok) {
      return NextResponse.json({ success: false, error: issued.error }, { status: issued.status });
    }

    return NextResponse.json(
      {
        success: true,
        downloadUrl: issued.downloadUrl,
        expiresAt: issued.expiresAt,
        legacy: false,
      },
      { status: 200 }
    );
  }

  const purchasedProducts = Array.isArray(user?.purchasedProducts)
    ? user.purchasedProducts
    : [];
  const purchasedEntry = pickPurchasedProduct(purchasedProducts, target);
  if (!purchasedEntry) {
    return NextResponse.json(
      { success: false, error: "Access denied." },
      { status: 403 }
    );
  }

  const token = createDownloadToken({
    userId: String(user.id),
    productId: target,
  });

  const downloadUrl = `/api/download/${encodeURIComponent(target)}?token=${encodeURIComponent(
    token
  )}`;
  return NextResponse.json(
    { success: true, downloadUrl, legacy: true },
    { status: 200 }
  );
}
