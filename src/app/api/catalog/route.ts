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

const normalizeRelationId = (value: unknown): string | null => {
  let current: unknown = value;
  while (typeof current === "object" && current !== null) {
    current =
      (current as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (current as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (current as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
  }
  if (current === null || current === undefined) return null;
  const raw = String(current).trim();
  return raw || null;
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;

const normalizeSchemaName = (value: unknown) => {
  if (typeof value !== "string") return "public";
  const trimmed = value.trim();
  if (!trimmed) return "public";
  return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : "public";
};

const escapeSqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

const executeRaw = async (payload: any, raw: string) => {
  const db = payload?.db;
  const execute = db?.execute;
  if (typeof execute === "function") {
    try {
      return await execute.call(db, { raw });
    } catch (error) {
      const query = db?.pool?.query;
      if (typeof query === "function") {
        return await query.call(db.pool, raw);
      }
      throw error;
    }
  }
  const query = db?.pool?.query;
  if (typeof query === "function") {
    return await query.call(db.pool, raw);
  }
  return null;
};

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
      rawModel: fileName
        ? {
            id: `fallback-media-${index + 1}`,
            url: "",
            filename: fileName,
            thumbnail: null,
          }
        : null,
      paintedModel: null,
      thumbnail: null,
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

const readMediaLookupFromDb = async (payload: any, ids: string[]) => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<string, MediaDoc>();
  }

  try {
    const schema = normalizeSchemaName(payload?.db?.schemaName);
    const columnsResult = await executeRaw(
      payload,
      `SELECT column_name FROM information_schema.columns WHERE table_schema = ${escapeSqlLiteral(
        schema
      )} AND table_name = 'media'`
    );
    const availableColumns = new Set(
      Array.isArray(columnsResult?.rows)
        ? columnsResult.rows
            .map((row: any) => (typeof row?.column_name === "string" ? row.column_name : ""))
            .filter(Boolean)
        : []
    );

    if (!availableColumns.has("id")) {
      return new Map<string, MediaDoc>();
    }

    const selectedColumns = ["id"]
      .concat(
        ["url", "filename", "thumbnail_url"].filter((column) => availableColumns.has(column))
      )
      .map((column) => quoteIdentifier(column))
      .join(", ");
    const tableRef = `${quoteIdentifier(schema)}.${quoteIdentifier("media")}`;
    const idList = uniqueIds
      .map((id) => (/^\d+$/.test(id) ? id : escapeSqlLiteral(id)))
      .join(", ");
    if (!idList) {
      return new Map<string, MediaDoc>();
    }

    const rowsResult = await executeRaw(
      payload,
      `SELECT ${selectedColumns} FROM ${tableRef} WHERE ${quoteIdentifier("id")} IN (${idList})`
    );
    const rows = Array.isArray(rowsResult?.rows) ? rowsResult.rows : [];
    const mediaMap = new Map<string, MediaDoc>();
    rows.forEach((row: any) => {
      const id = normalizeRelationId(row?.id);
      if (!id) return;
      mediaMap.set(id, {
        id,
        url: typeof row?.url === "string" ? row.url : undefined,
        filename: typeof row?.filename === "string" ? row.filename : undefined,
        thumbnail: typeof row?.thumbnail_url === "string" ? row.thumbnail_url : null,
      });
    });
    return mediaMap;
  } catch {
    return new Map<string, MediaDoc>();
  }
};

const hydrateMediaField = (value: unknown, mediaById: Map<string, MediaDoc>) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const id = normalizeRelationId(value);
    if (id && mediaById.has(id)) {
      const lookedUp = mediaById.get(id)!;
      return {
        ...(value as Record<string, unknown>),
        id: lookedUp.id ?? id,
        url: lookedUp.url ?? (value as any)?.url,
        filename: lookedUp.filename ?? (value as any)?.filename,
        thumbnail: lookedUp.thumbnail ?? (value as any)?.thumbnail ?? null,
      };
    }
    return value;
  }
  const id = normalizeRelationId(value);
  if (!id) return null;
  const lookedUp = mediaById.get(id);
  if (lookedUp) return lookedUp;
  return { id };
};

const loadCatalogFromPayload = async (payload: any) => {
  try {
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

    return {
      products: (productsResult?.docs ?? []).map(normalizeProduct),
      categories: (categoriesResult?.docs ?? []).map(normalizeCategory).filter(Boolean),
      source: "db-depth1" as const,
      depthError: null as string | null,
    };
  } catch (depthError) {
    const [productsResult, categoriesResult] = await Promise.all([
      payload.find({
        collection: "products",
        depth: 0,
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

    const productDocs = Array.isArray(productsResult?.docs) ? productsResult.docs : [];
    const mediaIds = productDocs
      .flatMap((doc: any): Array<string | null> => [
        normalizeRelationId(doc?.rawModel),
        normalizeRelationId(doc?.paintedModel),
        normalizeRelationId(doc?.thumbnail),
      ])
      .filter((value: string | null): value is string => Boolean(value));
    const mediaById = await readMediaLookupFromDb(payload, mediaIds);
    const hydratedProducts = productDocs.map((doc: any) =>
      normalizeProduct({
        ...doc,
        rawModel: hydrateMediaField(doc?.rawModel ?? null, mediaById),
        paintedModel: hydrateMediaField(doc?.paintedModel ?? null, mediaById),
        thumbnail: hydrateMediaField(doc?.thumbnail ?? null, mediaById),
      })
    );

    return {
      products: hydratedProducts,
      categories: (categoriesResult?.docs ?? []).map(normalizeCategory).filter(Boolean),
      source: "db-depth0" as const,
      depthError:
        depthError instanceof Error ? depthError.message.replace(/\s+/g, " ").trim().slice(0, 260) : String(depthError),
    };
  }
};

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

  let degradedReason = "unknown";
  try {
    degradedReason = "payload:init";
    const payload = await getPayloadClient();
    degradedReason = "payload:find";
    const loadedCatalog = await loadCatalogFromPayload(payload);
    if (loadedCatalog.source === "db-depth0" && loadedCatalog.depthError) {
      console.warn("[catalog] depth=1 query failed, served depth=0 fallback", {
        reason: degradedReason,
        error: loadedCatalog.depthError,
      });
    }

    const data = { products: loadedCatalog.products, categories: loadedCatalog.categories };
    cacheStore[CACHE_KEY] = { ts: now, data };

    return NextResponse.json(
      loadedCatalog.source === "db-depth1"
        ? data
        : {
            ...data,
            source: loadedCatalog.source,
          },
      {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
      },
      }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message.replace(/\s+/g, " ").trim().slice(0, 180) : String(error);
    console.error("[catalog] failed to load from DB, using fallback", {
      reason: degradedReason,
      error: errorMessage,
    });

    if (cacheStore[CACHE_KEY]) {
      return NextResponse.json(
        {
          ...cacheStore[CACHE_KEY].data,
          degraded: true,
          source: "stale-cache",
          degradedReason,
          degradedError: errorMessage,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const fallback = buildFallbackCatalogData();
    return NextResponse.json(
      {
        ...fallback,
        degraded: true,
        source: "seed-fallback",
        degradedReason,
        degradedError: errorMessage,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}

