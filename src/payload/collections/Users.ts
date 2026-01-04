import type { Access, CollectionConfig } from "payload";

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
  fields: [
    {
      name: "name",
      type: "text",
      label: "Имя",
    },
    {
      name: "shippingAddress",
      type: "textarea",
      label: "Адрес доставки",
    },
  ],
};
