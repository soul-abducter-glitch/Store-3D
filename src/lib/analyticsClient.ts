import {
  normalizeFunnelEventName,
  type FunnelEventName,
} from "@/lib/funnelEvents";

const SESSION_KEY = "store3d:funnel-session:v1";

const buildSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getFunnelSessionId = () => {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = buildSessionId();
  window.localStorage.setItem(SESSION_KEY, created);
  return created;
};

export const trackFunnelEvent = async (
  name: FunnelEventName | string,
  data?: {
    productId?: string | number;
    orderId?: string | number;
    amount?: number;
    currency?: string;
    metadata?: Record<string, unknown>;
  }
) => {
  if (typeof window === "undefined") return;
  const normalized = normalizeFunnelEventName(String(name));
  if (!normalized) return;
  const sessionId = getFunnelSessionId();
  const payload = {
    name: normalized,
    sessionId,
    productId: data?.productId,
    orderId: data?.orderId,
    amount: data?.amount,
    currency: data?.currency ?? "RUB",
    metadata: data?.metadata,
    path: window.location.pathname,
  };

  try {
    void fetch("/api/analytics/track", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: {
        "content-type": "application/json",
        "x-funnel-session": sessionId,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Ignore analytics errors on client.
  }
};

