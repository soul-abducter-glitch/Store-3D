export const FUNNEL_EVENT_NAMES = [
  "store_view",
  "print_service_view",
  "product_view",
  "add_to_cart",
  "add_to_cart_print",
  "checkout_view",
  "checkout_submit",
  "order_created",
  "payment_paid",
  "payment_failed",
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number];

export type FunnelStage =
  | "store"
  | "product"
  | "cart"
  | "checkout"
  | "order"
  | "payment";

const EVENT_NAME_SET = new Set<string>(FUNNEL_EVENT_NAMES);

const normalizeEmail = (value?: string) => {
  if (!value) return "";
  return value.trim().toLowerCase();
};

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

export const hasFunnelAdminAccess = (email?: string) => {
  const adminEmails = parseAdminEmails();
  if (!adminEmails.length) {
    return true;
  }
  const normalized = normalizeEmail(email);
  return Boolean(normalized && adminEmails.includes(normalized));
};

export const normalizeFunnelEventName = (value?: string): FunnelEventName | null => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || !EVENT_NAME_SET.has(raw)) {
    return null;
  }
  return raw as FunnelEventName;
};

export const resolveFunnelStage = (name: FunnelEventName): FunnelStage => {
  switch (name) {
    case "store_view":
    case "print_service_view":
      return "store";
    case "product_view":
      return "product";
    case "add_to_cart":
    case "add_to_cart_print":
      return "cart";
    case "checkout_view":
    case "checkout_submit":
      return "checkout";
    case "order_created":
      return "order";
    case "payment_paid":
    case "payment_failed":
      return "payment";
    default:
      return "store";
  }
};

