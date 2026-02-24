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

export const AiJobEvents: CollectionConfig = {
  slug: "ai_job_events",
  admin: {
    useAsTitle: "eventType",
    group: "AI",
    defaultColumns: ["eventType", "statusBefore", "statusAfter", "provider", "createdAt"],
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
      required: true,
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
      name: "eventType",
      type: "text",
      required: true,
      index: true,
    },
    {
      name: "statusBefore",
      type: "text",
      index: true,
    },
    {
      name: "statusAfter",
      type: "text",
      index: true,
    },
    {
      name: "provider",
      type: "text",
      index: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "traceId",
      type: "text",
      index: true,
    },
    {
      name: "requestId",
      type: "text",
      index: true,
    },
    {
      name: "payload",
      type: "json",
    },
  ],
};
