export type OrderStatusKey = "paid" | "accepted" | "printing" | "ready" | "completed" | "cancelled";

export const ORDER_STATUS_STORAGE_KEY = "store3d_order_statuses";
export const ORDER_STATUS_UNREAD_KEY = "store3d_order_unread";

const STATUS_LABELS: Record<OrderStatusKey, string> = {
  paid: "Оплачено / Ожидает проверки",
  accepted: "Принято в работу",
  printing: "Печатается",
  ready: "Готов к выдаче",
  completed: "Завершен",
  cancelled: "Отменен",
};

export const ORDER_PROGRESS_STEPS = ["Оплачено", "В работе", "Готово"];

export const normalizeOrderStatus = (value?: string | null): OrderStatusKey => {
  if (!value) return "paid";
  const raw = String(value);
  const normalized = raw.trim().toLowerCase();
  if (normalized === "paid" || raw === "Paid" || normalized === "pending") return "paid";
  if (normalized === "accepted" || normalized === "in_progress") return "accepted";
  if (normalized === "printing" || raw === "Printing") return "printing";
  if (normalized === "ready" || raw === "Shipped") return "ready";
  if (normalized === "completed" || normalized === "done") return "completed";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  return "paid";
};

export const getOrderStatusLabel = (value?: string | null) =>
  STATUS_LABELS[normalizeOrderStatus(value)];

export const getOrderStatusTone = (value?: string | null) => {
  const status = normalizeOrderStatus(value);
  if (status === "completed" || status === "ready") return "text-emerald-400";
  if (status === "printing") return "text-[#2ED1FF]";
  if (status === "accepted") return "text-[#D4AF37]";
  return "text-white/60";
};

export const getOrderProgressStage = (value?: string | null) => {
  const status = normalizeOrderStatus(value);
  if (status === "cancelled") return -1;
  if (status === "accepted" || status === "printing") return 1;
  if (status === "ready" || status === "completed") return 2;
  return 0;
};




