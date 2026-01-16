"use client";

import { Toaster } from "sonner";
import OrderStatusNotifier from "@/components/OrderStatusNotifier";

export default function ClientNotifications() {
  return (
    <>
      <Toaster position="bottom-right" toastOptions={{ className: "sonner-toast" }} />
      <OrderStatusNotifier />
    </>
  );
}
