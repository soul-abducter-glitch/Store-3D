import { NextResponse } from "next/server";
import { getPayloadHMR } from "@payloadcms/next/utilities";

import payloadConfig from "../../../../payload.config";
import { importMap } from "../../(payload)/admin/importMap";

export const dynamic = "force-dynamic";

type MediaDoc = {
  id?: string | number;
  url?: string;
  filename?: string;
  thumbnail?: string | null;
};

const CACHE_TTL_MS = 60_000;
const CACHE_KEY = "__store3d_catalog_cache__";

const getPayload = async () =>
  getPayloadHMR({
    config: payloadConfig,
    importMap,
  });

const pickMedia = (value?: MediaDoc | string | null) => {
  if (!value) return null;
  if (typeof value === "string") {
    return value;
  }
  return {
    id: value.id,
    url: value.url,
    filename: value.filename,
    thumbnail: value.thumbnail ?? null,
  };
};

const normalizeCategory = (value: any) => {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  const parent = value.parent;
  const parentValue =
    typeof parent === "object" && parent
      ? parent.id ?? parent.value ?? parent._id ?? null
      : parent ?? null;
  return {
    id: value.id,
    title: value.title,
    parent: parentValue,
  };
};

const normalizeProduct = (doc: any) => ({
  id: doc?.id,
  name: doc?.name,
  slug: doc?.slug,
  sku: doc?.sku,
  format: doc?.format,
  technology: doc?.technology,
  price: doc?.price,
  polyCount: doc?.polyCount,
  modelScale: doc?.modelScale,
  printTime: doc?.printTime,
  scale: doc?.scale,
  isVerified: doc?.isVerified,
  isFeatured: doc?.isFeatured,
  category: normalizeCategory(doc?.category),
  categories: Array.isArray(doc?.categories)
    ? doc.categories.map(normalizeCategory).filter(Boolean)
    : doc?.categories?.docs
      ? doc.categories.docs.map(normalizeCategory).filter(Boolean)
      : doc?.categories?.data
        ? doc.categories.data.map(normalizeCategory).filter(Boolean)
        : doc?.categories ?? null,
  rawModel: pickMedia(doc?.rawModel ?? null),
  paintedModel: pickMedia(doc?.paintedModel ?? null),
  thumbnail: pickMedia(doc?.thumbnail ?? null),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fresh = url.searchParams.get("fresh") === "1";
  const now = Date.now();
  const cacheStore = globalThis as typeof globalThis & {
    [CACHE_KEY]?: { ts: number; data: { products: any[]; categories: any[] } };
  };

  if (!fresh && cacheStore[CACHE_KEY] && now - cacheStore[CACHE_KEY].ts < CACHE_TTL_MS) {
    return NextResponse.json(
      { ...cacheStore[CACHE_KEY].data, cached: true },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      }
    );
  }

  const payload = await getPayload();
  const [productsResult, categoriesResult] = await Promise.all([
    payload.find({
      collection: "products",
      depth: 1,
      limit: 200,
      overrideAccess: true,
    }),
    payload.find({
      collection: "categories",
      depth: 0,
      limit: 200,
      overrideAccess: true,
    }),
  ]);

  const products = (productsResult?.docs ?? []).map(normalizeProduct);
  const categories = (categoriesResult?.docs ?? []).map(normalizeCategory).filter(Boolean);

  const data = { products, categories };
  cacheStore[CACHE_KEY] = { ts: now, data };

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
