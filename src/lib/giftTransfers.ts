import { normalizeEmail as normalizeGiftEmail } from "@/lib/giftLinks";

export type GiftTransferStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELED";
export type EntitlementStatus =
  | "ACTIVE"
  | "REVOKED"
  | "TRANSFER_PENDING"
  | "TRANSFERRED";

export const GIFT_TRANSFER_DEFAULT_HOURS = 72;
export const GIFT_TRANSFER_MAX_HOURS = 24 * 14;
export const GIFT_TRANSFER_MESSAGE_MAX = 500;

export const normalizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const normalizeEmail = (value: unknown) => normalizeGiftEmail(normalizeString(value));

export const normalizeGiftMessage = (value: unknown) =>
  normalizeString(value).slice(0, GIFT_TRANSFER_MESSAGE_MAX);

export const normalizeRelationshipId = (value: unknown): string | number | null => {
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
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return raw;
};

export const normalizeGiftTransferStatus = (value: unknown): GiftTransferStatus => {
  const raw = normalizeString(value).toUpperCase();
  if (raw === "ACCEPTED") return "ACCEPTED";
  if (raw === "EXPIRED") return "EXPIRED";
  if (raw === "CANCELED") return "CANCELED";
  return "PENDING";
};

export const normalizeEntitlementStatus = (value: unknown): EntitlementStatus => {
  const raw = normalizeString(value).toUpperCase();
  if (raw === "REVOKED") return "REVOKED";
  if (raw === "TRANSFER_PENDING") return "TRANSFER_PENDING";
  if (raw === "TRANSFERRED") return "TRANSFERRED";
  return "ACTIVE";
};

export const resolveGiftTransferHours = (value: unknown) => {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) {
    return GIFT_TRANSFER_DEFAULT_HOURS;
  }
  return Math.min(Math.max(1, Math.round(requested)), GIFT_TRANSFER_MAX_HOURS);
};

export const resolveGiftTransferExpiryIso = (hours: number, now = Date.now()) =>
  new Date(now + hours * 60 * 60 * 1000).toISOString();

const mergeMeta = (meta: unknown, patch: Record<string, unknown>) => {
  const base =
    meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  return { ...base, ...patch };
};

export const expireSingleGiftTransfer = async (args: {
  payload: any;
  transfer: any;
  nowIso?: string;
}) => {
  const { payload, transfer } = args;
  const nowIso = args.nowIso || new Date().toISOString();

  const transferStatus = normalizeGiftTransferStatus(transfer?.status);
  if (transferStatus !== "PENDING") return false;

  const entitlementId = normalizeRelationshipId(transfer?.entitlement);
  if (entitlementId !== null) {
    const entitlement = await payload
      .findByID({
        collection: "digital_entitlements",
        id: entitlementId as any,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);

    if (entitlement) {
      const entitlementStatus = normalizeEntitlementStatus(entitlement?.status);
      if (entitlementStatus === "TRANSFER_PENDING") {
        await payload.update({
          collection: "digital_entitlements",
          id: entitlement.id,
          depth: 0,
          overrideAccess: true,
          data: {
            status: "ACTIVE",
            meta: mergeMeta(entitlement?.meta, {
              transferExpiredAt: nowIso,
              transferState: "expired",
            }),
          },
        });
      }
    }
  }

  await payload.update({
    collection: "gift_transfers",
    id: transfer.id,
    depth: 0,
    overrideAccess: true,
    data: {
      status: "EXPIRED",
      expiredAt: nowIso,
      meta: mergeMeta(transfer?.meta, { expiredAt: nowIso }),
    },
  });
  return true;
};

export const expirePendingGiftTransfers = async (args: {
  payload: any;
  scopeWhere?: Record<string, unknown> | null;
  limit?: number;
}) => {
  const { payload, scopeWhere } = args;
  const limit = Math.max(1, Math.min(200, args.limit || 100));
  const nowIso = new Date().toISOString();
  const andWhere: any[] = [
    { status: { equals: "PENDING" } },
    { expiresAt: { less_than_equal: nowIso } },
  ];
  if (scopeWhere) {
    andWhere.push(scopeWhere);
  }

  const found = await payload.find({
    collection: "gift_transfers",
    depth: 0,
    limit,
    sort: "expiresAt",
    overrideAccess: true,
    where: andWhere.length === 1 ? andWhere[0] : { and: andWhere },
  });

  const docs = Array.isArray(found?.docs) ? found.docs : [];
  let expired = 0;
  for (const transfer of docs) {
    const applied = await expireSingleGiftTransfer({
      payload,
      transfer,
      nowIso,
    });
    if (applied) expired += 1;
  }
  return { expired };
};

