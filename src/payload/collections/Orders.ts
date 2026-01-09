import type { CollectionConfig } from "payload";

import { isAuthenticated } from "../access";

const normalizeEmail = (value?: string) => {
  if (!value) return "";
  return value.trim().toLowerCase();
};

const findUserIdByEmail = async (payloadInstance: any, email?: string) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const result = await payloadInstance.find({
    collection: "users",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      email: {
        equals: normalized,
      },
    },
  });

  const doc = result?.docs?.[0];
  return doc?.id ? String(doc.id) : null;
};

const getProductId = (product: any): string | null => {
  if (!product) return null;
  if (typeof product === "string") return product;
  if (product?.id) return String(product.id);
  if (product?.value) return String(product.value);
  return null;
};

const collectDigitalProductIds = (items: any[]): string[] => {
  if (!Array.isArray(items)) return [];
  const ids = items
    .filter((item) => item?.format === "Digital")
    .map((item) => getProductId(item?.product))
    .filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids));
};

const normalizeRelationshipId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const base = raw.split(":")[0].trim();
  if (!base || /\s/.test(base)) return null;
  if (/^\d+$/.test(base)) return Number(base);
  return base;
};

export const Orders: CollectionConfig = {
  slug: "orders",
  admin: {
    useAsTitle: "id",
  },
  access: {
    read: isAuthenticated,
    create: () => true,
    update: isAuthenticated,
    delete: isAuthenticated,
  },
  hooks: {
    beforeChange: [
      async ({ data, req, operation }) => {
        if (operation !== "create" && operation !== "update") {
          return data;
        }

        const items = Array.isArray(data?.items) ? data.items : [];
        const normalizedItems =
          items
            .map((item: any) => {
              const quantity =
                typeof item?.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
              const unitPrice =
                typeof item?.unitPrice === "number" && item.unitPrice >= 0 ? item.unitPrice : 0;
              const format = item?.format === "Physical" ? "Physical" : "Digital";
              if (!item?.product) {
                return null;
              }
              return {
                ...item,
                product: item.product,
                format,
                quantity,
                unitPrice,
              };
            })
            .filter(Boolean) ?? [];

        if (normalizedItems.length === 0) {
          throw new Error("Order must contain at least one item.");
        }

        const total = normalizedItems.reduce(
          (sum: number, item: any) => sum + item.quantity * item.unitPrice,
          0
        );

        const hasPhysical = normalizedItems.some((item: any) => item.format === "Physical");
        if (hasPhysical) {
          const city = data?.shipping?.city;
          const address = data?.shipping?.address;
          if (!city || !address) {
            throw new Error("Shipping city and address are required for physical items.");
          }
        }

        if (data?.customer?.email) {
          data.customer.email = normalizeEmail(data.customer.email);
        }

        if (!data?.user && req?.user?.id) {
          data.user = req.user.id;
        }

        return {
          ...data,
          items: normalizedItems,
          total,
        };
      },
    ],
    afterChange: [
      async ({ doc, payload, req }) => {
        if (!doc) return doc;
        const payloadInstance = payload ?? req?.payload;
        if (!payloadInstance) return doc;

        const userIdFromDoc = doc.user ? String(doc.user) : null;
        const userId = userIdFromDoc ?? (await findUserIdByEmail(payloadInstance, doc.customer?.email));

        if (userId && !userIdFromDoc) {
          try {
            await payloadInstance.update({
              collection: "orders",
              id: doc.id,
              data: { user: userId },
              overrideAccess: true,
            });
          } catch (error) {
            // If linking the user fails (e.g., doc not yet visible), log and continue
            payloadInstance.logger?.warn({
              msg: "Failed to link user to order in afterChange",
              err: error,
              orderId: doc.id,
              userId,
            });
          }
        }

        if (userId && doc.status === "Paid") {
          const digitalProductIds = collectDigitalProductIds(doc.items || [])
            .map(normalizeRelationshipId)
            .filter((id): id is string | number => id !== null);

          if (digitalProductIds.length > 0) {
            const userDoc = await payloadInstance.findByID({
              collection: "users",
              id: userId,
              depth: 0,
              overrideAccess: true,
            });

            const existingRaw = Array.isArray((userDoc as any)?.purchasedProducts)
              ? (userDoc as any).purchasedProducts
              : [];
            const existing = existingRaw
              .map((id: any) => normalizeRelationshipId(id))
              .filter((id): id is string | number => id !== null);

            const merged = Array.from(new Set([...existing, ...digitalProductIds]));

            if (merged.length !== existing.length) {
              try {
                await payloadInstance.update({
                  collection: "users",
                  id: userId,
                  data: { purchasedProducts: merged },
                  overrideAccess: true,
                });
              } catch (error) {
                payloadInstance.logger?.warn({
                  msg: "Failed to update purchasedProducts for user",
                  err: error,
                  userId,
                  mergedIds: merged,
                });
              }
            }
          }
        }

        return doc;
      },
    ],
  },
  fields: [
    {
      name: "user",
      type: "relationship",
      relationTo: "users",
      required: false,
    },
    {
      name: "customer",
      type: "group",
      fields: [
        {
          name: "name",
          type: "text",
          required: true,
        },
        {
          name: "email",
          type: "email",
          required: true,
        },
        {
          name: "phone",
          type: "text",
          required: false,
        },
      ],
    },
    {
      name: "shipping",
      type: "group",
      fields: [
        {
          name: "method",
          type: "select",
          options: [
            { label: "СДЭК", value: "cdek" },
            { label: "Почта России", value: "pochta" },
            { label: "Самовывоз", value: "pickup" },
          ],
        },
        {
          name: "zipCode",
          type: "text",
        },
        {
          name: "city",
          type: "text",
        },
        {
          name: "address",
          type: "text",
        },
      ],
    },
    {
      name: "items",
      type: "array",
      required: true,
      minRows: 1,
      fields: [
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
          name: "quantity",
          type: "number",
          required: true,
          defaultValue: 1,
          min: 1,
        },
        {
          name: "unitPrice",
          type: "number",
          required: true,
          min: 0,
        },
      ],
    },
    {
      name: "total",
      type: "number",
      required: true,
      min: 0,
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "Pending",
      options: [
        { label: "Pending", value: "Pending" },
        { label: "Paid", value: "Paid" },
        { label: "Printing", value: "Printing" },
        { label: "Shipped", value: "Shipped" },
      ],
    },
  ],
};
