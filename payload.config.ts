import path from "path";

import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { s3Storage } from "@payloadcms/storage-s3";
import { buildConfig } from "payload";

import { Categories } from "./src/payload/collections/Categories.ts";
import { Media } from "./src/payload/collections/Media.ts";
import { Orders } from "./src/payload/collections/Orders.ts";
import { Products } from "./src/payload/collections/Products.ts";
import { Users } from "./src/payload/collections/Users.ts";
import { AiJobs } from "./src/payload/collections/AiJobs.ts";
import { AiAssets } from "./src/payload/collections/AiAssets.ts";
import { ensureAiLabSchema } from "./src/lib/ensureAiLabSchema.ts";

const normalizeOrigin = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, "");
};
const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
const vercelBranchUrl = process.env.VERCEL_BRANCH_URL
  ? `https://${process.env.VERCEL_BRANCH_URL}`
  : null;
const serverURL =
  normalizeOrigin(process.env.NEXT_PUBLIC_SERVER_URL) ||
  normalizeOrigin(vercelUrl) ||
  "http://localhost:3000";
const payloadSecret = process.env.PAYLOAD_SECRET;
const databaseURL = process.env.DATABASE_URL;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const s3Bucket = process.env.S3_BUCKET;
const s3Endpoint = process.env.S3_ENDPOINT;
const s3PublicAccessKeyId = process.env.S3_PUBLIC_ACCESS_KEY_ID || s3AccessKeyId;
const s3PublicSecretAccessKey =
  process.env.S3_PUBLIC_SECRET_ACCESS_KEY || s3SecretAccessKey;
const s3PublicBucket = process.env.S3_PUBLIC_BUCKET || s3Bucket;
const s3PublicEndpoint = process.env.S3_PUBLIC_ENDPOINT || s3Endpoint;
const s3PublicRegion = process.env.S3_PUBLIC_REGION || process.env.S3_REGION || "us-east-1";
const nodeEnv = process.env.NODE_ENV || "development";

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const enableSchemaPush = parseBoolean(process.env.PAYLOAD_DB_PUSH, nodeEnv !== "production");
const enableBootstrapSeed = parseBoolean(
  process.env.PAYLOAD_ENABLE_BOOTSTRAP_SEED,
  nodeEnv !== "production"
);
const allowedOrigins = Array.from(
  new Set(
    [
      "http://localhost:3000",
      "http://localhost:3001",
      process.env.NEXT_PUBLIC_SITE_URL,
      serverURL,
      process.env.NEXT_PUBLIC_CORS_URL,
      process.env.NEXT_PUBLIC_FRONTEND_URL,
      vercelUrl,
      vercelBranchUrl,
    ]
      .map((origin) => normalizeOrigin(origin))
      .filter((origin): origin is string => Boolean(origin))
  )
);

const baseCategories = [
  {
    title: "Персонажи",
    children: ["Мужчины", "Женщины", "Фэнтези"],
  },
  {
    title: "Настолки",
    children: ["Миниатюры", "Монстры", "Сцены"],
  },
  {
    title: "Дом",
    children: ["Декор", "Органайзеры", "Освещение"],
  },
  {
    title: "Хобби",
    children: ["Косплей", "Игрушки", "Аксессуары"],
  },
];

const isCorruptTitle = (title?: string) => {
  if (!title) {
    return true;
  }
  return title.includes("?") || title.includes("\uFFFD");
};

const getParentId = (doc: any) => {
  if (!doc?.parent) {
    return null;
  }
  if (typeof doc.parent === "string") {
    return doc.parent;
  }
  if (typeof doc.parent === "object" && doc.parent?.id) {
    return String(doc.parent.id);
  }
  return null;
};

const ensureBaseCategories = async (payload: any) => {
  try {
    const existing = await payload.find({
      collection: "categories",
      depth: 0,
      limit: 200,
      overrideAccess: true,
    });
    const existingDocs = existing?.docs ?? [];
    const existingByTitle = new Map<string, any>();
    existingDocs.forEach((doc: any) => {
      if (doc?.title) {
        existingByTitle.set(doc.title, doc);
      }
    });

    const parentDocs = existingDocs.filter((doc: any) => !getParentId(doc));
    const parentByTitle = new Map<string, any>();
    parentDocs.forEach((doc: any) => {
      if (doc?.title) {
        parentByTitle.set(doc.title, doc);
      }
    });

    const missingParents = baseCategories
      .map((category) => category.title)
      .filter((title) => !parentByTitle.has(title));
    const corruptParents = parentDocs.filter((doc: any) => isCorruptTitle(doc?.title));

    for (const title of missingParents) {
      const corruptParent = corruptParents.shift();
      if (corruptParent?.id) {
        const updated = await payload.update({
          collection: "categories",
          id: corruptParent.id,
          data: { title },
          overrideAccess: true,
        });
        if (corruptParent.title) {
          existingByTitle.delete(corruptParent.title);
        }
        existingByTitle.set(title, updated);
        parentByTitle.set(title, updated);
      } else {
        const created = await payload.create({
          collection: "categories",
          data: { title },
          overrideAccess: true,
        });
        existingByTitle.set(title, created);
        parentByTitle.set(title, created);
      }
    }

    const childrenByParentId = new Map<string, any[]>();
    existingDocs.forEach((doc: any) => {
      const parentId = getParentId(doc);
      if (!parentId) {
        return;
      }
      const list = childrenByParentId.get(parentId) ?? [];
      list.push(doc);
      childrenByParentId.set(parentId, list);
    });

    for (const category of baseCategories) {
      let parentDoc = parentByTitle.get(category.title) ?? existingByTitle.get(category.title);
      if (!parentDoc) {
        parentDoc = await payload.create({
          collection: "categories",
          data: { title: category.title },
          overrideAccess: true,
        });
        existingByTitle.set(category.title, parentDoc);
        parentByTitle.set(category.title, parentDoc);
      }

      const parentId = String(parentDoc.id ?? "");
      const childDocs = childrenByParentId.get(parentId) ?? [];
      const childTitles = new Set<string>();
      childDocs.forEach((doc: any) => {
        if (doc?.title) {
          childTitles.add(doc.title);
        }
      });
      const corruptChildren = childDocs.filter((doc: any) => isCorruptTitle(doc?.title));

      for (const childTitle of category.children) {
        if (childTitles.has(childTitle)) {
          continue;
        }
        const corruptChild = corruptChildren.shift();
        if (corruptChild?.id) {
          const updatedChild = await payload.update({
            collection: "categories",
            id: corruptChild.id,
            data: { title: childTitle, parent: parentDoc?.id },
            overrideAccess: true,
          });
          if (corruptChild.title) {
            existingByTitle.delete(corruptChild.title);
          }
          existingByTitle.set(childTitle, updatedChild);
          childTitles.add(childTitle);
        } else {
          const childDoc = await payload.create({
            collection: "categories",
            data: {
              title: childTitle,
              parent: parentDoc?.id,
            },
            overrideAccess: true,
          });
          existingByTitle.set(childTitle, childDoc);
          childTitles.add(childTitle);
        }
      }
    }
  } catch (error) {
    payload.logger?.error({ err: error, msg: "Failed to seed base categories" });
  }
};

const ensurePrintServiceProduct = async (payload: any) => {
  try {
    const slug = "custom-print-service";
    const sku = "CUSTOM-PRINT";

    const existing = await payload.find({
      collection: "products",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        or: [
          {
            slug: {
              equals: slug,
            },
          },
          {
            sku: {
              equals: sku,
            },
          },
        ],
      },
    });

    if (existing?.docs?.length) {
      return;
    }

    await payload.create({
      collection: "products",
      overrideAccess: true,
      data: {
        name: "Печать на заказ",
        slug,
        sku,
        price: 0,
        technology: "SLA Resin",
        format: "Physical Print",
        isVerified: true,
        isFeatured: true,
      },
    });
  } catch (error) {
    payload.logger?.error({ err: error, msg: "Failed to seed print service product" });
  }
};

if (!payloadSecret) {
  throw new Error("PAYLOAD_SECRET is missing");
}
 
if (!databaseURL) {
  throw new Error("DATABASE_URL is missing");
}

if (!s3PublicAccessKeyId || !s3PublicSecretAccessKey || !s3PublicBucket || !s3PublicEndpoint) {
  console.warn("[WARN] S3 credentials missing. File uploads may fail.");
  console.warn("S3_PUBLIC_ACCESS_KEY_ID:", s3PublicAccessKeyId ? "OK" : "MISSING");
  console.warn("S3_PUBLIC_SECRET_ACCESS_KEY:", s3PublicSecretAccessKey ? "OK" : "MISSING");
  console.warn("S3_PUBLIC_BUCKET:", s3PublicBucket ? "OK" : "MISSING");
  console.warn("S3_PUBLIC_ENDPOINT:", s3PublicEndpoint ? "OK" : "MISSING");
}

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(process.cwd(), "src"),
    },
  },
  cors: allowedOrigins,
  csrf: allowedOrigins,
  upload: {
    limits: {
      fileSize: 200 * 1024 * 1024, // 200MB
    },
  },
  collections: [Users, Categories, Media, Products, Orders, AiJobs, AiAssets],
  onInit: async (payload) => {
    try {
      await ensureAiLabSchema(payload as any);
    } catch (error) {
      payload.logger?.error({ err: error, msg: "Failed to ensure AI schema" });
    }

    if (!enableBootstrapSeed) {
      payload.logger?.info("Bootstrap seed is disabled (PAYLOAD_ENABLE_BOOTSTRAP_SEED=false)");
      return;
    }
    await ensureBaseCategories(payload);
    await ensurePrintServiceProduct(payload);
  },
  db: postgresAdapter({
    push: enableSchemaPush,
    migrationDir: path.resolve(process.cwd(), "src/migrations"),
    pool: {
      connectionString: databaseURL,
      connectionTimeoutMillis: 20000,
      idleTimeoutMillis: 10000,
      max: 5,
      ssl: {
        rejectUnauthorized: false,
      },
    },
  }),
  editor: lexicalEditor({}),
  plugins: [
    s3Storage({
      bucket: s3PublicBucket || "",
      config: {
        credentials: {
          accessKeyId: s3PublicAccessKeyId || "",
          secretAccessKey: s3PublicSecretAccessKey || "",
        },
        endpoint: s3PublicEndpoint,
        region: s3PublicRegion,
        forcePathStyle: true,
      },
      collections: {
        media: {
          prefix: "media",
          generateFileURL: ({ filename, prefix }) => {
            return `${s3PublicEndpoint}/${s3PublicBucket}/${prefix ? prefix + "/" : ""}${filename}`;
          },
        },
      },
    }),
  ],
  secret: payloadSecret,
  serverURL,
  typescript: {
    outputFile: path.resolve(process.cwd(), "payload-types.ts"),
  },
});
