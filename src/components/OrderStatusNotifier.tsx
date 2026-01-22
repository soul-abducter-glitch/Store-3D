"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  ORDER_STATUS_STORAGE_KEY,
  ORDER_STATUS_UNREAD_KEY,
  getOrderStatusLabel,
  normalizeOrderStatus,
} from "@/lib/orderStatus";

const POLL_INTERVAL_MS = 30000;

const readStoredStatuses = () => {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(ORDER_STATUS_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
  } catch {
    return {};
  }
  return {};
};

const writeStoredStatuses = (value: Record<string, string>) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ORDER_STATUS_STORAGE_KEY, JSON.stringify(value));
};

const readUnreadCount = () => {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(ORDER_STATUS_UNREAD_KEY);
  const count = raw ? Number(raw) : 0;
  return Number.isFinite(count) ? count : 0;
};

const writeUnreadCount = (count: number) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ORDER_STATUS_UNREAD_KEY, String(Math.max(0, count)));
  window.dispatchEvent(new Event("order-status-unread"));
};

export default function OrderStatusNotifier() {
  const initializedRef = useRef(false);
  const pollingRef = useRef<number | null>(null);
  const apiBase = "";

  useEffect(() => {
    let isMounted = true;

    const fetchOrders = async () => {
      if (!isMounted || typeof window === "undefined") {
        return;
      }
      if (document.visibilityState === "hidden") {
        return;
      }

      try {
        const userResponse = await fetch(`${apiBase}/api/users/me`, {
          credentials: "include",
        });
        if (!userResponse.ok) {
          initializedRef.current = true;
          return;
        }
        const userData = await userResponse.json();
        const user = userData?.user ?? userData?.doc ?? null;
        const email = user?.email ?? null;
        const userId = user?.id ?? null;
        if (!email && !userId) {
          initializedRef.current = true;
          return;
        }

        const params = new URLSearchParams();
        const normalizedEmail = email ? String(email).toLowerCase() : "";
        if (userId && normalizedEmail) {
          params.set("where[or][0][user][equals]", String(userId));
          params.set("where[or][1][customer.email][equals]", normalizedEmail);
        } else if (userId) {
          params.set("where[user][equals]", String(userId));
        } else if (normalizedEmail) {
          params.set("where[customer.email][equals]", normalizedEmail);
        }
        params.set("limit", "20");
        params.set("depth", "0");

        const ordersResponse = await fetch(`${apiBase}/api/orders?${params.toString()}`, {
          credentials: "include",
        });
        if (!ordersResponse.ok) {
          return;
        }
        const ordersData = await ordersResponse.json();
        const docs = Array.isArray(ordersData?.docs) ? ordersData.docs : [];
        const storedStatuses = readStoredStatuses();
        const nextStatuses = { ...storedStatuses };
        const updates: Array<{ id: string; status: string }> = [];

        docs.forEach((order: any) => {
          const id = order?.id ? String(order.id) : null;
          if (!id) return;
          const status = normalizeOrderStatus(order?.status);
          const prev = storedStatuses[id];
          nextStatuses[id] = status;
          if (initializedRef.current && prev && prev !== status) {
            updates.push({ id, status });
          }
        });

        writeStoredStatuses(nextStatuses);

        if (!initializedRef.current) {
          initializedRef.current = true;
          return;
        }

        if (updates.length > 0) {
          updates.forEach((update) => {
            const label = getOrderStatusLabel(update.status);
            toast.success(`Статус вашего заказа #${update.id} изменен на ${label}`, {
              className: "sonner-toast",
            });
          });
          writeUnreadCount(readUnreadCount() + updates.length);
          window.dispatchEvent(new Event("orders-updated"));
        }
      } catch {
        // Ignore polling errors
      }
    };

    fetchOrders();
    pollingRef.current = window.setInterval(fetchOrders, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
      }
    };
  }, [apiBase]);

  return null;
}

