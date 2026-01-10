import path from "path";

import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { buildConfig } from "payload";
import { s3Storage } from "@payloadcms/storage-s3";

import { Categories } from "./src/payload/collections/Categories";
import { Media } from "./src/payload/collections/Media";
import { Orders } from "./src/payload/collections/Orders";
import { Products } from "./src/payload/collections/Products";
import { Users } from "./src/payload/collections/Users";

const serverURL = (process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000").trim();
const payloadSecret = process.env.PAYLOAD_SECRET;
const databaseURL = process.env.DATABASE_URL;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const s3Bucket = process.env.S3_BUCKET;
const s3Endpoint = process.env.S3_ENDPOINT;
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

if (!payloadSecret) {
  throw new Error("PAYLOAD_SECRET is missing");
}
 
if (!databaseURL) {
  throw new Error("DATABASE_URL is missing");
}

if (!s3AccessKeyId || !s3SecretAccessKey || !s3Bucket || !s3Endpoint) {
  console.warn("[WARN] S3 credentials missing. File uploads may fail.");
  console.warn("S3_ACCESS_KEY_ID:", s3AccessKeyId ? "OK" : "MISSING");
  console.warn("S3_SECRET_ACCESS_KEY:", s3SecretAccessKey ? "OK" : "MISSING");
  console.warn("S3_BUCKET:", s3Bucket ? "OK" : "MISSING");
  console.warn("S3_ENDPOINT:", s3Endpoint ? "OK" : "MISSING");
}

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(process.cwd(), "src"),
    },
    components: {
      elements: {
        CodeEditor: "./components/PatchedCodeEditor",
      },
    },
  },
  cors: [
    "http://localhost:3000",
    "http://localhost:3001",
  ],
  csrf: [
    "http://localhost:3000",
    "http://localhost:3001",
  ],
  upload: {
    limits: {
      fileSize: 200 * 1024 * 1024, // 200MB
    },
  },
  collections: [Users, Categories, Media, Products, Orders],
  onInit: async (payload) => {
    await ensureBaseCategories(payload);
  },
  db: postgresAdapter({
    pool: {
      connectionString: databaseURL,
      connectionTimeoutMillis: 20000,
      idleTimeoutMillis: 10000,
      max: 5,
      ssl: {
        rejectUnauthorized: false,
      },
    },
    // Skip migrations to avoid enum conflicts
    migrate: false,
  }),
  editor: lexicalEditor({}),
  plugins: [
    s3Storage({
      bucket: s3Bucket || "",
      config: {
        credentials: {
          accessKeyId: s3AccessKeyId || "",
          secretAccessKey: s3SecretAccessKey || "",
        },
        endpoint: s3Endpoint,
        region: process.env.S3_REGION || "us-east-1",
        forcePathStyle: true,
      },
      collections: {
        media: {
          prefix: "media",
          generateFileURL: ({ filename, prefix }) => {
            return `${s3Endpoint}/${s3Bucket}/${prefix ? prefix + "/" : ""}${filename}`;
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
