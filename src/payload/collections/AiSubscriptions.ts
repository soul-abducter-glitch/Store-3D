import type { Access, CollectionConfig } from "payload";

const normalizeEmail = (value?: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

const isAdminUser = (req?: any) => {
  const userEmail = normalizeEmail(req?.user?.email);
  if (!userEmail) return false;
  return parseAdminEmails().includes(userEmail);
};

const canReadOwnSubscriptions: Access = ({ req }) => {
  if (!req?.user) return false;
  if (isAdminUser(req)) return true;
  return {
    user: {
      equals: req.user.id,
    },
  };
};

const adminOnly: Access = ({ req }) => {
  if (!req?.user) return false;
  return isAdminUser(req);
};

export const AiSubscriptions: CollectionConfig = {
  slug: "ai_subscriptions",
  admin: {
    useAsTitle: "stripeSubscriptionId",
    group: "AI",
    defaultColumns: [
      "user",
      "planCode",
      "status",
      "currentPeriodEnd",
      "cancelAtPeriodEnd",
      "updatedAt",
    ],
  },
  access: {
    read: canReadOwnSubscriptions,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: "user",
      type: "relationship",
      relationTo: "users",
      required: true,
      index: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "stripeCustomerId",
      type: "text",
      index: true,
    },
    {
      name: "stripeSubscriptionId",
      type: "text",
      index: true,
    },
    {
      name: "stripePriceId",
      type: "text",
      index: true,
    },
    {
      name: "planCode",
      type: "select",
      required: true,
      defaultValue: "s",
      options: [
        { label: "Plan S", value: "s" },
        { label: "Plan M", value: "m" },
        { label: "Plan L", value: "l" },
      ],
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "incomplete",
      options: [
        { label: "Active", value: "active" },
        { label: "Past Due", value: "past_due" },
        { label: "Canceled", value: "canceled" },
        { label: "Incomplete", value: "incomplete" },
      ],
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "currentPeriodStart",
      type: "date",
      admin: {
        date: {
          pickerAppearance: "dayAndTime",
        },
      },
    },
    {
      name: "currentPeriodEnd",
      type: "date",
      admin: {
        date: {
          pickerAppearance: "dayAndTime",
        },
      },
    },
    {
      name: "cancelAtPeriodEnd",
      type: "checkbox",
      defaultValue: false,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "lastInvoiceId",
      type: "text",
      index: true,
    },
    {
      name: "meta",
      type: "json",
    },
  ],
};

