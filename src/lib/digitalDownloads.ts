import type { NextRequest } from "next/server";

import { createDownloadToken } from "@/lib/downloadTokens";
import { isPaidOrderForEntitlement, normalizeRelationshipId } from "@/lib/digitalEntitlements";

const DEFAULT_LINK_LIMIT_24H = 20;
const DEFAULT_LINK_WINDOW_HOURS = 24;
const DEFAULT_DOWNLOAD_TTL_SECONDS = 600;

const normalizeId = (value: unknown) => {
  const id = normalizeRelationshipId(value);
  return id === null ? "" : String(id);
};

const normalizeOwnerType = (value: unknown): "USER" | "EMAIL" | "" => {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (raw === "USER" || raw === "EMAIL") return raw;
  return "";
};

const resolveOwnerRef = (entitlement: any) => {
  const ownerType = normalizeOwnerType(entitlement?.ownerType);
  if (ownerType === "USER") {
    return normalizeId(entitlement?.ownerUser);
  }
  if (ownerType === "EMAIL") {
    return String(entitlement?.ownerEmail ?? "")
      .trim()
      .toLowerCase();
  }
  return "";
};

const resolveRequestIp = (request: NextRequest) => {
  const forwarded = (request.headers.get("x-forwarded-for") || "").trim();
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "";
  }
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    ""
  ).trim();
};

const resolveLinkLimit = () => {
  const parsed = Number.parseInt((process.env.DIGITAL_DOWNLOAD_LINK_LIMIT_24H || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LINK_LIMIT_24H;
  return Math.min(Math.max(parsed, 5), 500);
};

const resolveLinkWindowHours = () => {
  const parsed = Number.parseInt((process.env.DIGITAL_DOWNLOAD_LINK_WINDOW_HOURS || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LINK_WINDOW_HOURS;
  return Math.min(Math.max(parsed, 1), 72);
};

const resolveDownloadTtlSeconds = () => {
  const parsed = Number.parseInt((process.env.DOWNLOAD_LINK_TTL_SECONDS || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DOWNLOAD_TTL_SECONDS;
  return Math.min(Math.max(parsed, 300), 1800);
};

const hasDownloadFile = (product: any) => Boolean(product?.rawModel || product?.paintedModel);

export const createDownloadEvent = async (args: {
  payload: any;
  entitlementId?: string | number | null;
  orderId?: string | number | null;
  productId?: string | number | null;
  status: "OK" | "DENY";
  reason?: string;
  ownerType?: "USER" | "EMAIL";
  ownerRef?: string;
  ip?: string;
  userAgent?: string;
}) => {
  const {
    payload,
    entitlementId,
    orderId,
    productId,
    status,
    reason,
    ownerType,
    ownerRef,
    ip,
    userAgent,
  } = args;
  const normalizedEntitlementId = normalizeRelationshipId(entitlementId);
  if (normalizedEntitlementId === null) return;

  try {
    await payload.create({
      collection: "download_events",
      overrideAccess: true,
      data: {
        entitlement: normalizedEntitlementId as any,
        order: normalizeRelationshipId(orderId) ?? undefined,
        product: normalizeRelationshipId(productId) ?? undefined,
        status,
        reason: reason ? String(reason).slice(0, 120) : undefined,
        ownerType: ownerType === "EMAIL" ? "EMAIL" : "USER",
        ownerRef: String(ownerRef || "unknown").slice(0, 240),
        ip: String(ip || "").slice(0, 120),
        userAgent: String(userAgent || "").slice(0, 1024),
      },
    });
  } catch {
    // ignore logging errors
  }
};

export const issueDownloadLinkForEntitlement = async (args: {
  payload: any;
  entitlement: any;
  request: NextRequest;
}) => {
  const { payload, entitlement, request } = args;
  const entitlementId = normalizeRelationshipId(entitlement?.id);
  if (entitlementId === null) {
    return { ok: false as const, status: 404, error: "Право на скачивание не найдено." };
  }

  const ownerType = normalizeOwnerType(entitlement?.ownerType);
  const ownerRef = resolveOwnerRef(entitlement);
  const productId = normalizeRelationshipId(entitlement?.product);
  const orderId = normalizeRelationshipId(entitlement?.order);
  const status = String(entitlement?.status || "")
    .trim()
    .toUpperCase();

  if (!ownerType || !ownerRef || productId === null || orderId === null) {
    return { ok: false as const, status: 400, error: "Некорректные данные права доступа." };
  }
  if (status !== "ACTIVE") {
    return { ok: false as const, status: 403, error: "Доступ к файлу отозван." };
  }

  const order = await payload
    .findByID({
      collection: "orders",
      id: orderId as any,
      depth: 0,
      overrideAccess: true,
    })
    .catch(() => null);
  if (!order || !isPaidOrderForEntitlement(order)) {
    return { ok: false as const, status: 403, error: "Покупка не подтверждена." };
  }

  const product = await payload
    .findByID({
      collection: "products",
      id: productId as any,
      depth: 1,
      overrideAccess: true,
    })
    .catch(() => null);
  if (!product || !hasDownloadFile(product)) {
    return { ok: false as const, status: 404, error: "Файл временно недоступен." };
  }

  const linkLimit = resolveLinkLimit();
  const linkWindowHours = resolveLinkWindowHours();
  const linkWindowStart = new Date(Date.now() - linkWindowHours * 3600 * 1000).toISOString();
  const linkEvents = await payload.find({
    collection: "download_link_events",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      and: [
        { entitlement: { equals: entitlementId as any } },
        { createdAt: { greater_than_equal: linkWindowStart } },
      ],
    },
  });
  const issuedInWindow =
    typeof linkEvents?.totalDocs === "number"
      ? linkEvents.totalDocs
      : Array.isArray(linkEvents?.docs)
        ? linkEvents.docs.length
        : 0;

  if (issuedInWindow >= linkLimit) {
    return {
      ok: false as const,
      status: 429,
      error:
        "Слишком много попыток скачивания. Попробуйте позже или обратитесь в поддержку.",
    };
  }

  const ttlSeconds = resolveDownloadTtlSeconds();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const token = createDownloadToken({
    entitlementId: String(entitlementId),
    productId: String(productId),
    ownerType,
    ownerRef,
    orderId: String(orderId),
  });

  const ip = resolveRequestIp(request);
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 1024);
  await payload.create({
    collection: "download_link_events",
    overrideAccess: true,
    data: {
      entitlement: entitlementId as any,
      order: orderId as any,
      product: productId as any,
      ownerType,
      ownerRef,
      ip: ip || undefined,
      userAgent: userAgent || undefined,
      expiresAt,
    },
  });

  const downloadUrl = `/api/download/${encodeURIComponent(String(productId))}?token=${encodeURIComponent(token)}`;

  return {
    ok: true as const,
    downloadUrl,
    expiresAt,
    ownerType,
    ownerRef,
    productId: String(productId),
    orderId: String(orderId),
    entitlementId: String(entitlementId),
  };
};
