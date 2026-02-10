export const LEGACY_CART_KEY = "store3d_cart";
const CHECKOUT_SELECTION_SUFFIX = "checkout-selection";

const normalizeUserId = (value?: string | null) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

export const getCartStorageKey = (userId?: string | null) => {
  const normalized = normalizeUserId(userId);
  if (normalized) {
    return `${LEGACY_CART_KEY}:user:${normalized}`;
  }
  return `${LEGACY_CART_KEY}:guest`;
};

export const readCartStorage = (key: string, opts?: { migrateLegacy?: boolean }) => {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (opts?.migrateLegacy) {
    const legacyRaw = window.localStorage.getItem(LEGACY_CART_KEY);
    if (legacyRaw) {
      window.localStorage.setItem(key, legacyRaw);
      window.localStorage.removeItem(LEGACY_CART_KEY);
      try {
        const parsed = JSON.parse(legacyRaw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
  }
  return [];
};

export const writeCartStorage = (key: string, items: unknown[]) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("cart-updated"));
};

export const removeCartStorage = (key: string) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent("cart-updated"));
};

export const getCheckoutSelectionKey = (cartStorageKey: string) =>
  `${cartStorageKey}:${CHECKOUT_SELECTION_SUFFIX}`;

export const readCheckoutSelection = (cartStorageKey: string): string[] => {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(getCheckoutSelectionKey(cartStorageKey));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  } catch {
    return [];
  }
};

export const writeCheckoutSelection = (cartStorageKey: string, ids: string[]) => {
  if (typeof window === "undefined") {
    return;
  }
  const cleaned = Array.from(
    new Set(ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0))
  );
  window.localStorage.setItem(getCheckoutSelectionKey(cartStorageKey), JSON.stringify(cleaned));
};

export const clearCheckoutSelection = (cartStorageKey: string) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(getCheckoutSelectionKey(cartStorageKey));
};

export const mergeGuestCartIntoUser = (userId: string) => {
  if (typeof window === "undefined") {
    return;
  }
  const guestKey = getCartStorageKey(null);
  const userKey = getCartStorageKey(userId);
  const guestItems = readCartStorage(guestKey, { migrateLegacy: true });
  if (!Array.isArray(guestItems) || guestItems.length === 0) {
    return;
  }
  const userItems = readCartStorage(userKey);
  const merged = Array.isArray(userItems) ? [...userItems] : [];
  guestItems.forEach((item: any) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) {
      merged.push(item);
      return;
    }
    const existingIndex = merged.findIndex((entry: any) => entry?.id === id);
    if (existingIndex >= 0) {
      const existing = merged[existingIndex];
      const existingQty = typeof existing?.quantity === "number" ? existing.quantity : 1;
      const incomingQty = typeof item.quantity === "number" ? item.quantity : 1;
      merged[existingIndex] = {
        ...existing,
        quantity: existingQty + incomingQty,
      };
    } else {
      merged.push(item);
    }
  });
  writeCartStorage(userKey, merged);
  removeCartStorage(guestKey);
  window.localStorage.removeItem(LEGACY_CART_KEY);
};
