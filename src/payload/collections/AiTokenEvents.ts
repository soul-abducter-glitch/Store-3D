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

const canReadOwnEvents: Access = ({ req }) => {
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

export const AiTokenEvents: CollectionConfig = {
  slug: "ai_token_events",
  admin: {
    useAsTitle: "source",
    group: "AI",
    defaultColumns: ["reason", "delta", "balanceAfter", "source", "createdAt"],
  },
  access: {
    read: canReadOwnEvents,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: "job",
      type: "relationship",
      relationTo: "ai_jobs",
      index: true,
      admin: {
        position: "sidebar",
      },
    },
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
      name: "reason",
      type: "select",
      required: true,
      defaultValue: "adjust",
      options: [
        { label: "Spend", value: "spend" },
        { label: "Refund", value: "refund" },
        { label: "Top Up", value: "topup" },
        { label: "Adjust", value: "adjust" },
      ],
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "type",
      type: "select",
      required: true,
      defaultValue: "adjust",
      options: [
        { label: "Reserve", value: "reserve" },
        { label: "Finalize", value: "finalize" },
        { label: "Release", value: "release" },
        { label: "Top Up", value: "topup" },
        { label: "Adjust", value: "adjust" },
      ],
      index: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "amount",
      type: "number",
      min: 0,
      defaultValue: 0,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "delta",
      type: "number",
      required: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "balanceAfter",
      type: "number",
      required: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "source",
      type: "text",
      required: true,
      defaultValue: "system",
      index: true,
    },
    {
      name: "referenceId",
      type: "text",
      index: true,
    },
    {
      name: "idempotencyKey",
      type: "text",
      index: true,
    },
    {
      name: "meta",
      type: "json",
    },
  ],
};
