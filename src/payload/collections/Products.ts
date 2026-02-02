import type { CollectionConfig } from "payload";

const formatSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/(^-|-$)+/g, "");

const normalizeSkuBase = (value?: string | null) => {
  const raw = String(value ?? "").trim().toUpperCase();
  const cleaned = raw.replace(/[^A-Z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
  return cleaned || "MODEL";
};

const buildSku = (data?: Record<string, unknown>) => {
  const baseSource =
    (data?.slug as string | undefined) ??
    (data?.name as string | undefined) ??
    "MODEL";
  const base = normalizeSkuBase(baseSource);
  const suffix = String(Date.now()).slice(-4);
  return `SKU-${base}-${suffix}`;
};

const buildDescriptionValue = (data?: Record<string, unknown>) => {
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  const format = typeof data?.format === "string" ? data.format : "";
  const tech = typeof data?.technology === "string" ? data.technology : "";

  const lines: string[] = [];
  if (name) {
    lines.push(`${name}.`);
  }
  if (format === "Digital STL") {
    lines.push("Цифровая модель для скачивания (STL/GLB).");
  } else if (format === "Physical Print") {
    lines.push("Физическая печать модели под заказ.");
  }
  if (tech) {
    lines.push(`Технология печати: ${tech}.`);
  }
  const text = lines.join(" ");

  return {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: "ltr",
      children: [
        {
          type: "paragraph",
          format: "",
          indent: 0,
          version: 1,
          direction: "ltr",
          children: [
            {
              type: "text",
              text: text || "Описание будет добавлено позже.",
              mode: "normal",
              style: "",
              detail: 0,
              format: 0,
            },
          ],
        },
      ],
    },
  };
};

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
      hooks: {
        beforeValidate: [
          ({ value, data }) => {
            if (value) {
              return value;
            }
            return buildSku(data);
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
      hooks: {
        beforeValidate: [
          ({ value, data }) => {
            if (value && Object.keys(value).length > 0) {
              return value;
            }
            return buildDescriptionValue(data);
          },
        ],
      },
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
    {
      name: "thumbnailUrl",
      type: "text",
      admin: {
        description: "Необязательно. Например: /catalog/warrior_sultan.jpg",
      },
    },
  ],
};
