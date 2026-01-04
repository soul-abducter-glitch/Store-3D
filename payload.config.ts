import path from "path";

import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { s3Storage } from "@payloadcms/storage-s3";
import { buildConfig } from "payload";

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

if (!payloadSecret) {
  throw new Error("PAYLOAD_SECRET is missing");
}

if (!databaseURL) {
  throw new Error("DATABASE_URL is missing");
}

if (!s3AccessKeyId || !s3SecretAccessKey || !s3Bucket || !s3Endpoint) {
  console.warn("⚠️ S3 credentials missing. File uploads may fail.");
  console.warn("S3_ACCESS_KEY_ID:", s3AccessKeyId ? "✓" : "✗");
  console.warn("S3_SECRET_ACCESS_KEY:", s3SecretAccessKey ? "✓" : "✗");
  console.warn("S3_BUCKET:", s3Bucket ? "✓" : "✗");
  console.warn("S3_ENDPOINT:", s3Endpoint ? "✓" : "✗");
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
  upload: {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB
    },
  },
  collections: [Users, Categories, Media, Products, Orders],
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
