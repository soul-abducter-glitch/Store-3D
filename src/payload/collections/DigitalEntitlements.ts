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

const ownerReadAccess: Access = ({ req }) => {
  if (!req?.user) return false;
  if (isAdminUser(req)) return true;
  const email = normalizeEmail(req.user.email);
  const where: any = {
    or: [
      {
        and: [{ ownerType: { equals: "USER" } }, { ownerUser: { equals: req.user.id } }],
      },
    ],
  };
  if (email) {
    where.or.push({
      and: [{ ownerType: { equals: "EMAIL" } }, { ownerEmail: { equals: email } }],
    });
  }
  return where;
};

const ownerWriteAccess: Access = ({ req }) => {
  if (!req?.user) return false;
  return isAdminUser(req);
};

export const DigitalEntitlements: CollectionConfig = {
  slug: "digital_entitlements",
  admin: {
    useAsTitle: "id",
    group: "Store",
    defaultColumns: ["status", "ownerType", "ownerEmail", "ownerUser", "product", "order", "updatedAt"],
  },
  access: {
    read: ownerReadAccess,
    create: ownerWriteAccess,
    update: ownerWriteAccess,
    delete: ownerWriteAccess,
  },
  hooks: {
    beforeValidate: [({ data }) => {
      if (!data || typeof data !== "object") return data;
      if (typeof data.ownerEmail === "string") {
        data.ownerEmail = normalizeEmail(data.ownerEmail);
      }

      const ownerType = data.ownerType === "USER" ? "USER" : "EMAIL";
      data.ownerType = ownerType;

      if (ownerType === "USER") {
        if (!data.ownerUser) {
          throw new Error("ownerUser is required for USER entitlement.");
        }
      }

      if (ownerType === "EMAIL") {
        const email = normalizeEmail(data.ownerEmail);
        if (!email) {
          throw new Error("ownerEmail is required for EMAIL entitlement.");
        }
        data.ownerEmail = email;
      }

      if (typeof data.variantId === "string") {
        data.variantId = data.variantId.trim().slice(0, 80);
      }

      if (data.status !== "ACTIVE" && data.status !== "REVOKED") {
        data.status = "ACTIVE";
      }

      if (data.status === "REVOKED" && !data.revokedAt) {
        data.revokedAt = new Date().toISOString();
      }

      return data;
    }],
    beforeChange: [({ data, originalDoc, operation }) => {
      if (!data || typeof data !== "object") return data;
      const nextStatus = data.status === "REVOKED" ? "REVOKED" : "ACTIVE";
      if (nextStatus === "REVOKED") {
        data.revokedAt = data.revokedAt || new Date().toISOString();
      } else if (operation === "update" && originalDoc?.status === "REVOKED") {
        data.revokedAt = null;
      }
      return data;
    }],
  },
  fields: [
    {
      name: "ownerType",
      type: "select",
      required: true,
      defaultValue: "USER",
      index: true,
      options: [
        { label: "User", value: "USER" },
        { label: "Email", value: "EMAIL" },
      ],
    },
    {
      name: "ownerUser",
      type: "relationship",
      relationTo: "users",
      index: true,
      admin: {
        condition: (_, siblingData) => siblingData?.ownerType === "USER",
      },
    },
    {
      name: "ownerEmail",
      type: "email",
      index: true,
      admin: {
        condition: (_, siblingData) => siblingData?.ownerType === "EMAIL",
      },
    },
    {
      name: "product",
      type: "relationship",
      relationTo: "products",
      required: true,
      index: true,
    },
    {
      name: "variantId",
      type: "text",
      index: true,
    },
    {
      name: "order",
      type: "relationship",
      relationTo: "orders",
      required: true,
      index: true,
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "ACTIVE",
      index: true,
      options: [
        { label: "Active", value: "ACTIVE" },
        { label: "Revoked", value: "REVOKED" },
      ],
    },
    {
      name: "revokedAt",
      type: "date",
    },
    {
      name: "meta",
      type: "json",
    },
  ],
};
