import fs from "fs";
import path from "path";

import { postgresAdapter } from "@payloadcms/db-postgres";
import type { Payload } from "payload";
import { buildConfig, getPayload } from "payload";

import { Categories } from "../payload/collections/Categories.ts";
import { Media } from "../payload/collections/Media.ts";
import { Products } from "../payload/collections/Products.ts";
import { Users } from "../payload/collections/Users.ts";

type ProductSeed = {
  name: string;
  fileName: string;
  price: number;
  category: string;
  technology: string;
  format: string;
  polyCount: number;
  printTime: string;
  scale: string;
  description: string;
};

type LexicalRichText = {
  root: {
    children: Array<{
      children: Array<{
        detail: number;
        format: number;
        mode: "normal";
        style: string;
        text: string;
        type: "text";
        version: number;
      }>;
      direction: "ltr";
      format: string;
      indent: number;
      type: "paragraph";
      version: number;
    }>;
    direction: "ltr";
    format: string;
    indent: number;
    type: "root";
    version: number;
  };
};

const loadEnv = () => {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

const toSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const lexicalFromText = (text: string): LexicalRichText => ({
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text,
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
    ],
    direction: "ltr",
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  },
});

const ensureCategory = async (payload: Payload, title: string) => {
  const existing = await payload.find({
    collection: "categories",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { title: { equals: title } },
  });
  if (existing?.docs?.[0]?.id) {
    return existing.docs[0].id;
  }
  const created = await payload.create({
    collection: "categories",
    data: { title },
    overrideAccess: true,
  });
  return created.id;
};

const findMedia = async (payload: Payload, filename: string) => {
  const select = { id: true, filename: true } as const;
  const exact = await payload.find({
    collection: "media",
    depth: 0,
    limit: 1,
    select,
    overrideAccess: true,
    where: { filename: { equals: filename } },
  });
  if (exact?.docs?.[0]) {
    return { doc: exact.docs[0], matchedBy: "exact" as const };
  }

  const ext = path.extname(filename);
  const base = filename.slice(0, -ext.length);
  const likePattern = `${base}-%${ext}`;
  const similar = await payload.find({
    collection: "media",
    depth: 0,
    limit: 1,
    select,
    overrideAccess: true,
    where: { filename: { like: likePattern } },
  });
  if (similar?.docs?.[0]) {
    return { doc: similar.docs[0], matchedBy: "suffix" as const };
  }

  return { doc: null, matchedBy: "none" as const };
};

const buildLocalPayloadConfig = async () => {
  const serverURL = (process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000").trim();
  const payloadSecret = process.env.PAYLOAD_SECRET;
  const databaseURL = process.env.DATABASE_URL;
  const { lexicalEditor } = await import("@payloadcms/richtext-lexical");

  if (!payloadSecret) {
    throw new Error("PAYLOAD_SECRET отсутствует");
  }
  if (!databaseURL) {
    throw new Error("DATABASE_URL отсутствует");
  }

  const richTextEditor = lexicalEditor({});
  const productsWithEditor = {
    ...Products,
    fields: Products.fields.map((field) => {
      if ((field as any)?.name === "description") {
        return { ...(field as any), editor: richTextEditor };
      }
      return field;
    }),
  };

  return buildConfig({
    admin: {
      user: Users.slug,
      importMap: {
        baseDir: path.resolve(process.cwd(), "src"),
      },
    },
    cors: ["http://localhost:3000", "http://localhost:3001"],
    csrf: ["http://localhost:3000", "http://localhost:3001"],
    upload: {
      limits: {
        fileSize: 200 * 1024 * 1024,
      },
    },
    collections: [Users, Categories, Media, productsWithEditor],
    db: postgresAdapter({
      pool: {
        connectionString: databaseURL,
        connectionTimeoutMillis: 20000,
        idleTimeoutMillis: 10000,
        max: 5,
        ssl: { rejectUnauthorized: false },
      },
      push: false,
    }),
    editor: richTextEditor,
    plugins: [],
    secret: payloadSecret,
    serverURL,
    typescript: {
      outputFile: path.resolve(process.cwd(), "payload-types.ts"),
    },
  });
};

const seed = async () => {
  loadEnv();

  const jsonPath =
    process.env.PRODUCTS_JSON && process.env.PRODUCTS_JSON.trim().length > 0
      ? path.resolve(process.cwd(), process.env.PRODUCTS_JSON)
      : path.resolve(process.cwd(), "products.json");

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Не найден файл JSON: ${jsonPath}`);
  }

  const raw = fs.readFileSync(jsonPath, "utf8");
  const items = JSON.parse(raw) as ProductSeed[];

  const payloadConfig = await buildLocalPayloadConfig();
  const payload = await getPayload({ config: payloadConfig });

  for (const item of items) {
    const mediaResult = await findMedia(payload, item.fileName);
    if (!mediaResult.doc?.id) {
      console.warn(`[WARN] Пропускаю "${item.name}": файл ${item.fileName} не найден в media`);
      continue;
    }
    if (mediaResult.matchedBy === "suffix") {
      console.log(
        `[INFO] Найден файл для "${item.name}": ${mediaResult.doc.filename} (по шаблону ${item.fileName})`
      );
    }

    const categoryId = await ensureCategory(payload, item.category);
    const slug = toSlug(item.name);

    const existing = await payload.find({
      collection: "products",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { slug: { equals: slug } },
    });
    if (existing?.docs?.length) {
      console.log(`Пропускаю "${item.name}": продукт со slug "${slug}" уже существует`);
      continue;
    }

    const description = lexicalFromText(item.description);
    const sku = `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;

    const product = await payload.create({
      collection: "products",
      data: {
        name: item.name,
        slug,
        sku,
        price: item.price,
        description,
        technology: item.technology,
        format: item.format,
        categories: [categoryId],
        polyCount: item.polyCount,
        printTime: item.printTime,
        scale: item.scale,
        rawModel: mediaResult.doc.id,
        isVerified: true,
      },
      overrideAccess: true,
    });

    console.log(`Создан продукт "${product.name}" (rawModel=${mediaResult.doc.id})`);
  }

  if (typeof (payload as any).destroy === "function") {
    await (payload as any).destroy();
  } else if (typeof payload.db?.destroy === "function") {
    await payload.db.destroy();
  }
  process.exit(0);
};

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
