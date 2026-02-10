export const CHECKOUT_DRAFT_KEY_PREFIX = "checkout:draft:v1";
export const CHECKOUT_DRAFTS_KEY_PREFIX = "checkout:drafts:v1";
const CHECKOUT_DRAFTS_MAX = 15;

export type CheckoutDraftForm = {
  name?: string;
  email?: string;
  city?: string;
  address?: string;
  shippingMethod?: string;
  zipCode?: string;
};

export type CheckoutDraftRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  form: CheckoutDraftForm;
  paymentMethod?: string;
  promoCodeInput?: string;
  selectedItemIds?: string[];
  itemCount?: number;
  subtotal?: number;
  itemNames?: string[];
};

type PartialDraft = Omit<CheckoutDraftRecord, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

const safeJsonParse = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeUserKey = (userId?: string | null) => (userId ? String(userId) : "guest");

export const getCheckoutDraftKey = (userId?: string | null) =>
  `${CHECKOUT_DRAFT_KEY_PREFIX}:${normalizeUserKey(userId)}`;

export const getCheckoutDraftsKey = (userId?: string | null) =>
  `${CHECKOUT_DRAFTS_KEY_PREFIX}:${normalizeUserKey(userId)}`;

export const readCheckoutDraftRecords = (userId?: string | null): CheckoutDraftRecord[] => {
  if (typeof window === "undefined") return [];
  const key = getCheckoutDraftsKey(userId);
  const parsed = safeJsonParse(window.localStorage.getItem(key));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string");
};

const writeCheckoutDraftRecords = (userId: string | null | undefined, records: CheckoutDraftRecord[]) => {
  if (typeof window === "undefined") return;
  const key = getCheckoutDraftsKey(userId);
  window.localStorage.setItem(key, JSON.stringify(records));
};

export const saveCheckoutDraftRecord = (
  userId: string | null | undefined,
  data: PartialDraft
): CheckoutDraftRecord => {
  const nowIso = new Date().toISOString();
  const existing = readCheckoutDraftRecords(userId);
  const recordId = (data.id && String(data.id).trim()) || `draft_${Date.now().toString(36)}`;
  const existingIndex = existing.findIndex((entry) => entry.id === recordId);
  const createdAt = existingIndex >= 0 ? existing[existingIndex].createdAt : nowIso;

  const record: CheckoutDraftRecord = {
    id: recordId,
    createdAt,
    updatedAt: nowIso,
    form: data.form ?? {},
    paymentMethod: data.paymentMethod,
    promoCodeInput: data.promoCodeInput,
    selectedItemIds: Array.isArray(data.selectedItemIds) ? data.selectedItemIds : [],
    itemCount: typeof data.itemCount === "number" ? data.itemCount : undefined,
    subtotal: typeof data.subtotal === "number" ? data.subtotal : undefined,
    itemNames: Array.isArray(data.itemNames) ? data.itemNames.slice(0, 3) : [],
  };

  const next = existingIndex >= 0 ? [...existing] : [...existing];
  if (existingIndex >= 0) {
    next[existingIndex] = record;
  } else {
    next.unshift(record);
  }

  next.sort((a, b) => {
    const aMs = new Date(a.updatedAt).getTime();
    const bMs = new Date(b.updatedAt).getTime();
    return bMs - aMs;
  });

  writeCheckoutDraftRecords(userId, next.slice(0, CHECKOUT_DRAFTS_MAX));
  return record;
};

export const removeCheckoutDraftRecord = (userId: string | null | undefined, draftId: string) => {
  const existing = readCheckoutDraftRecords(userId);
  const next = existing.filter((entry) => entry.id !== draftId);
  writeCheckoutDraftRecords(userId, next);
};
