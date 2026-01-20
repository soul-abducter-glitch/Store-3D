import fs from "fs";
import path from "path";

import { getPayload } from "payload";

type OrderItem = {
  format?: string;
  product?: unknown;
};

type OrderDoc = {
  id?: string | number;
  user?: string | number | null;
  customer?: { email?: string | null } | null;
  items?: OrderItem[] | null;
};

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const normalizeEmail = (value?: string | null) => {
  if (!value) return "";
  return value.trim().toLowerCase();
};

const normalizeRelationshipId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  const base = raw.split(":")[0].trim();
  if (!base || /\s/.test(base)) {
    return null;
  }
  if (/^\d+$/.test(base)) {
    return Number(base);
  }
  return base;
};

const getProductId = (product: unknown): string | number | null => {
  if (!product) return null;
  if (typeof product === "string" || typeof product === "number") {
    return normalizeRelationshipId(product);
  }
  if (typeof product === "object") {
    const candidate =
      (product as any).id ??
      (product as any).value ??
      (product as any)._id ??
      (product as any).slug;
    return normalizeRelationshipId(candidate);
  }
  return null;
};

const collectDigitalProductIds = (items: OrderItem[] = []) => {
  const ids = items
    .filter((item) => item?.format === "Digital")
    .map((item) => getProductId(item?.product))
    .filter((id): id is string | number => id !== null);
  return Array.from(new Set(ids));
};

const run = async () => {
  const configUrl = new URL("../payload.config.simple.ts", import.meta.url);
  const { default: payloadConfig } = await import(configUrl.href);
  const payload = await getPayload({ config: payloadConfig });

  let page = 1;
  const limit = 50;
  let totalPages = 1;

  const emailCache = new Map<string, string>();
  let ordersScanned = 0;
  let usersUpdated = 0;
  let ordersLinked = 0;

  do {
    const result = await payload.find({
      collection: "orders",
      depth: 0,
      limit,
      page,
      overrideAccess: true,
      where: {
        status: {
          in: ["paid", "completed"],
        },
      },
    });

    const docs = (result?.docs ?? []) as OrderDoc[];
    totalPages = result?.totalPages ?? 1;

    for (const order of docs) {
      ordersScanned += 1;
      const items = Array.isArray(order.items) ? order.items : [];
      const digitalIds = collectDigitalProductIds(items);
      if (digitalIds.length === 0) {
        continue;
      }

      let userId = normalizeRelationshipId(order.user);
      const customerEmail = normalizeEmail(order.customer?.email);
      if (!userId && customerEmail) {
        if (emailCache.has(customerEmail)) {
          userId = emailCache.get(customerEmail) || null;
        } else {
          const userLookup = await payload.find({
            collection: "users",
            depth: 0,
            limit: 1,
            overrideAccess: true,
            where: {
              email: {
                equals: customerEmail,
              },
            },
          });
          const resolvedId =
            userLookup?.docs?.[0]?.id !== undefined
              ? String(userLookup.docs[0].id)
              : "";
          if (resolvedId) {
            emailCache.set(customerEmail, resolvedId);
            userId = resolvedId;
          }
        }
      }

      if (!userId) {
        continue;
      }

      if (!order.user) {
        try {
          await payload.update({
            collection: "orders",
            id: order.id as any,
            data: { user: userId },
            overrideAccess: true,
          });
          ordersLinked += 1;
        } catch {
          // keep going; linking is optional for backfill
        }
      }

      const userDoc = await payload.findByID({
        collection: "users",
        id: userId as any,
        depth: 0,
        overrideAccess: true,
      });
      const existingRaw = Array.isArray((userDoc as any)?.purchasedProducts)
        ? (userDoc as any).purchasedProducts
        : [];
      const existing = existingRaw
        .map((entry: any) => normalizeRelationshipId(entry))
        .filter((entry: string | number | null): entry is string | number => entry !== null);

      const merged = Array.from(new Set([...existing, ...digitalIds]));
      if (merged.length !== existing.length) {
        await payload.update({
          collection: "users",
          id: userId as any,
          data: { purchasedProducts: merged },
          overrideAccess: true,
        });
        usersUpdated += 1;
      }
    }

    page += 1;
  } while (page <= totalPages);

  console.log(
    `Backfill done. Orders scanned: ${ordersScanned}. Users updated: ${usersUpdated}. Orders linked: ${ordersLinked}.`
  );

  if (typeof payload.db?.destroy === "function") {
    await payload.db.destroy();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
