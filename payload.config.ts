import path from "path";

import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { s3Storage } from "@payloadcms/storage-s3";
import { buildConfig } from "payload";

import { Categories } from "./src/payload/collections/Categories.ts";
import { Media } from "./src/payload/collections/Media.ts";
import { Products } from "./src/payload/collections/Products.ts";
import { Users } from "./src/payload/collections/Users.ts";

const serverURL = (process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000").trim();
const payloadSecret = process.env.PAYLOAD_SECRET;
const databaseURL = process.env.DATABASE_URL;
if (!payloadSecret) {
  throw new Error("PAYLOAD_SECRET is missing");
}

if (!databaseURL) {
  throw new Error("DATABASE_URL is missing");
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
  collections: [Users, Categories, Media, Products],
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
      bucket: process.env.S3_BUCKET || "",
      config: {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
        },
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION || "us-east-1",
        forcePathStyle: true,
      },
      collections: {
        media: {
          prefix: "media",
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
