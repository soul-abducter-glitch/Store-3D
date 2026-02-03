import fs from "fs";
import path from "path";

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

type S3Config = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

const loadEnvFile = (filename: string) => {
  const envPath = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(envPath)) return;
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

const parseCsv = (value?: string) =>
  (value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const getConfig = (prefix: "SOURCE" | "DESTINATION"): S3Config => {
  const endpoint = process.env[`${prefix}_S3_ENDPOINT`] || "";
  const bucket = process.env[`${prefix}_S3_BUCKET`] || "";
  const accessKeyId = process.env[`${prefix}_S3_ACCESS_KEY_ID`] || "";
  const secretAccessKey = process.env[`${prefix}_S3_SECRET_ACCESS_KEY`] || "";
  const region = process.env[`${prefix}_S3_REGION`] || "us-east-1";

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(`${prefix}_S3_* is not fully configured in env`);
  }

  return { endpoint, bucket, accessKeyId, secretAccessKey, region };
};

const makeClient = (config: S3Config) =>
  new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

const listKeys = async (
  client: S3Client,
  bucket: string,
  prefix?: string
) => {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    const contents = result.Contents || [];
    for (const item of contents) {
      if (!item.Key) continue;
      if (item.Key.endsWith("/")) continue;
      keys.push(item.Key);
    }
    token = result.NextContinuationToken;
  } while (token);
  return keys;
};

const readKeysFile = (filePath?: string) => {
  if (!filePath) return null;
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Keys file not found: ${resolved}`);
  }
  const lines = fs.readFileSync(resolved, "utf8").split(/\r?\n/);
  const keys = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  return new Set(keys);
};

const shouldCopyKey = (
  key: string,
  prefixFilters: string[],
  allowedKeys?: Set<string> | null
) => {
  if (allowedKeys && !allowedKeys.has(key)) {
    return false;
  }
  if (prefixFilters.length === 0) {
    return true;
  }
  return prefixFilters.some((prefix) => key.startsWith(prefix));
};

const run = async () => {
  loadEnvFile(".env.migrate");
  loadEnvFile(".env.local");

  const source = getConfig("SOURCE");
  const destination = getConfig("DESTINATION");

  const sourceClient = makeClient(source);
  const destinationClient = makeClient(destination);

  const prefixFilters = parseCsv(process.env.SOURCE_PREFIXES);
  const allowedKeys = readKeysFile(process.env.SOURCE_KEYS_FILE);
  const maxKeys = Number(process.env.MAX_KEYS || "0");
  const forceCopy = process.env.FORCE_COPY === "1";
  const dryRun = process.env.DRY_RUN === "1";
  const publicRead = process.env.DESTINATION_PUBLIC_READ === "1";

  const prefixList = prefixFilters.length > 0 ? prefixFilters : [undefined];
  const keySet = new Set<string>();

  for (const prefix of prefixList) {
    const keys = await listKeys(sourceClient, source.bucket, prefix);
    keys.forEach((key) => keySet.add(key));
  }

  const allKeys = Array.from(keySet).filter((key) =>
    shouldCopyKey(key, prefixFilters, allowedKeys)
  );

  console.log(`Found ${allKeys.length} objects to copy.`);

  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (const key of allKeys) {
    if (maxKeys > 0 && copied + skipped + failed >= maxKeys) {
      break;
    }

    let sourceHead: any;
    try {
      sourceHead = await sourceClient.send(
        new HeadObjectCommand({ Bucket: source.bucket, Key: key })
      );
    } catch (error) {
      console.warn(`[WARN] Missing source object: ${key}`);
      failed += 1;
      continue;
    }

    if (!forceCopy) {
      try {
        const destHead = await destinationClient.send(
          new HeadObjectCommand({ Bucket: destination.bucket, Key: key })
        );
        if (
          destHead?.ContentLength &&
          sourceHead?.ContentLength &&
          destHead.ContentLength === sourceHead.ContentLength
        ) {
          console.log(`[SKIP] ${key}`);
          skipped += 1;
          continue;
        }
      } catch (error: any) {
        const status = error?.$metadata?.httpStatusCode;
        if (status && status !== 404) {
          throw error;
        }
      }
    }

    if (dryRun) {
      console.log(`[DRY] ${key}`);
      skipped += 1;
      continue;
    }

    const getObject = await sourceClient.send(
      new GetObjectCommand({ Bucket: source.bucket, Key: key })
    );

    const params: PutObjectCommandInput = {
      Bucket: destination.bucket,
      Key: key,
      Body: getObject.Body as any,
      ContentType:
        sourceHead?.ContentType ||
        getObject.ContentType ||
        "application/octet-stream",
      CacheControl: sourceHead?.CacheControl,
      ContentDisposition: sourceHead?.ContentDisposition,
      ContentEncoding: sourceHead?.ContentEncoding,
      Metadata: sourceHead?.Metadata,
    };

    if (publicRead) {
      params.ACL = "public-read";
    }

    const uploader = new Upload({ client: destinationClient, params });
    await uploader.done();
    console.log(`[OK] ${key}`);
    copied += 1;
  }

  console.log(
    `Done. Copied: ${copied}, skipped: ${skipped}, failed: ${failed}.`
  );
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
