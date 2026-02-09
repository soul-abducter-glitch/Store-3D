import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";

export const dynamic = "force-dynamic";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

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

const isDigitalFormat = (value: unknown) => {
  if (!value) return false;
  const raw = String(value).trim().toLowerCase();
  return raw.includes("digital") || raw.includes("цифров");
};

const collectDigitalProductIds = (items: Array<{ format?: string; product?: unknown }>) => {
  const ids = items
    .filter((item) =>
      isDigitalFormat((item as any)?.format ?? (item as any)?.type ?? (item as any)?.formatLabel)
    )
    .map((item) => getProductId(item?.product))
    .filter((id): id is string | number => id !== null);
  return Array.from(new Set(ids));
};

const resolveToken = (request: NextRequest) =>
  request.headers.get("x-admin-token") ||
  request.nextUrl.searchParams.get("token") ||
  "";

export async function POST(request: NextRequest) {
  const requiredToken = process.env.BACKFILL_TOKEN;
  if (requiredToken) {
    const token = resolveToken(request);
    if (!token || token !== requiredToken) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Backfill token is required." }, { status: 403 });
  }

  const payload = await getPayloadClient();

  let page = 1;
  const limit = 50;
  let totalPages = 1;
  let ordersScanned = 0;
  let usersUpdated = 0;
  let ordersLinked = 0;

  const emailCache = new Map<string, string>();

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

    const docs = Array.isArray(result?.docs) ? result.docs : [];
    totalPages = result?.totalPages ?? 1;

    for (const order of docs as any[]) {
      ordersScanned += 1;
      const items = Array.isArray(order?.items) ? order.items : [];
      const digitalIds = collectDigitalProductIds(items);
      if (digitalIds.length === 0) {
        continue;
      }

      let userId = normalizeRelationshipId(order?.user);
      const customerEmail = normalizeEmail(order?.customer?.email);
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

      if (!order?.user) {
        try {
          await payload.update({
            collection: "orders",
            id: order.id,
            data: { user: userId },
            overrideAccess: true,
          });
          ordersLinked += 1;
        } catch {
          // ignore linking errors
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

  return NextResponse.json({
    ok: true,
    ordersScanned,
    usersUpdated,
    ordersLinked,
  });
}

