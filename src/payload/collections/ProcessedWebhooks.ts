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

const adminOnly: Access = ({ req }) => {
  if (!req?.user) return false;
  return isAdminUser(req);
};

export const ProcessedWebhooks: CollectionConfig = {
  slug: "processed_webhooks",
  admin: {
    useAsTitle: "eventId",
    group: "AI",
    defaultColumns: ["provider", "eventType", "status", "eventId", "processedAt", "updatedAt"],
  },
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: "provider",
      type: "select",
      required: true,
      defaultValue: "stripe",
      options: [
        { label: "Stripe", value: "stripe" },
        { label: "YooKassa", value: "yookassa" },
      ],
      index: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "eventId",
      type: "text",
      required: true,
      unique: true,
      index: true,
    },
    {
      name: "eventType",
      type: "text",
      required: true,
      index: true,
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "processing",
      options: [
        { label: "Processing", value: "processing" },
        { label: "Processed", value: "processed" },
        { label: "Ignored", value: "ignored" },
        { label: "Failed", value: "failed" },
      ],
      index: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "processedAt",
      type: "date",
      admin: {
        date: {
          pickerAppearance: "dayAndTime",
        },
      },
    },
    {
      name: "failureReason",
      type: "textarea",
    },
    {
      name: "meta",
      type: "json",
    },
  ],
};

