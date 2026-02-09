import type { Payload } from "payload";

import {
  normalizeFunnelEventName,
  resolveFunnelStage,
  type FunnelEventName,
} from "@/lib/funnelEvents";

type CaptureFunnelEventInput = {
  payload: Payload;
  name: FunnelEventName | string;
  sessionId?: string | null;
  userId?: string | number | null;
  productId?: string | number | null;
  orderId?: string | number | null;
  amount?: number | null;
  currency?: string | null;
  path?: string | null;
  metadata?: Record<string, unknown> | null;
};

const normalizeRelationshipId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const base = raw.split(":")[0].trim();
  if (!base || /\s/.test(base)) return null;
  if (/^\d+$/.test(base)) return Number(base);
  return base;
};

const normalizeSessionId = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.slice(0, 120);
};

export const captureFunnelEvent = async (input: CaptureFunnelEventInput) => {
  const eventName = normalizeFunnelEventName(String(input.name));
  if (!eventName) return;

  const sessionId =
    normalizeSessionId(input.sessionId) ??
    (input.userId ? `u:${String(input.userId)}` : null) ??
    (input.orderId ? `o:${String(input.orderId)}` : null) ??
    `s:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

  const amount =
    typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount >= 0
      ? input.amount
      : undefined;
  const currency = String(input.currency || "RUB").trim().slice(0, 8) || "RUB";
  const path = input.path ? String(input.path).slice(0, 300) : undefined;
  const product = normalizeRelationshipId(input.productId);
  const order = normalizeRelationshipId(input.orderId);
  const user = normalizeRelationshipId(input.userId);

  try {
    await input.payload.create({
      collection: "funnel-events",
      overrideAccess: true,
      data: {
        name: eventName,
        stage: resolveFunnelStage(eventName),
        sessionId,
        ...(user !== null ? { user } : {}),
        ...(product !== null ? { product } : {}),
        ...(order !== null ? { order } : {}),
        ...(path ? { path } : {}),
        ...(typeof amount === "number" ? { amount } : {}),
        currency,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        occurredAt: new Date().toISOString(),
      },
    });
  } catch {
    // Analytics must not break checkout/store flows.
  }
};

