import type { CollectionConfig } from "payload";

export const Categories: CollectionConfig = {
  slug: "categories",
  admin: {
    useAsTitle: "title",
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: "title",
      type: "text",
      required: true,
    },
    {
      name: "parent",
      type: "relationship",
      relationTo: "categories",
      admin: {
        position: "sidebar",
      },
    },
  ],
};
