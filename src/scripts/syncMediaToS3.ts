import fs from "fs";
import path from "path";

import { postgresAdapter } from "@payloadcms/db-postgres";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { buildConfig, getPayload } from "payload";

import { Categories } from "../payload/collections/Categories";
import { Media } from "../payload/collections/Media";
import { Products } from "../payload/collections/Products";
import { Users } from "../payload/collections/Users";

type MediaDoc = {
  id?: string | number;
  filename?: string;
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

const guessContentType = (filename: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".stl")) return "model/stl";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
};

const stripDuplicateSuffix = (filename: string) => {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const match = base.match(/^(.*)-\d+$/);
  if (!match) return null;
  return `${match[1]}${ext}`;
};

const walkFiles = (dir: string) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

const buildLocalPayloadConfig = async () => {
  const payloadSecret = process.env.PAYLOAD_SECRET;
  const databaseURL = process.env.DATABASE_URL;
  const { lexicalEditor } = await import("@payloadcms/richtext-lexical");

  if (!payloadSecret) {
    throw new Error("PAYLOAD_SECRET is missing");
  }
  if (!databaseURL) {
    throw new Error("DATABASE_URL is missing");
  }

  const richTextEditor = lexicalEditor({});

  return buildConfig({
    admin: {
      user: Users.slug,
      importMap: {
        baseDir: path.resolve(process.cwd(), "src"),
      },
    },
    collections: [Users, Categories, Media, Products],
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
    secret: payloadSecret,
    serverURL: (process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000").trim(),
    typescript: {
      outputFile: path.resolve(process.cwd(), "payload-types.ts"),
    },
  });
};

const main = async () => {
  loadEnv();

  const bucket = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const region = process.env.S3_REGION || "us-east-1";
  const prefix = (process.env.S3_PREFIX || "media").replace(/\/$/, "");
  const mediaDir = process.env.LOCAL_MEDIA_DIR
    ? path.resolve(process.cwd(), process.env.LOCAL_MEDIA_DIR)
    : path.resolve(process.cwd(), "media");
  const forceUpload = process.env.FORCE_UPLOAD === "1";
  const dryRun = process.env.DRY_RUN === "1";
  const publicRead = process.env.PUBLIC_READ === "1";

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 credentials are missing in .env.local");
  }
  if (!fs.existsSync(mediaDir)) {
    throw new Error(`Media folder not found: ${mediaDir}`);
  }

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  const payloadConfig = await buildLocalPayloadConfig();
  const payload = await getPayload({ config: payloadConfig });

  const files = walkFiles(mediaDir);
  const fileByName = new Map<string, string>();
  files.forEach((filePath) => {
    const filename = path.basename(filePath);
    const key = filename.toLowerCase();
    if (!fileByName.has(key)) {
      fileByName.set(key, filePath);
    }
  });

  const allMedia: MediaDoc[] = [];
  let page = 1;
  while (true) {
    const result = await payload.find({
      collection: "media",
      depth: 0,
      limit: 200,
      page,
      overrideAccess: true,
    });
    allMedia.push(...((result?.docs ?? []) as MediaDoc[]));
    if (!result?.hasNextPage) {
      break;
    }
    page += 1;
  }

  let uploaded = 0;
  let skipped = 0;
  let missing = 0;

  for (const doc of allMedia) {
    const filename = doc.filename;
    if (!filename) {
      continue;
    }

    let localPath = fileByName.get(filename.toLowerCase()) ?? null;
    if (!localPath) {
      const fallbackName = stripDuplicateSuffix(filename);
      if (fallbackName) {
        localPath = fileByName.get(fallbackName.toLowerCase()) ?? null;
        if (localPath) {
          console.log(`[INFO] Matched ${filename} -> ${path.basename(localPath)}`);
        }
      }
    }

    if (!localPath) {
      console.warn(`[WARN] Missing local file for ${filename}`);
      missing += 1;
      continue;
    }

    const key = prefix ? `${prefix}/${filename}` : filename;
    let exists = false;

    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      exists = true;
    } catch (error: any) {
      const status = error?.$metadata?.httpStatusCode;
      if (status && status !== 404) {
        throw error;
      }
    }

    if (exists && !forceUpload) {
      console.log(`[SKIP] ${filename} already in S3`);
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`[DRY] Upload ${filename} -> ${key}`);
      continue;
    }

    const params: Record<string, any> = {
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(localPath),
      ContentType: guessContentType(filename),
    };
    if (publicRead) {
      params.ACL = "public-read";
    }

    const uploader = new Upload({ client, params });
    await uploader.done();
    console.log(`[OK] Uploaded ${filename}`);
    uploaded += 1;
  }

  if (typeof (payload as any).destroy === "function") {
    await (payload as any).destroy();
  } else if (typeof payload.db?.destroy === "function") {
    await payload.db.destroy();
  }

  console.log(
    `[DONE] Uploaded: ${uploaded}, skipped: ${skipped}, missing local: ${missing}`
  );
  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
