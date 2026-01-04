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
      name: "isVerified",
      type: "checkbox",
      defaultValue: false,
    },
    {
      name: "polyCount",
      type: "number",
      min: 0,
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
  ],
};
