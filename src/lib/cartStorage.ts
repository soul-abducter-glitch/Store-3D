export const LEGACY_CART_KEY = "store3d_cart";

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
