import type { Access, CollectionConfig } from "payload";

const normalizeEmail = (value?: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

const isAdminUser = (req?: any) => {
  const email = normalizeEmail(req?.user?.email);
  if (!email) return false;
  return parseAdminEmails().includes(email);
};

const adminOnly: Access = ({ req }) => {
  if (!req?.user) return false;
  return isAdminUser(req);
};

export const DownloadEvents: CollectionConfig = {
  slug: "download_events",
  admin: {
    useAsTitle: "id",
    group: "Store",
    defaultColumns: ["createdAt", "entitlement", "status", "reason", "ip"],
  },
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: "entitlement",
      type: "relationship",
      relationTo: "digital_entitlements",
      required: true,
      index: true,
    },
    {
      name: "order",
      type: "relationship",
      relationTo: "orders",
      index: true,
    },
    {
      name: "product",
      type: "relationship",
      relationTo: "products",
      index: true,
    },
    {
      name: "status",
      type: "select",
      required: true,
      index: true,
      options: [
        { label: "OK", value: "OK" },
        { label: "DENY", value: "DENY" },
      ],
    },
    {
      name: "reason",
      type: "text",
    },
    {
      name: "ownerType",
      type: "select",
      required: true,
      options: [
        { label: "User", value: "USER" },
        { label: "Email", value: "EMAIL" },
      ],
      index: true,
    },
    {
      name: "ownerRef",
      type: "text",
      required: true,
      index: true,
    },
    {
      name: "ip",
      type: "text",
      index: true,
    },
    {
      name: "userAgent",
      type: "textarea",
    },
  ],
};
