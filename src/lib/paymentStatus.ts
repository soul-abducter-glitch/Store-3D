export type PaymentStatusKey = "pending" | "paid" | "failed" | "refunded";

const PAYMENT_STATUS_LABELS: Record<PaymentStatusKey, string> = {
  pending: "Ожидает оплаты",
  paid: "Оплачено",
  failed: "Ошибка оплаты",
  refunded: "Возврат",
};

const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  stripe: "Stripe",
  yookassa: "YooKassa",
  mock: "Тестовый режим (Mock)",
  internal: "Внутренний",
  unknown: "Не указан",
};

export const normalizePaymentStatus = (value?: string | null): PaymentStatusKey => {
  if (!value) return "pending";
  const raw = String(value).trim().toLowerCase();
  if (raw === "paid" || raw === "success") return "paid";
  if (raw === "failed" || raw === "error") return "failed";
  if (raw === "refunded" || raw === "refund") return "refunded";
  return "pending";
};

export const getPaymentStatusLabel = (value?: string | null) =>
  PAYMENT_STATUS_LABELS[normalizePaymentStatus(value)];

export const getPaymentProviderLabel = (value?: string | null) => {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return PAYMENT_PROVIDER_LABELS.unknown;
  return PAYMENT_PROVIDER_LABELS[raw] || raw.toUpperCase();
};
