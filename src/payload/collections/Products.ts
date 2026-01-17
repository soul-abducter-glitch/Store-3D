import type { CollectionConfig } from "payload";

const formatSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/(^-|-$)+/g, "");

export const Products: CollectionConfig = {
  slug: "products",
  admin: {
    useAsTitle: "name",
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: "name",
      type: "text",
      required: true,
    },
    {
      name: "slug",
      type: "text",
      index: true,
      unique: true,
      required: true,
      admin: {
        position: "sidebar",
      },
      hooks: {
        beforeValidate: [
          ({ data, value }) => {
            if (value) {
              return value;
            }

            if (data?.name) {
              return formatSlug(String(data.name));
            }

            return value;
          },
        ],
      },
    },
    {
      name: "sku",
      type: "text",
      index: true,
      unique: true,
      required: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "price",
      type: "number",
      min: 0,
      required: true,
    },
    {
      name: "description",
      type: "richText",
    },
    {
      name: "technology",
      type: "select",
      options: ["SLA Resin", "FDM Plastic"],
      required: true,
    },
    {
      name: "format",
      type: "select",
      options: ["Digital STL", "Physical Print"],
      required: true,
    },
    {
      name: "categories",
      type: "relationship",
      relationTo: "categories",
      hasMany: true,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "isVerified",
      type: "checkbox",
      defaultValue: false,
    },
    {
      name: "isFeatured",
      type: "checkbox",
      defaultValue: false,
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "polyCount",
      type: "number",
      min: 0,
    },
    {
      name: "modelScale",
      type: "number",
      min: 0.1,
      max: 10,
      defaultValue: 1,
      admin: {
        position: "sidebar",
        step: 0.1,
      },
    },
    {
      name: "printTime",
      type: "text",
    },
    {
      name: "scale",
      type: "text",
    },
    {
      name: "rawModel",
      type: "upload",
      relationTo: "media",
    },
    {
      name: "paintedModel",
      type: "upload",
      relationTo: "media",
    },
    {
      name: "thumbnail",
      type: "upload",
      relationTo: "media",
    },
  ],
};
