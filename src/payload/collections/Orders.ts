import type { Access, CollectionConfig } from "payload";

const normalizeEmail = (value?: string) => {
  if (!value) return "";
  return value.trim().toLowerCase();
};

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

const isAdminPanelRequest = (req?: any) => {
  const referer =
    (typeof req?.headers?.referer === "string" && req.headers.referer) ||
    (typeof req?.headers?.referrer === "string" && req.headers.referrer) ||
    "";
  return Boolean(referer && referer.includes("/admin"));
};

const isPrivilegedRequest = (req?: any) => {
  if (isAdminPanelRequest(req)) {
    return true;
  }
  const adminEmails = parseAdminEmails();
  if (!adminEmails.length) {
    return false;
  }
  const email = normalizeEmail(req?.user?.email);
  return Boolean(email && adminEmails.includes(email));
};

const isInternalPaymentUpdate = (req?: any) => {
  if (!req) return false;
  const headerValue =
    (typeof req?.headers?.get === "function" &&
      req.headers.get("x-internal-payment")) ||
    (typeof req?.headers === "object" &&
      (req.headers["x-internal-payment"] ||
        req.headers["X-Internal-Payment"])) ||
    "";
  const normalized = String(headerValue || "").toLowerCase();
  return normalized === "stripe" || normalized === "mock";
};

const isOrderOwner: Access = ({ req }) => {
  const user = req.user;
  if (!user) {
    return false;
  }
  if (isPrivilegedRequest(req)) {
    return true;
  }
  const email = normalizeEmail((user as any)?.email);
  const or: any[] = [{ user: { equals: user.id } }];
  if (email) {
    or.push({ "customer.email": { equals: email } });
  }
  return { or };
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
  return extractRelationshipId(doc?.id);
};

const getProductId = (product: any): string | null => {
  if (!product) return null;
  if (typeof product === "string") return product;
  if (product?.id) return String(product.id);
  if (product?.value) return String(product.value);
  return null;
};

const isDigitalFormat = (value: unknown) => {
  if (!value) return false;
  const raw = String(value).trim().toLowerCase();
  return raw.includes("digital") || raw.includes("цифров");
};

const collectDigitalProductIds = (items: any[]): string[] => {
  if (!Array.isArray(items)) return [];
  const ids = items
    .filter((item) =>
      isDigitalFormat(
        item?.format ?? item?.formatKey ?? item?.type ?? item?.formatLabel
      )
    )
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

const extractRelationshipId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const candidate =
      (value as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (value as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (value as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
    return normalizeRelationshipId(candidate);
  }
  return normalizeRelationshipId(value);
};

const normalizeOrderStatus = (value?: string) => {
  if (!value) return "accepted";
  const raw = String(value);
  const normalized = raw.trim().toLowerCase();
  if (normalized === "paid" || raw === "Paid") return "paid";
  if (normalized === "accepted" || normalized === "in_progress") return "accepted";
  if (normalized === "printing" || raw === "Printing") return "printing";
  if (normalized === "ready" || raw === "Shipped") return "ready";
  if (normalized === "completed" || normalized === "done") return "completed";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  return "paid";
};

const resolvePaymentsMode = () => {
  const raw = (process.env.PAYMENTS_MODE || "off").trim().toLowerCase();
  if (raw === "mock" || raw === "live" || raw === "stripe") return raw;
  return "off";
};

const normalizePaymentStatus = (value?: string) => {
  if (!value) return "pending";
  const raw = String(value).trim().toLowerCase();
  if (raw === "paid" || raw === "success") return "paid";
  if (raw === "failed" || raw === "error") return "failed";
  if (raw === "refunded" || raw === "refund") return "refunded";
  return "pending";
};

const normalizePaymentMethod = (value?: string) => {
  if (!value) return "card";
  const raw = String(value).trim().toLowerCase();
  if (raw === "sbp") return "sbp";
  if (raw === "cash" || raw === "cod") return "cash";
  return "card";
};

const CANCEL_WINDOW_MINUTES = 30;

const resolveCreatedAtMs = (value?: unknown) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
};

const isWithinCancelWindow = (createdAt?: unknown) => {
  const createdAtMs = resolveCreatedAtMs(createdAt);
  if (!createdAtMs) return false;
  return Date.now() - createdAtMs <= CANCEL_WINDOW_MINUTES * 60 * 1000;
};

export const Orders: CollectionConfig = {
  slug: "orders",
  admin: {
    useAsTitle: "id",
  },
  access: {
    read: isOrderOwner,
    create: () => true,
    update: isOrderOwner,
    delete: isOrderOwner,
  },
  hooks: {
    beforeChange: [
      async ({ data, req, operation, originalDoc }) => {
        if (operation !== "create" && operation !== "update") {
          return data;
        }
        const hasStatusField = data && Object.prototype.hasOwnProperty.call(data, "status");
        const prevStatus = normalizeOrderStatus(originalDoc?.status);
        let nextStatus = normalizeOrderStatus(hasStatusField ? data?.status : originalDoc?.status);
        const hasPaymentStatusField =
          data && Object.prototype.hasOwnProperty.call(data, "paymentStatus");
        const prevPaymentStatus = normalizePaymentStatus(originalDoc?.paymentStatus);
        let nextPaymentStatus = normalizePaymentStatus(
          hasPaymentStatusField ? data?.paymentStatus : originalDoc?.paymentStatus
        );
        const hasPaymentMethodField =
          data && Object.prototype.hasOwnProperty.call(data, "paymentMethod");
        const paymentsMode = resolvePaymentsMode();
        const privileged = isPrivilegedRequest(req);
        const isInternal = !req;

        if (hasStatusField) {
          if (
            nextStatus === "cancelled" &&
            (prevStatus === "ready" || prevStatus === "completed")
          ) {
            throw new Error("Нельзя отменить заказ после статуса <Готов к выдаче>.");
          }
          if (nextStatus === "cancelled" && !privileged) {
            const originalItems = Array.isArray(originalDoc?.items) ? originalDoc.items : [];
            const hasPhysical =
              originalItems.length > 0
                ? originalItems.some((item: any) => !isDigitalFormat(item?.format))
                : false;
            if (!hasPhysical) {
              throw new Error("Цифровые заказы нельзя отменить.");
            }
            if (!isWithinCancelWindow(originalDoc?.createdAt)) {
              throw new Error("Отмена доступна в течение 30 минут после оформления.");
            }
          }
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
        if (operation === "create" && !privileged && paymentsMode !== "off") {
          nextPaymentStatus = "pending";
        }

        const defaultPaymentStatus = paymentsMode === "off" ? "paid" : "pending";
        const paymentStatus = hasPaymentStatusField ? nextPaymentStatus : defaultPaymentStatus;
        const paymentMethod = normalizePaymentMethod(
          hasPaymentMethodField ? data?.paymentMethod : originalDoc?.paymentMethod
        );

        const internalPaymentUpdate = isInternalPaymentUpdate(req);
        if (
          hasPaymentStatusField &&
          operation === "update" &&
          !privileged &&
          !isInternal &&
          !internalPaymentUpdate
        ) {
          if (nextPaymentStatus !== prevPaymentStatus) {
            throw new Error("Статус оплаты может быть изменен только администратором.");
          }
        }

        if (hasStatusField && nextStatus === "paid" && !privileged && !internalPaymentUpdate) {
          const allowPaidOnCreate = operation === "create" && !hasPhysical;
          if (!allowPaidOnCreate) {
            if (operation === "update") {
              throw new Error("Статус оплаты может быть установлен только администратором.");
            }
            nextStatus = "accepted";
          }
        }
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
        const resolvedUser =
          req?.user?.id && !privileged
            ? req.user.id
            : data?.user || req?.user?.id || undefined;

        return {
          ...data,
          status: nextStatus,
          paymentStatus,
          paymentMethod: hasPhysical ? paymentMethod : "card",
          items: normalizedItems,
          total,
          ...(resolvedUser ? { user: resolvedUser } : {}),
        };
      },
    ],
    afterChange: [
      async ({ doc, req, operation }) => {
        if (!doc) return doc;
        const payloadInstance = req?.payload;
        if (!payloadInstance) return doc;

        const userIdFromDoc = extractRelationshipId(doc.user);
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

        const normalizedStatus = normalizeOrderStatus(doc.status);
        const normalizedPaymentStatus = normalizePaymentStatus(
          doc.paymentStatus ??
            (normalizedStatus === "paid" || normalizedStatus === "completed" ? "paid" : "pending")
        );
        const allowInstantDigital = resolvePaymentsMode() === "off";
        const shouldGrantDigital =
          normalizedPaymentStatus === "paid" ||
          normalizedStatus === "paid" ||
          normalizedStatus === "completed" ||
          (allowInstantDigital && operation === "create");

        if (userId && shouldGrantDigital) {
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
              .filter((id: string | number | null): id is string | number => id !== null);

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
            { label: "Яндекс.Доставка", value: "yandex" },
            { label: "OZON Rocket", value: "ozon" },
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
        {
          name: "customerUpload",
          type: "upload",
          relationTo: "media",
        },
        {
          name: "printSpecs",
          type: "group",
          fields: [
            {
              name: "technology",
              type: "text",
            },
            {
              name: "material",
              type: "text",
            },
            {
              name: "quality",
              type: "text",
            },
            {
              name: "dimensions",
              type: "group",
              fields: [
                { name: "x", type: "number" },
                { name: "y", type: "number" },
                { name: "z", type: "number" },
              ],
            },
            {
              name: "volumeCm3",
              type: "number",
              min: 0,
            },
            {
              name: "isHollow",
              type: "checkbox",
            },
            {
              name: "infillPercent",
              type: "number",
              min: 0,
              max: 100,
            },
          ],
        },
      ],
    },
    {
      name: "customFile",
      type: "upload",
      relationTo: "media",
    },
    {
      name: "technicalSpecs",
      type: "group",
      fields: [
        {
          name: "material",
          type: "text",
        },
        {
          name: "technology",
          type: "text",
        },
        {
          name: "quality",
          type: "text",
        },
        {
          name: "dimensions",
          type: "group",
          fields: [
            { name: "x", type: "number" },
            { name: "y", type: "number" },
            { name: "z", type: "number" },
          ],
        },
        {
          name: "volumeCm3",
          type: "number",
          min: 0,
        },
        {
          name: "isHollow",
          type: "checkbox",
        },
        {
          name: "infillPercent",
          type: "number",
          min: 0,
          max: 100,
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
      name: "paymentStatus",
      type: "select",
      required: true,
      defaultValue: resolvePaymentsMode() === "off" ? "paid" : "pending",
      options: [
        { label: "Ожидает оплаты", value: "pending" },
        { label: "Оплачено", value: "paid" },
        { label: "Ошибка оплаты", value: "failed" },
        { label: "Возврат", value: "refunded" },
      ],
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "paymentMethod",
      type: "select",
      options: [
        { label: "Карта", value: "card" },
        { label: "СБП", value: "sbp" },
        { label: "Наличные", value: "cash" },
      ],
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "paymentProvider",
      type: "text",
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "paymentIntentId",
      type: "text",
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "paidAt",
      type: "date",
      admin: {
        position: "sidebar",
      },
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "paid",
      options: [
        { label: "Оплачено / Ожидает проверки", value: "paid" },
        { label: "Принято в работу", value: "accepted" },
        { label: "Печатается", value: "printing" },
        { label: "Готов к выдаче", value: "ready" },
        { label: "Отменен", value: "cancelled" },
        { label: "Завершен", value: "completed" },
      ],
    },
  ],
};


