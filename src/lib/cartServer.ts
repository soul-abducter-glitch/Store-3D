import { NextResponse, type NextRequest } from "next/server";

export const CART_COOKIE_NAME = "store3d_cart_srv_v1";
const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_QTY = 99;
const UNDO_TTL_MS = 7_000;

export type CartItem = Record<string, unknown> & {
  id: string;
  productId: string;
  name: string;
  formatKey: "digital" | "physical";
  formatLabel: string;
  priceLabel: string;
  priceValue: number;
  quantity: number;
  thumbnailUrl: string;
  customPrint?: Record<string, unknown> | null;
};

type DeletedState = {
  item: CartItem;
  index: number;
  expiresAt: number;
};

type CartSnapshot = {
  items: CartItem[];
  updatedAt: string;
  deleted?: DeletedState | null;
};

type CartEnvelope = {
  carts: Record<string, CartSnapshot>;
};

type CartOwner = {
  key: string;
  type: "USER" | "GUEST";
};

const emptyEnvelope = (): CartEnvelope => ({ carts: {} });

const toStringSafe = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const toNumberSafe = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const clampQty = (qty: unknown, formatKey: "digital" | "physical") => {
  if (formatKey === "digital") return 1;
  const parsed = Math.trunc(toNumberSafe(qty));
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.min(MAX_QTY, parsed));
};

const isPrintItem = (item: CartItem) => {
  const customPrint = item.customPrint;
  if (customPrint && typeof customPrint === "object") {
    const uploadId = toStringSafe((customPrint as Record<string, unknown>).uploadId);
    if (uploadId) return true;
  }
  const source = `${toStringSafe(item.productId)} ${toStringSafe(item.formatLabel)}`.toLowerCase();
  return source.includes("print") || source.includes("печат");
};

const hashPrintConfig = (item: CartItem) => {
  const customPrint = (item.customPrint && typeof item.customPrint === "object"
    ? item.customPrint
    : {}) as Record<string, unknown>;
  const config = {
    uploadId: toStringSafe(customPrint.uploadId),
    technology: toStringSafe(customPrint.technology),
    material: toStringSafe(customPrint.material),
    quality: toStringSafe(customPrint.quality),
    color: toStringSafe(customPrint.color),
    note: toStringSafe(customPrint.note),
    packaging: toStringSafe(customPrint.packaging),
  };
  return JSON.stringify(config);
};

const getMergeKey = (item: CartItem) => {
  if (item.formatKey === "digital") {
    return `DIGITAL:${item.productId}:${toStringSafe(item.formatLabel).toLowerCase()}`;
  }
  if (isPrintItem(item)) {
    return `PRINT:${item.productId}:${hashPrintConfig(item)}`;
  }
  return `PHYSICAL:${item.productId}:${toStringSafe(item.formatLabel).toLowerCase()}`;
};

const sanitizeItem = (input: unknown): CartItem | null => {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const formatKey: "digital" | "physical" = raw.formatKey === "physical" ? "physical" : "digital";
  const productId = toStringSafe(raw.productId) || toStringSafe(raw.id);
  if (!productId) return null;

  const name = toStringSafe(raw.name) || "Товар";
  const priceValue = Math.max(0, toNumberSafe(raw.priceValue));
  const quantity = clampQty(raw.quantity, formatKey);
  const formatLabel = toStringSafe(raw.formatLabel) || (formatKey === "physical" ? "Печатная модель" : "Цифровой файл");
  const priceLabel = toStringSafe(raw.priceLabel) || `${new Intl.NumberFormat("ru-RU").format(Math.round(priceValue))} ₽`;
  const thumbnailUrl = toStringSafe(raw.thumbnailUrl);
  const customPrint = raw.customPrint && typeof raw.customPrint === "object" ? (raw.customPrint as Record<string, unknown>) : null;

  const candidateId = toStringSafe(raw.id);
  const fallbackId = `${productId}:${formatKey}:${customPrint ? toStringSafe(customPrint.uploadId) || "item" : "item"}`;
  const id = candidateId || fallbackId;

  return {
    ...raw,
    id,
    productId,
    name,
    formatKey,
    formatLabel,
    priceLabel,
    priceValue,
    quantity,
    thumbnailUrl,
    customPrint,
  };
};

const sanitizeItems = (value: unknown): CartItem[] => {
  if (!Array.isArray(value)) return [];
  const result: CartItem[] = [];
  value.forEach((entry) => {
    const normalized = sanitizeItem(entry);
    if (!normalized) return;
    result.push(normalized);
  });
  return result;
};

const mergeItems = (current: CartItem[], incoming: CartItem[]) => {
  const merged = [...current];
  const byKey = new Map<string, number>();

  merged.forEach((item, index) => {
    byKey.set(getMergeKey(item), index);
  });

  incoming.forEach((item) => {
    const key = getMergeKey(item);
    const existingIndex = byKey.get(key);
    if (typeof existingIndex !== "number") {
      byKey.set(key, merged.length);
      merged.push(item);
      return;
    }

    const existing = merged[existingIndex];
    const nextQty =
      item.formatKey === "digital"
        ? 1
        : Math.max(1, Math.min(MAX_QTY, (existing.quantity || 1) + (item.quantity || 1)));

    merged[existingIndex] = {
      ...existing,
      ...item,
      quantity: nextQty,
      id: existing.id,
    };
  });

  return merged;
};

const readEnvelope = (request: NextRequest): CartEnvelope => {
  const raw = request.cookies.get(CART_COOKIE_NAME)?.value;
  if (!raw) return emptyEnvelope();
  try {
    const parsed = JSON.parse(raw) as CartEnvelope;
    if (!parsed || typeof parsed !== "object" || typeof parsed.carts !== "object") {
      return emptyEnvelope();
    }
    return parsed;
  } catch {
    return emptyEnvelope();
  }
};

const writeEnvelopeCookie = (response: NextResponse, envelope: CartEnvelope) => {
  response.cookies.set({
    name: CART_COOKIE_NAME,
    value: JSON.stringify(envelope),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  });
};

const ensureSnapshot = (envelope: CartEnvelope, owner: CartOwner): CartSnapshot => {
  const existing = envelope.carts[owner.key];
  if (existing && Array.isArray(existing.items)) {
    const deleted =
      existing.deleted && existing.deleted.expiresAt > Date.now() ? existing.deleted : null;
    return {
      ...existing,
      items: sanitizeItems(existing.items),
      deleted,
    };
  }
  return {
    items: [],
    updatedAt: new Date().toISOString(),
    deleted: null,
  };
};

const saveSnapshot = (envelope: CartEnvelope, owner: CartOwner, snapshot: CartSnapshot) => {
  envelope.carts[owner.key] = {
    items: sanitizeItems(snapshot.items),
    updatedAt: new Date().toISOString(),
    deleted: snapshot.deleted && snapshot.deleted.expiresAt > Date.now() ? snapshot.deleted : null,
  };
};

const calcPricing = (items: CartItem[]) => {
  const itemsSubtotal = items.reduce((sum, item) => {
    const line = Math.max(0, toNumberSafe(item.priceValue)) * clampQty(item.quantity, item.formatKey);
    return sum + line;
  }, 0);
  return {
    itemsSubtotal: Math.round(itemsSubtotal),
    discount: 0,
    total: Math.round(itemsSubtotal),
  };
};

const isPrintReady = (item: CartItem) => {
  if (!isPrintItem(item)) return true;
  const customPrint = (item.customPrint && typeof item.customPrint === "object"
    ? item.customPrint
    : {}) as Record<string, unknown>;
  const required = ["uploadId", "uploadUrl", "technology", "material", "quality"];
  return required.every((key) => toStringSafe(customPrint[key]).length > 0);
};

const enrichItemState = (item: CartItem) => {
  const printReady = isPrintReady(item);
  const isAvailable = Boolean(toStringSafe(item.productId));
  const isValid = item.quantity > 0;
  const blockingReason = !isAvailable
    ? "Позиция недоступна"
    : !isValid
      ? "Некорректное количество"
      : !printReady
        ? "Требует подготовки"
        : "";

  return {
    ...item,
    printReady,
    isAvailable,
    isValid,
    blockingReason,
  };
};

const buildCartResponse = (owner: CartOwner, snapshot: CartSnapshot) => {
  const items = sanitizeItems(snapshot.items).map(enrichItemState);
  return {
    id: owner.key,
    ownerType: owner.type,
    ownerId: owner.key,
    items,
    pricing: calcPricing(items),
    updatedAt: snapshot.updatedAt,
  };
};

export const resolveOwner = (userId: string | null): CartOwner => {
  if (userId) {
    return {
      key: `user:${userId}`,
      type: "USER",
    };
  }
  return {
    key: "guest",
    type: "GUEST",
  };
};

export const readCart = (request: NextRequest, owner: CartOwner) => {
  const envelope = readEnvelope(request);
  const snapshot = ensureSnapshot(envelope, owner);
  return {
    envelope,
    snapshot,
  };
};

export const respondWithCart = (owner: CartOwner, envelope: CartEnvelope, snapshot: CartSnapshot) => {
  const response = NextResponse.json({
    success: true,
    cart: buildCartResponse(owner, snapshot),
  });
  writeEnvelopeCookie(response, envelope);
  return response;
};

export const replaceCartItems = (
  envelope: CartEnvelope,
  owner: CartOwner,
  rawItems: unknown,
  clearDeleted = true
) => {
  const items = sanitizeItems(rawItems);
  const next: CartSnapshot = {
    items,
    updatedAt: new Date().toISOString(),
    deleted: clearDeleted ? null : ensureSnapshot(envelope, owner).deleted ?? null,
  };
  saveSnapshot(envelope, owner, next);
  return ensureSnapshot(envelope, owner);
};

export const addCartItem = (envelope: CartEnvelope, owner: CartOwner, rawItem: unknown) => {
  const item = sanitizeItem(rawItem);
  const current = ensureSnapshot(envelope, owner);
  if (!item) {
    return current;
  }
  const merged = mergeItems(current.items, [item]);
  const next: CartSnapshot = {
    items: merged,
    updatedAt: new Date().toISOString(),
    deleted: null,
  };
  saveSnapshot(envelope, owner, next);
  return ensureSnapshot(envelope, owner);
};

export const mergeCartItems = (envelope: CartEnvelope, owner: CartOwner, rawItems: unknown) => {
  const incoming = sanitizeItems(rawItems);
  const current = ensureSnapshot(envelope, owner);
  const merged = mergeItems(current.items, incoming);
  const next: CartSnapshot = {
    items: merged,
    updatedAt: new Date().toISOString(),
    deleted: null,
  };
  saveSnapshot(envelope, owner, next);
  return ensureSnapshot(envelope, owner);
};

export const updateCartItem = (
  envelope: CartEnvelope,
  owner: CartOwner,
  itemId: string,
  patch: { quantity?: unknown; item?: unknown }
) => {
  const current = ensureSnapshot(envelope, owner);
  const index = current.items.findIndex((entry) => entry.id === itemId);
  if (index < 0) {
    return { snapshot: current, found: false };
  }

  const target = current.items[index];
  const quantityPatched =
    typeof patch.quantity === "undefined"
      ? target.quantity
      : clampQty(patch.quantity, target.formatKey);
  const mergedRaw =
    patch.item && typeof patch.item === "object"
      ? {
          ...target,
          ...(patch.item as Record<string, unknown>),
          quantity: quantityPatched,
          id: target.id,
        }
      : {
          ...target,
          quantity: quantityPatched,
        };

  const normalized = sanitizeItem(mergedRaw) || target;
  normalized.id = target.id;

  const nextItems = [...current.items];
  nextItems[index] = normalized;

  const next: CartSnapshot = {
    items: nextItems,
    updatedAt: new Date().toISOString(),
    deleted: null,
  };
  saveSnapshot(envelope, owner, next);
  return { snapshot: ensureSnapshot(envelope, owner), found: true };
};

export const deleteCartItem = (envelope: CartEnvelope, owner: CartOwner, itemId: string) => {
  const current = ensureSnapshot(envelope, owner);
  const index = current.items.findIndex((entry) => entry.id === itemId);
  if (index < 0) {
    return { snapshot: current, found: false };
  }

  const removed = current.items[index];
  const nextItems = current.items.filter((entry) => entry.id !== itemId);
  const next: CartSnapshot = {
    items: nextItems,
    updatedAt: new Date().toISOString(),
    deleted: {
      item: removed,
      index,
      expiresAt: Date.now() + UNDO_TTL_MS,
    },
  };
  saveSnapshot(envelope, owner, next);
  return { snapshot: ensureSnapshot(envelope, owner), found: true, removed };
};

export const undoDeleteCartItem = (envelope: CartEnvelope, owner: CartOwner) => {
  const current = ensureSnapshot(envelope, owner);
  const deleted = current.deleted;
  if (!deleted || deleted.expiresAt <= Date.now()) {
    return { snapshot: { ...current, deleted: null }, restored: false };
  }

  const nextItems = [...current.items];
  const index = Math.max(0, Math.min(nextItems.length, deleted.index));
  nextItems.splice(index, 0, deleted.item);

  const next: CartSnapshot = {
    items: nextItems,
    updatedAt: new Date().toISOString(),
    deleted: null,
  };
  saveSnapshot(envelope, owner, next);
  return { snapshot: ensureSnapshot(envelope, owner), restored: true };
};
