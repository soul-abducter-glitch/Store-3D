import type { Access, CollectionConfig } from "payload";
import {
  normalizeTrimmedText,
  validateAccountName,
  validateDefaultShippingAddress,
  validateNewAccountPassword,
} from "@/lib/accountValidation";

const DEFAULT_AI_CREDITS = (() => {
  const parsed = Number.parseInt(process.env.AI_TOKENS_DEFAULT || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 120;
  return parsed;
})();

const validatePassword = (value: unknown) => {
  const error = validateNewAccountPassword(value);
  return error ? error : true;
};

const normalizeId = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
    return trimmed;
  }
  return value;
};

const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

const isAdminUser = (user: unknown) => {
  const email = normalizeEmail((user as { email?: unknown } | null | undefined)?.email);
  if (!email) return false;
  return parseAdminEmails().includes(email);
};

const isSelf: Access = ({ req: { user }, id }) => {
  if (!user) {
    return false;
  }
  const userId = normalizeId(user.id);
  if (id) {
    return String(normalizeId(id)) === String(userId);
  }
  return {
    id: {
      equals: userId,
    },
  };
};

export const Users: CollectionConfig = {
  slug: "users",
  auth: {
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    cookies: {
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  admin: {
    useAsTitle: "email",
  },
  access: {
    create: () => true,
    read: isSelf,
    update: isSelf,
    delete: isSelf,
  },
  hooks: {
    beforeValidate: [({ data, operation }) => {
      if (!data || typeof data !== "object") {
        return data;
      }
      if (typeof data.name === "string") {
        data.name = data.name.trim();
      }
      if (typeof data.shippingAddress === "string") {
        data.shippingAddress = data.shippingAddress.trim();
      }
      const shouldValidatePassword =
        operation === "create" || (typeof data.password === "string" && data.password.length > 0);
      if (shouldValidatePassword) {
        const passwordCheck = validatePassword(data.password);
        if (passwordCheck !== true) {
          throw new Error(passwordCheck);
        }
      }
      return data;
    }],
  },
  fields: [
    {
      name: "name",
      type: "text",
      label: "Имя",
      validate: (value: unknown) => {
        const error = validateAccountName(value);
        return error ? error : true;
      },
    },
    {
      name: "shippingAddress",
      type: "textarea",
      label: "Адрес доставки",
      validate: (value: unknown) => {
        const error = validateDefaultShippingAddress(normalizeTrimmedText(value));
        return error ? error : true;
      },
    },
    {
      name: "purchasedProducts",
      label: "Купленные модели",
      type: "relationship",
      relationTo: "products",
      hasMany: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "aiCredits",
      type: "number",
      label: "AI tokens",
      min: 0,
      defaultValue: DEFAULT_AI_CREDITS,
      access: {
        read: ({ req }) => Boolean(req?.user),
        create: ({ req }) => isAdminUser(req?.user),
        update: ({ req }) => isAdminUser(req?.user),
      },
      admin: {
        position: "sidebar",
        step: 1,
        description: "Баланс токенов для AI лаборатории.",
      },
    },
  ],
};
