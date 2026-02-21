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
import {
  expirePendingGiftTransfers,
  normalizeEntitlementStatus,
  normalizeGiftTransferStatus,
  normalizeString,
} from "@/lib/giftTransfers";
import { verifyDigitalGuestToken } from "@/lib/digitalGuestTokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MediaDoc = {
  url?: string;
  filename?: string;
  filesize?: number;
};

const LEGACY_DOWNLOAD_FIELDS = [
  "modelUrl",
  "modelFile",
  "downloadUrl",
  "downloadFile",
  "digitalFile",
  "fileUrl",
  "sourceUrl",
  "stlFile",
  "stlUrl",
  "glbFile",
  "glbUrl",
  "assetUrl",
  "file",
  "model",
];

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const resolveMediaUrl = (value?: any) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.url === "string") return value.url;
  if (typeof value?.filename === "string") return `/media/${value.filename}`;
  return "";
};

const resolveLegacyMedia = (product: any): MediaDoc | null => {
  if (!product || typeof product !== "object") return null;
  for (const key of LEGACY_DOWNLOAD_FIELDS) {
    const value = product[key];
    if (!value) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      return {
        url: trimmed,
        filename: trimmed.split("?")[0].split("#")[0].split("/").pop() || undefined,
      };
    }
    if (typeof value?.url === "string" || typeof value?.filename === "string") {
      return value as MediaDoc;
    }
  }
  return null;
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

const buildTransferBlockedReason = (args: {
  entitlementStatus: ReturnType<typeof normalizeEntitlementStatus>;
  pendingTransfer: any | null;
}) => {
  const { entitlementStatus, pendingTransfer } = args;
  if (entitlementStatus === "REVOKED") return "Доступ к файлу отозван";
  if (entitlementStatus === "TRANSFERRED") return "Лицензия передана другому пользователю";
  if (entitlementStatus === "TRANSFER_PENDING") {
    const expiresAt = normalizeString(pendingTransfer?.expiresAt);
    if (expiresAt) {
      return `Передача подарка ожидает принятия до ${new Date(expiresAt).toLocaleString("ru-RU")}`;
    }
    return "Передача подарка ожидает принятия";
  }
  return "";
};

const isProductGiftable = (product: any) => {
  const explicit = product?.giftable;
  if (explicit === false) return false;
  return true;
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

  if (user?.id) {
    await expirePendingGiftTransfers({
      payload,
      scopeWhere: { senderUser: { equals: user.id as any } },
      limit: 200,
    }).catch(() => null);
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

  const entitlementIds = Array.from(
    new Set(
      entitlementDocs
        .map((row: any) => normalizeRelationshipId(row?.id))
        .filter((id: string | number | null): id is string | number => id !== null)
        .map((id) => String(id))
    )
  );
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

  const [productsById, ordersById, pendingTransfersByEntitlementId] = await Promise.all([
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
    (async () => {
      if (!entitlementIds.length) return new Map<string, any>();
      const pendingResult = await payload.find({
        collection: "gift_transfers",
        depth: 0,
        limit: 500,
        sort: "-createdAt",
        overrideAccess: true,
        where: {
          and: [
            { status: { equals: "PENDING" } },
            { entitlement: { in: entitlementIds as any } },
          ],
        },
      });
      const docs = Array.isArray(pendingResult?.docs) ? pendingResult.docs : [];
      const map = new Map<string, any>();
      for (const transfer of docs) {
        const status = normalizeGiftTransferStatus(transfer?.status);
        if (status !== "PENDING") continue;
        const entitlementId = normalizeRelationshipId(transfer?.entitlement);
        if (entitlementId === null) continue;
        const key = String(entitlementId);
        if (!map.has(key)) {
          map.set(key, transfer);
        }
      }
      return map;
    })(),
  ]);

  const items = entitlementDocs.map((doc: any) => {
    const entitlement = toEntitlementPublic(doc);
    const product = productsById.get(entitlement.productId) || null;
    const order = ordersById.get(entitlement.orderId) || null;
    const entitlementStatus = normalizeEntitlementStatus(entitlement.status);
    const pendingTransfer = pendingTransfersByEntitlementId.get(String(entitlement.id)) || null;

    const paintedModel = product?.paintedModel as MediaDoc | null | undefined;
    const rawModel = product?.rawModel as MediaDoc | null | undefined;
    const legacyMedia = resolveLegacyMedia(product);
    const previewUrl =
      resolveMediaUrl(paintedModel) || resolveMediaUrl(rawModel) || resolveMediaUrl(legacyMedia);
    const selectedMedia = (paintedModel || rawModel || legacyMedia) as MediaDoc | null;
    const format =
      typeof product?.format === "string" && product.format.trim()
        ? product.format.trim()
        : "Digital STL";
    const paid = isPaidOrderForEntitlement(order);
    const active = entitlementStatus === "ACTIVE";
    const hasFile = Boolean(selectedMedia && (selectedMedia.filename || selectedMedia.url));
    const canDownload = active && paid && hasFile;

    let blockedReason = "";
    if (!active) {
      blockedReason = buildTransferBlockedReason({ entitlementStatus, pendingTransfer });
    } else if (!paid) {
      blockedReason = "Покупка не подтверждена";
    } else if (!hasFile) {
      blockedReason = "Файл временно недоступен";
    }

    const isGuest = !user?.id && Boolean(guestEmail);
    const pendingOutgoing =
      pendingTransfer &&
      user?.id &&
      String(normalizeRelationshipId(pendingTransfer?.senderUser) ?? "") === String(user.id);
    const pendingIncoming =
      pendingTransfer &&
      user?.email &&
      normalizeEmail(pendingTransfer?.recipientEmail) === user.email;
    const giftable =
      Boolean(user?.id) &&
      !isGuest &&
      active &&
      paid &&
      hasFile &&
      !pendingTransfer &&
      isProductGiftable(product);

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
      giftable,
      giftStatus: pendingOutgoing ? "pending_outgoing" : pendingIncoming ? "pending_incoming" : "none",
      giftTransferId: pendingTransfer ? String(pendingTransfer.id) : null,
      giftRecipientEmail: pendingTransfer ? normalizeEmail(pendingTransfer.recipientEmail) : null,
      giftExpiresAt: pendingTransfer?.expiresAt || null,
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

