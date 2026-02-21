import type { Access, CollectionConfig } from "payload";

import {
  normalizeEmail,
  normalizeGiftMessage,
  normalizeGiftTransferStatus,
  resolveGiftTransferExpiryIso,
  GIFT_TRANSFER_DEFAULT_HOURS,
} from "@/lib/giftTransfers";

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

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
  const userEmail = normalizeEmail(req.user.email);
  const whereOr: any[] = [{ senderUser: { equals: req.user.id } }, { recipientUser: { equals: req.user.id } }];
  if (userEmail) {
    whereOr.push({ recipientEmail: { equals: userEmail } });
  }
  return { or: whereOr };
};

const adminOnlyWriteAccess: Access = ({ req }) => {
  if (!req?.user) return false;
  const allowByFlag = parseBoolean(process.env.GIFT_TRANSFER_USER_WRITE, false);
  if (allowByFlag) return true;
  return isAdminUser(req);
};

export const GiftTransfers: CollectionConfig = {
  slug: "gift_transfers",
  admin: {
    group: "Store",
    useAsTitle: "id",
    defaultColumns: ["status", "senderUser", "recipientEmail", "product", "expiresAt", "updatedAt"],
  },
  access: {
    read: ownerReadAccess,
    create: adminOnlyWriteAccess,
    update: adminOnlyWriteAccess,
    delete: adminOnlyWriteAccess,
  },
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (!data || typeof data !== "object") return data;

        data.recipientEmail = normalizeEmail(data.recipientEmail);
        if (typeof data.message === "string") {
          data.message = normalizeGiftMessage(data.message);
        }

        data.status = normalizeGiftTransferStatus(data.status);
        if (!data.expiresAt && data.status === "PENDING") {
          data.expiresAt = resolveGiftTransferExpiryIso(GIFT_TRANSFER_DEFAULT_HOURS);
        }

        return data;
      },
    ],
    beforeChange: [
      ({ data, originalDoc }) => {
        if (!data || typeof data !== "object") return data;
        const nextStatus = normalizeGiftTransferStatus(data.status || originalDoc?.status);
        const nowIso = new Date().toISOString();

        if (nextStatus === "ACCEPTED" && !data.acceptedAt) {
          data.acceptedAt = nowIso;
        }
        if (nextStatus === "EXPIRED" && !data.expiredAt) {
          data.expiredAt = nowIso;
        }
        if (nextStatus === "CANCELED" && !data.canceledAt) {
          data.canceledAt = nowIso;
        }
        data.status = nextStatus;
        return data;
      },
    ],
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
      name: "product",
      type: "relationship",
      relationTo: "products",
      required: true,
      index: true,
    },
    {
      name: "senderUser",
      type: "relationship",
      relationTo: "users",
      required: true,
      index: true,
    },
    {
      name: "recipientUser",
      type: "relationship",
      relationTo: "users",
      index: true,
    },
    {
      name: "recipientEmail",
      type: "email",
      required: true,
      index: true,
    },
    {
      name: "message",
      type: "textarea",
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "PENDING",
      index: true,
      options: [
        { label: "Pending", value: "PENDING" },
        { label: "Accepted", value: "ACCEPTED" },
        { label: "Expired", value: "EXPIRED" },
        { label: "Canceled", value: "CANCELED" },
      ],
    },
    {
      name: "expiresAt",
      type: "date",
      required: true,
      index: true,
    },
    {
      name: "acceptedAt",
      type: "date",
    },
    {
      name: "expiredAt",
      type: "date",
    },
    {
      name: "canceledAt",
      type: "date",
    },
    {
      name: "meta",
      type: "json",
    },
  ],
};

