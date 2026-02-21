import type { Access, CollectionConfig } from "payload";

import { notifySupportTicketIfNeeded } from "@/lib/supportNotifications";

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

const canReadOwnTickets: Access = ({ req }) => {
  if (!req?.user) return false;
  if (isAdminUser(req)) return true;
  return {
    user: {
      equals: req.user.id,
    },
  };
};

const canCreateTicket: Access = ({ req }) => Boolean(req?.user);
const adminOnly: Access = ({ req }) => Boolean(req?.user && isAdminUser(req));

export const SupportTickets: CollectionConfig = {
  slug: "support_tickets",
  admin: {
    useAsTitle: "title",
    group: "Support",
    defaultColumns: ["status", "priority", "category", "email", "updatedAt"],
  },
  access: {
    read: canReadOwnTickets,
    create: canCreateTicket,
    update: adminOnly,
    delete: adminOnly,
  },
  hooks: {
    beforeValidate: [
      ({ data, req, operation }) => {
        if (!data || typeof data !== "object") return data;
        const user = req?.user as { email?: unknown; name?: unknown } | undefined;
        if (operation === "create") {
          if (!data.email && typeof user?.email === "string") data.email = user.email;
          if (!data.name && typeof user?.name === "string") data.name = user.name;
          if (!data.status) data.status = "open";
          if (!data.priority) data.priority = "normal";
          if (!data.lastUserMessageAt) data.lastUserMessageAt = new Date().toISOString();
        }
        return data;
      },
    ],
    beforeChange: [
      ({ data, originalDoc, operation }) => {
        if (!data || typeof data !== "object") return data;
        if (operation === "update") {
          const previousReply =
            typeof (originalDoc as any)?.adminReply === "string"
              ? (originalDoc as any).adminReply.trim()
              : "";
          const nextReply = typeof data.adminReply === "string" ? data.adminReply.trim() : "";
          if (nextReply && nextReply !== previousReply) {
            data.lastAdminReplyAt = new Date().toISOString();
          }
        }
        return data;
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, operation, req }) => {
        await notifySupportTicketIfNeeded({
          doc,
          previousDoc,
          operation,
          logger: req?.payload?.logger,
        });
      },
    ],
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
      name: "status",
      type: "select",
      required: true,
      defaultValue: "open",
      options: [
        { label: "Open", value: "open" },
        { label: "In Progress", value: "in_progress" },
        { label: "Waiting User", value: "waiting_user" },
        { label: "Resolved", value: "resolved" },
        { label: "Closed", value: "closed" },
      ],
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "priority",
      type: "select",
      required: true,
      defaultValue: "normal",
      options: [
        { label: "Low", value: "low" },
        { label: "Normal", value: "normal" },
        { label: "High", value: "high" },
        { label: "Urgent", value: "urgent" },
      ],
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "category",
      type: "select",
      required: true,
      defaultValue: "other",
      options: [
        { label: "AI Lab", value: "ai_lab" },
        { label: "Print Order", value: "print_order" },
        { label: "Digital Purchase", value: "digital_purchase" },
        { label: "Payment", value: "payment" },
        { label: "Delivery", value: "delivery" },
        { label: "Account", value: "account" },
        { label: "UI Bug", value: "bug_ui" },
        { label: "Other", value: "other" },
      ],
    },
    {
      name: "email",
      type: "email",
      required: true,
    },
    {
      name: "name",
      type: "text",
    },
    {
      name: "title",
      type: "text",
      required: true,
    },
    {
      name: "message",
      type: "textarea",
      required: true,
    },
    {
      name: "adminReply",
      type: "textarea",
      admin: {
        description: "Visible to user and sent by email when changed.",
      },
    },
    {
      name: "lastUserMessageAt",
      type: "date",
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "lastAdminReplyAt",
      type: "date",
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "meta",
      type: "json",
    },
  ],
};
