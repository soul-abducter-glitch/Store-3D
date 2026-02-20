import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "@payload-config";
import {
  claimEmailEntitlementsForUser,
  isPaidOrderForEntitlement,
  normalizeEmail,
  normalizeRelationshipId,
  toEntitlementPublic,
} from "@/lib/digitalEntitlements";
import { verifyDigitalGuestToken } from "@/lib/digitalGuestTokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MediaDoc = {
  url?: string;
  filename?: string;
  filesize?: number;
};

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const resolveMediaUrl = (value?: any) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.url === "string") return value.url;
  if (typeof value?.filename === "string") return `/media/${value.filename}`;
  return "";
};

const formatFileSize = (bytes?: number) => {
  if (!Number.isFinite(bytes || NaN) || !bytes || bytes <= 0) return "N/A";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
};

const parseAuthUser = async (payload: any, request: NextRequest) => {
  try {
    const auth = await payload.auth({ headers: request.headers });
    const id = normalizeRelationshipId(auth?.user?.id);
    if (id === null) return null;
    return {
      id,
      email: normalizeEmail(auth?.user?.email),
    };
  } catch {
    return null;
  }
};

export async function GET(request: NextRequest) {
  const payload = await getPayloadClient();
  const user = await parseAuthUser(payload, request);

  const tokenFromQuery = (request.nextUrl.searchParams.get("token") || "").trim();
  const tokenFromHeader = (request.headers.get("x-digital-guest-token") || "").trim();
  const guestToken = tokenFromQuery || tokenFromHeader;
  let guestEmail = "";
  let guestOrderId: string | number | null = null;

  if (guestToken) {
    const verified = verifyDigitalGuestToken(guestToken);
    if (!verified.valid) {
      return NextResponse.json(
        { success: false, error: verified.error || "Недействительная гостевая ссылка." },
        { status: 401 }
      );
    }
    guestEmail = normalizeEmail(verified.payload.email);
    guestOrderId = normalizeRelationshipId(verified.payload.orderId);
  }

  if (user?.id && user.email) {
    await claimEmailEntitlementsForUser({
      payload,
      userId: user.id,
      email: user.email,
    }).catch(() => null);
  }

  if (!user?.id && !guestEmail) {
    return NextResponse.json(
      { success: false, error: "Требуется авторизация или гостевая ссылка." },
      { status: 401 }
    );
  }

  const ownerConditions: any[] = [];
  if (user?.id) {
    ownerConditions.push({
      and: [{ ownerType: { equals: "USER" } }, { ownerUser: { equals: user.id as any } }],
    });
  }
  if (user?.email) {
    ownerConditions.push({
      and: [{ ownerType: { equals: "EMAIL" } }, { ownerEmail: { equals: user.email } }],
    });
  }
  if (guestEmail) {
    ownerConditions.push({
      and: [{ ownerType: { equals: "EMAIL" } }, { ownerEmail: { equals: guestEmail } }],
    });
  }

  const whereAnd: any[] = [];
  if (ownerConditions.length === 1) {
    whereAnd.push(ownerConditions[0]);
  } else {
    whereAnd.push({ or: ownerConditions });
  }
  if (guestOrderId !== null) {
    whereAnd.push({ order: { equals: guestOrderId as any } });
  }

  const entitlementsResult = await payload.find({
    collection: "digital_entitlements",
    depth: 0,
    limit: 200,
    sort: "-createdAt",
    where: whereAnd.length === 1 ? whereAnd[0] : { and: whereAnd },
    overrideAccess: true,
  });
  const entitlementDocs = Array.isArray(entitlementsResult?.docs) ? entitlementsResult.docs : [];

  const productIds = Array.from(
    new Set(
      entitlementDocs
        .map((row: any) => normalizeRelationshipId(row?.product))
        .filter((id: string | number | null): id is string | number => id !== null)
        .map((id) => String(id))
    )
  );
  const orderIds = Array.from(
    new Set(
      entitlementDocs
        .map((row: any) => normalizeRelationshipId(row?.order))
        .filter((id: string | number | null): id is string | number => id !== null)
        .map((id) => String(id))
    )
  );

  const [productsById, ordersById] = await Promise.all([
    (async () => {
      const entries = await Promise.all(
        productIds.map(async (id) => {
          const relationId = normalizeRelationshipId(id);
          if (relationId === null) return [id, null] as const;
          const product = await payload
            .findByID({
              collection: "products",
              id: relationId as any,
              depth: 1,
              overrideAccess: true,
            })
            .catch(() => null);
          return [id, product] as const;
        })
      );
      return new Map<string, any>(entries);
    })(),
    (async () => {
      const entries = await Promise.all(
        orderIds.map(async (id) => {
          const relationId = normalizeRelationshipId(id);
          if (relationId === null) return [id, null] as const;
          const order = await payload
            .findByID({
              collection: "orders",
              id: relationId as any,
              depth: 0,
              overrideAccess: true,
            })
            .catch(() => null);
          return [id, order] as const;
        })
      );
      return new Map<string, any>(entries);
    })(),
  ]);

  const items = entitlementDocs.map((doc: any) => {
    const entitlement = toEntitlementPublic(doc);
    const product = productsById.get(entitlement.productId) || null;
    const order = ordersById.get(entitlement.orderId) || null;

    const paintedModel = product?.paintedModel as MediaDoc | null | undefined;
    const rawModel = product?.rawModel as MediaDoc | null | undefined;
    const previewUrl = resolveMediaUrl(paintedModel) || resolveMediaUrl(rawModel);
    const selectedMedia = (paintedModel || rawModel) as MediaDoc | null;
    const format =
      typeof product?.format === "string" && product.format.trim()
        ? product.format.trim()
        : "Digital STL";
    const paid = isPaidOrderForEntitlement(order);
    const active = entitlement.status === "ACTIVE";
    const hasFile = Boolean(selectedMedia && (selectedMedia.filename || selectedMedia.url));
    const canDownload = active && paid && hasFile;

    let blockedReason = "";
    if (!active) blockedReason = "Доступ к файлу отозван";
    else if (!paid) blockedReason = "Покупка не подтверждена";
    else if (!hasFile) blockedReason = "Файл временно недоступен";

    const fileSize = formatFileSize(
      typeof selectedMedia?.filesize === "number" ? selectedMedia.filesize : undefined
    );

    return {
      id: entitlement.id || `${entitlement.productId}:${entitlement.orderId}`,
      entitlementId: entitlement.id,
      productId: entitlement.productId,
      variantId: entitlement.variantId,
      title:
        (typeof product?.name === "string" && product.name.trim()) ||
        (typeof product?.slug === "string" && product.slug.trim()) ||
        "Цифровой файл",
      format,
      previewUrl,
      fileSize,
      status: entitlement.status,
      canDownload,
      blockedReason,
      purchasedAt: order?.paidAt || order?.createdAt || entitlement.createdAt || null,
      lastUpdatedAt: entitlement.updatedAt || null,
      orderId: entitlement.orderId,
    };
  });

  return NextResponse.json(
    {
      success: true,
      items,
      guest: !user?.id && Boolean(guestEmail),
    },
    { status: 200 }
  );
}
