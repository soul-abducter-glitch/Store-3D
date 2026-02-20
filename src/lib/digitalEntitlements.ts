export type EntitlementOwnerType = "USER" | "EMAIL";

const normalizeText = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

export const normalizeEmail = (value: unknown) => normalizeText(value).toLowerCase();

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
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
};

const normalizeIdString = (value: unknown) => {
  const id = normalizeRelationshipId(value);
  return id === null ? "" : String(id);
};

const normalizeVariantId = (value: unknown) => normalizeText(value).slice(0, 80);

const isDigitalFormat = (value: unknown) => {
  const raw = normalizeText(value).toLowerCase();
  return raw.includes("digital") || raw.includes("цифров");
};

const entitlementKey = (productId: string | number, variantId: string) =>
  `${String(productId)}::${variantId}`;

const collectDigitalEntitlementKeys = (items: unknown) => {
  if (!Array.isArray(items)) return [] as Array<{ productId: string | number; variantId: string }>;

  const seen = new Set<string>();
  const result: Array<{ productId: string | number; variantId: string }> = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (!isDigitalFormat(row.format ?? row.formatKey ?? row.type ?? row.formatLabel)) {
      continue;
    }
    const productId = normalizeRelationshipId(row.product);
    if (productId === null) continue;
    const variantId = normalizeVariantId(row.variantId);
    const key = entitlementKey(productId, variantId);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ productId, variantId });
  }

  return result;
};

const normalizeStatus = (value: unknown) => normalizeText(value).toLowerCase();

export const isPaidOrderForEntitlement = (order: any) => {
  const paymentStatus = normalizeStatus(order?.paymentStatus);
  const orderStatus = normalizeStatus(order?.status);
  return (
    paymentStatus === "paid" ||
    orderStatus === "paid" ||
    orderStatus === "completed"
  );
};

export const isRevokedOrderForEntitlement = (order: any) => {
  const paymentStatus = normalizeStatus(order?.paymentStatus);
  const orderStatus = normalizeStatus(order?.status);
  return paymentStatus === "refunded" || orderStatus === "cancelled" || orderStatus === "canceled";
};

const getOwnerFromOrder = (order: any): { ownerType: EntitlementOwnerType; ownerUserId: string | number | null; ownerEmail: string } | null => {
  const ownerUserId = normalizeRelationshipId(order?.user);
  const ownerEmail = normalizeEmail(order?.customer?.email);

  if (ownerUserId !== null) {
    return {
      ownerType: "USER",
      ownerUserId,
      ownerEmail,
    };
  }

  if (ownerEmail) {
    return {
      ownerType: "EMAIL",
      ownerUserId: null,
      ownerEmail,
    };
  }

  return null;
};

export const syncDigitalEntitlementsForOrder = async (args: {
  payload: any;
  order: any;
  previousOrder?: any;
}) => {
  const { payload, order, previousOrder } = args;
  const orderId = normalizeRelationshipId(order?.id);
  if (orderId === null) {
    return { created: 0, updated: 0, revoked: 0 };
  }

  const currentKeys = collectDigitalEntitlementKeys(order?.items);
  const previousKeys = collectDigitalEntitlementKeys(previousOrder?.items);
  const shouldGrant = isPaidOrderForEntitlement(order);
  const shouldRevokeAll = isRevokedOrderForEntitlement(order);
  const owner = getOwnerFromOrder(order);

  const found = await payload.find({
    collection: "digital_entitlements",
    depth: 0,
    limit: 500,
    sort: "-createdAt",
    where: {
      order: {
        equals: orderId as any,
      },
    },
    overrideAccess: true,
  });

  const existing = Array.isArray(found?.docs) ? found.docs : [];
  const existingByKey = new Map<string, any[]>();
  for (const row of existing) {
    const productId = normalizeRelationshipId(row?.product);
    if (productId === null) continue;
    const variantId = normalizeVariantId(row?.variantId);
    const key = entitlementKey(productId, variantId);
    const list = existingByKey.get(key) ?? [];
    list.push(row);
    existingByKey.set(key, list);
  }

  let created = 0;
  let updated = 0;
  let revoked = 0;

  if (shouldGrant && owner && currentKeys.length > 0) {
    for (const entry of currentKeys) {
      const key = entitlementKey(entry.productId, entry.variantId);
      const matches = existingByKey.get(key) ?? [];
      const active = matches.find((doc) => normalizeStatus(doc?.status) === "active") ?? null;

      if (active) {
        const patch: Record<string, unknown> = {};
        const currentOwnerType = String(active?.ownerType || "").toUpperCase();
        const currentOwnerUserId = normalizeRelationshipId(active?.ownerUser);
        const currentOwnerEmail = normalizeEmail(active?.ownerEmail);

        if (currentOwnerType !== owner.ownerType) {
          patch.ownerType = owner.ownerType;
        }
        if (owner.ownerType === "USER") {
          if (currentOwnerUserId === null || String(currentOwnerUserId) !== String(owner.ownerUserId)) {
            patch.ownerUser = owner.ownerUserId as any;
          }
          if (owner.ownerEmail && currentOwnerEmail !== owner.ownerEmail) {
            patch.ownerEmail = owner.ownerEmail;
          }
        } else if (currentOwnerEmail !== owner.ownerEmail) {
          patch.ownerEmail = owner.ownerEmail;
        }

        if (normalizeStatus(active?.status) === "revoked") {
          patch.status = "ACTIVE";
          patch.revokedAt = null;
        }

        if (Object.keys(patch).length > 0) {
          await payload.update({
            collection: "digital_entitlements",
            id: active.id,
            data: patch,
            overrideAccess: true,
          });
          updated += 1;
        }
        continue;
      }

      const data: Record<string, unknown> = {
        ownerType: owner.ownerType,
        ownerEmail: owner.ownerEmail || undefined,
        product: entry.productId as any,
        variantId: entry.variantId || undefined,
        order: orderId as any,
        status: "ACTIVE",
      };
      if (owner.ownerType === "USER") {
        data.ownerUser = owner.ownerUserId as any;
      }

      await payload.create({
        collection: "digital_entitlements",
        data,
        overrideAccess: true,
      });
      created += 1;
    }
  }

  const revokeKeys = new Set<string>();
  if (shouldRevokeAll) {
    for (const row of existing) {
      const productId = normalizeRelationshipId(row?.product);
      if (productId === null) continue;
      const key = entitlementKey(productId, normalizeVariantId(row?.variantId));
      revokeKeys.add(key);
    }
  } else if (previousKeys.length > 0) {
    const currentSet = new Set(currentKeys.map((entry) => entitlementKey(entry.productId, entry.variantId)));
    for (const prev of previousKeys) {
      const key = entitlementKey(prev.productId, prev.variantId);
      if (!currentSet.has(key)) {
        revokeKeys.add(key);
      }
    }
  }

  if (revokeKeys.size > 0) {
    for (const [key, docs] of existingByKey.entries()) {
      if (!revokeKeys.has(key)) continue;
      for (const row of docs) {
        if (normalizeStatus(row?.status) !== "active") continue;
        await payload.update({
          collection: "digital_entitlements",
          id: row.id,
          data: {
            status: "REVOKED",
            revokedAt: new Date().toISOString(),
          },
          overrideAccess: true,
        });
        revoked += 1;
      }
    }
  }

  return { created, updated, revoked };
};

export const claimEmailEntitlementsForUser = async (args: {
  payload: any;
  userId: string | number;
  email: string;
}) => {
  const { payload, userId } = args;
  const email = normalizeEmail(args.email);
  if (!email) return { claimed: 0 };

  const found = await payload.find({
    collection: "digital_entitlements",
    depth: 0,
    limit: 500,
    where: {
      and: [
        { ownerType: { equals: "EMAIL" } },
        { ownerEmail: { equals: email } },
        { status: { equals: "ACTIVE" } },
      ],
    },
    overrideAccess: true,
  });

  const docs = Array.isArray(found?.docs) ? found.docs : [];
  let claimed = 0;
  for (const row of docs) {
    await payload.update({
      collection: "digital_entitlements",
      id: row.id,
      data: {
        ownerType: "USER",
        ownerUser: userId as any,
        ownerEmail: email,
      },
      overrideAccess: true,
    });
    claimed += 1;
  }

  return { claimed };
};

export const resolveEntitlementForAccess = async (args: {
  payload: any;
  entitlementId?: string | number | null;
  productId?: string | number | null;
  variantId?: string | null;
  userId?: string | number | null;
  userEmail?: string | null;
  guestEmail?: string | null;
}) => {
  const {
    payload,
    entitlementId,
    productId,
    variantId,
    userId,
    userEmail,
    guestEmail,
  } = args;

  const normalizedEntitlementId = normalizeRelationshipId(entitlementId);
  const normalizedProductId = normalizeRelationshipId(productId);
  const normalizedVariantId = normalizeVariantId(variantId);
  const normalizedUserId = normalizeRelationshipId(userId);
  const normalizedUserEmail = normalizeEmail(userEmail);
  const normalizedGuestEmail = normalizeEmail(guestEmail);

  const canUseUser = normalizedUserId !== null;
  const canUseGuest = Boolean(normalizedGuestEmail);
  if (!canUseUser && !canUseGuest) {
    return null;
  }

  const isOwnedByUser = (doc: any) => {
    const ownerType = String(doc?.ownerType || "").toUpperCase();
    const ownerUser = normalizeRelationshipId(doc?.ownerUser);
    const ownerEmail = normalizeEmail(doc?.ownerEmail);
    if (canUseUser && ownerType === "USER" && ownerUser !== null) {
      if (String(ownerUser) === String(normalizedUserId)) return true;
    }
    if (canUseUser && normalizedUserEmail && ownerType === "EMAIL" && ownerEmail === normalizedUserEmail) {
      return true;
    }
    if (canUseGuest && ownerType === "EMAIL" && ownerEmail === normalizedGuestEmail) {
      return true;
    }
    return false;
  };

  const matchesProduct = (doc: any) => {
    const docProductId = normalizeRelationshipId(doc?.product);
    if (normalizedProductId !== null && docProductId !== null) {
      if (String(docProductId) !== String(normalizedProductId)) return false;
    }
    if (normalizedVariantId) {
      const docVariant = normalizeVariantId(doc?.variantId);
      if (docVariant !== normalizedVariantId) return false;
    }
    return true;
  };

  if (normalizedEntitlementId !== null) {
    const doc = await payload
      .findByID({
        collection: "digital_entitlements",
        id: normalizedEntitlementId as any,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);
    if (!doc) return null;
    if (!matchesProduct(doc)) return null;
    if (!isOwnedByUser(doc)) return null;
    return doc;
  }

  if (normalizedProductId === null) {
    return null;
  }

  const ownerConditions: any[] = [];
  if (canUseUser) {
    ownerConditions.push({ and: [{ ownerType: { equals: "USER" } }, { ownerUser: { equals: normalizedUserId as any } }] });
    if (normalizedUserEmail) {
      ownerConditions.push({ and: [{ ownerType: { equals: "EMAIL" } }, { ownerEmail: { equals: normalizedUserEmail } }] });
    }
  }
  if (canUseGuest) {
    ownerConditions.push({ and: [{ ownerType: { equals: "EMAIL" } }, { ownerEmail: { equals: normalizedGuestEmail } }] });
  }

  const whereAnd: any[] = [
    { status: { equals: "ACTIVE" } },
    { product: { equals: normalizedProductId as any } },
  ];
  if (normalizedVariantId) {
    whereAnd.push({ variantId: { equals: normalizedVariantId } });
  }
  if (ownerConditions.length === 1) {
    whereAnd.push(ownerConditions[0]);
  } else {
    whereAnd.push({ or: ownerConditions });
  }

  const found = await payload.find({
    collection: "digital_entitlements",
    depth: 0,
    limit: 1,
    sort: "-createdAt",
    where: {
      and: whereAnd,
    },
    overrideAccess: true,
  });

  const doc = found?.docs?.[0] ?? null;
  return doc;
};

export const toEntitlementPublic = (doc: any) => {
  const id = normalizeIdString(doc?.id);
  const productId = normalizeIdString(doc?.product);
  const orderId = normalizeIdString(doc?.order);
  return {
    id,
    productId,
    orderId,
    ownerType: String(doc?.ownerType || "").toUpperCase() === "EMAIL" ? "EMAIL" : "USER",
    ownerEmail: normalizeEmail(doc?.ownerEmail),
    ownerUserId: normalizeIdString(doc?.ownerUser),
    status: String(doc?.status || "").toUpperCase() === "REVOKED" ? "REVOKED" : "ACTIVE",
    variantId: normalizeVariantId(doc?.variantId),
    createdAt: doc?.createdAt,
    updatedAt: doc?.updatedAt,
    revokedAt: doc?.revokedAt,
  };
};
