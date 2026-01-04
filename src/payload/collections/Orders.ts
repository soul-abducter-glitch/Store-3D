import type { CollectionConfig } from "payload";

import { allowPublicRead, isAuthenticated } from "../access";

export const Orders: CollectionConfig = {
  slug: "orders",
  admin: {
    useAsTitle: "id",
  },
  access: {
    read: isAuthenticated,
    create: isAuthenticated,
    update: isAuthenticated,
    delete: isAuthenticated,
  },
  fields: [
    {
      name: "user",
      type: "relationship",
      relationTo: "users",
      required: true,
    },
    {
      name: "product",
      type: "relationship",
      relationTo: "products",
      required: true,
    },
    {
      name: "format",
      type: "select",
      required: true,
      options: [
        { label: "Digital STL", value: "Digital" },
        { label: "Physical Print", value: "Physical" },
      ],
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "Pending",
      options: [
        { label: "Pending", value: "Pending" },
        { label: "Printing", value: "Printing" },
        { label: "Shipped", value: "Shipped" },
      ],
    },
    {
      name: "quantity",
      type: "number",
      required: true,
      defaultValue: 1,
      min: 1,
    },
  ],
};
