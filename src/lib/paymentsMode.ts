export type PaymentsMode = "off" | "mock" | "stripe";

export const normalizePaymentsMode = (value?: string | null): PaymentsMode => {
  const raw = (value || "").trim().toLowerCase();
  if (raw === "mock") return "mock";
  if (raw === "live" || raw === "stripe") return "stripe";
  return "off";
};

export const resolveServerPaymentsMode = (): PaymentsMode =>
  normalizePaymentsMode(process.env.PAYMENTS_MODE || "off");

