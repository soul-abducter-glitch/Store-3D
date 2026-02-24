import { NextResponse } from "next/server";
import { getPayload } from "payload";

import fallbackCatalogSeed from "../../../../products.json";

export const dynamic = "force-dynamic";

type MediaDoc = {
  id?: string | number;
  url?: string;
  filename?: string;
  thumbnail?: string | null;
};

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_KEY = "__store3d_catalog_cache__";

const getPayloadClient = async () => {
  const configModule = await import("../../../../payload.config");
  return getPayload({ config: configModule.default });
};

type FallbackProductSeed = {
  name?: string;
  fileName?: string;
  price?: number;
  category?: string;
  technology?: string;
  format?: string;
  polyCount?: number;
  printTime?: string;
  scale?: string;
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const toNumeric = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const buildFallbackCatalogData = () => {
  const seed = Array.isArray(fallbackCatalogSeed) ? (fallbackCatalogSeed as FallbackProductSeed[]) : [];
  const categoryMap = new Map<string, { id: string; title: string; parent: null }>();
  const products = seed.map((row, index) => {
    const name = toNonEmptyString(row?.name) || `Product ${index + 1}`;
    const slug = slugify(name) || `product-${index + 1}`;
    const categoryTitle = toNonEmptyString(row?.category) || "Uncategorized";
    const categoryId = slugify(categoryTitle) || `category-${index + 1}`;
    if (!categoryMap.has(categoryId)) {
      categoryMap.set(categoryId, {
        id: categoryId,
        title: categoryTitle,
        parent: null,
      });
    }

    const fileName = toNonEmptyString(row?.fileName);
    const modelUrl = fileName ? `/models/${encodeURIComponent(fileName)}` : "";
    const thumbName = fileName && fileName.toLowerCase().endsWith(".glb")
      ? fileName.replace(/\.glb$/i, ".png")
      : "";

    return {
      id: `fallback-${index + 1}`,
      name,
      slug,
      sku: "",
      format: toNonEmptyString(row?.format) || "Digital STL",
      technology: toNonEmptyString(row?.technology) || "FDM Plastic",
      price: toNumeric(row?.price),
      polyCount: Math.max(0, Math.trunc(toNumeric(row?.polyCount))),
      modelScale: null,
      printTime: toNonEmptyString(row?.printTime) || "",
      scale: toNonEmptyString(row?.scale) || "",
      isVerified: true,
      isFeatured: false,
      category: categoryMap.get(categoryId),
      categories: [categoryMap.get(categoryId)],
      rawModel: modelUrl
        ? {
            id: `fallback-media-${index + 1}`,
            url: modelUrl,
            filename: fileName,
            thumbnail: null,
          }
        : null,
      paintedModel: null,
      thumbnail: thumbName
        ? {
            id: `fallback-thumb-${index + 1}`,
            url: `/models/${encodeURIComponent(thumbName)}`,
            filename: thumbName,
            thumbnail: null,
          }
        : null,
    };
  });

  return {
    products,
    categories: Array.from(categoryMap.values()),
  };
};

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
          "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
        },
      }
    );
  }

  try {
    const payload = await getPayloadClient();
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
        "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
      },
    });
  } catch (error) {
    console.error("[catalog] failed to load from DB, using fallback", {
      error: error instanceof Error ? error.message : String(error),
    });

    if (cacheStore[CACHE_KEY]) {
      return NextResponse.json(
        {
          ...cacheStore[CACHE_KEY].data,
          degraded: true,
          source: "stale-cache",
        },
        {
          headers: {
            "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
          },
        }
      );
    }

    const fallback = buildFallbackCatalogData();
    cacheStore[CACHE_KEY] = { ts: now, data: fallback };
    return NextResponse.json(
      {
        ...fallback,
        degraded: true,
        source: "seed-fallback",
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
        },
      }
    );
  }
}

