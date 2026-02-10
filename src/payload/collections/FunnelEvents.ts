import type { CollectionConfig } from "payload";

import {
  FUNNEL_EVENT_NAMES,
  hasFunnelAdminAccess,
  resolveFunnelStage,
  type FunnelEventName,
} from "@/lib/funnelEvents";

const canReadFunnelEvents = ({ req }: any) => {
  if (!req?.user) return false;
  return hasFunnelAdminAccess(req.user?.email);
};

export const FunnelEvents: CollectionConfig = {
  slug: "funnel-events",
  admin: {
    useAsTitle: "name",
    defaultColumns: ["occurredAt", "name", "stage", "sessionId", "amount"],
    group: "Analytics",
  },
  access: {
    read: canReadFunnelEvents,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: "name",
      type: "select",
      required: true,
      options: FUNNEL_EVENT_NAMES.map((value) => ({ label: value, value })),
    },
    {
      name: "stage",
      type: "select",
      required: true,
      options: [
        { label: "Store", value: "store" },
        { label: "Product", value: "product" },
        { label: "Cart", value: "cart" },
        { label: "Checkout", value: "checkout" },
        { label: "Order", value: "order" },
        { label: "Payment", value: "payment" },
      ],
      hooks: {
        beforeValidate: [
          ({ data, value }) => {
            if (value) return value;
            const eventName = data?.name as FunnelEventName | undefined;
            if (!eventName) return value;
            return resolveFunnelStage(eventName);
          },
        ],
      },
    },
    {
      name: "sessionId",
      type: "text",
      required: true,
      index: true,
    },
    {
      name: "path",
      type: "text",
    },
    {
      name: "user",
      type: "relationship",
      relationTo: "users",
    },
    {
      name: "product",
      type: "relationship",
      relationTo: "products",
    },
    {
      name: "order",
      type: "relationship",
      relationTo: "orders",
    },
    {
      name: "amount",
      type: "number",
      min: 0,
    },
    {
      name: "currency",
      type: "text",
      defaultValue: "RUB",
    },
    {
      name: "metadata",
      type: "json",
    },
    {
      name: "occurredAt",
      type: "date",
      required: true,
      defaultValue: () => new Date().toISOString(),
      index: true,
    },
  ],
};

