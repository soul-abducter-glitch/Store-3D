import type { Access, CollectionConfig } from "payload";

const NAME_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'-]{1,49}$/;
const PASSWORD_REGEX = /^(?=.*[A-Za-zА-Яа-яЁё])(?=.*\d)(?=.*[^A-Za-zА-Яа-яЁё\d]).{8,}$/;

const validatePassword = (value: unknown) => {
  if (typeof value !== "string" || !value) {
    return "Пароль обязателен.";
  }
  if (!PASSWORD_REGEX.test(value)) {
    return "Пароль: минимум 8 символов, буквы, цифры и спецсимвол.";
  }
  return true;
};

const isSelf: Access = ({ req: { user } }) => {
  if (!user) {
    return false;
  }

  return {
    id: {
      equals: user.id,
    },
  };
};

export const Users: CollectionConfig = {
  slug: "users",
  auth: true,
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
        const name = typeof value === "string" ? value.trim() : "";
        if (!name) {
          return "Имя обязательно.";
        }
        if (!NAME_REGEX.test(name)) {
          return "Имя: только буквы, пробелы, дефис или апостроф.";
        }
        return true;
      },
    },
    {
      name: "shippingAddress",
      type: "textarea",
      label: "Адрес доставки",
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
  ],
};
