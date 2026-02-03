import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";
import { Readable } from "stream";

const publicBucket = process.env.S3_PUBLIC_BUCKET || process.env.S3_BUCKET;
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT;
const publicAccessKeyId =
  process.env.S3_PUBLIC_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
const publicSecretAccessKey =
  process.env.S3_PUBLIC_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
const publicRegion = process.env.S3_PUBLIC_REGION || process.env.S3_REGION || "us-east-1";

const uploadBucket = process.env.S3_UPLOAD_BUCKET || process.env.S3_BUCKET;
const uploadEndpoint = process.env.S3_UPLOAD_ENDPOINT || process.env.S3_ENDPOINT;
const uploadAccessKeyId =
  process.env.S3_UPLOAD_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
const uploadSecretAccessKey =
  process.env.S3_UPLOAD_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
const uploadRegion = process.env.S3_UPLOAD_REGION || process.env.S3_REGION || "us-east-1";
const prefix = "media";
const publicBase = publicEndpoint ? publicEndpoint.replace(/\/$/, "") : "";
const uploadBase = uploadEndpoint ? uploadEndpoint.replace(/\/$/, "") : "";

const publicClient =
  publicBucket && publicEndpoint && publicAccessKeyId && publicSecretAccessKey
    ? new S3Client({
        region: publicRegion,
        endpoint: publicEndpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: publicAccessKeyId, secretAccessKey: publicSecretAccessKey },
      })
    : null;

const uploadClient =
  uploadBucket && uploadEndpoint && uploadAccessKeyId && uploadSecretAccessKey
    ? new S3Client({
        region: uploadRegion,
        endpoint: uploadEndpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: uploadAccessKeyId, secretAccessKey: uploadSecretAccessKey },
      })
    : null;

const guessContentType = (filename: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".stl")) return "model/stl";
  return "application/octet-stream";
};

const toWebStream = (body: any) => {
  if (!body) return null;
  if (body instanceof Readable) {
    return Readable.toWeb(body);
  }
  return body;
};

export const runtime = "nodejs";

const buildPublicUrl = (base: string, bucketName: string | undefined, key: string) => {
  if (!base || !bucketName) {
    return null;
  }
  return `${base}/${bucketName}/${key}`;
};

const fetchPublicObject = async (
  base: string,
  bucketName: string | undefined,
  key: string,
  filename: string
) => {
  const url = buildPublicUrl(base, bucketName, key);
  if (!url) {
    return null;
  }
  const response = await fetch(url);
  if (!response.ok) {
    return new Response("Failed to load file", { status: response.status });
  }
  const headers = new Headers();
  headers.set("Content-Type", response.headers.get("content-type") || guessContentType(filename));
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(response.body, { headers });
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const resolvedParams = await params;
  const rawName = resolvedParams?.filename ? decodeURIComponent(resolvedParams.filename) : "";
  const cleanName = rawName.replace(/\\/g, "/").replace(/^\/+/, "");
  const safeName = cleanName.split("/").pop() || "";
  if (!safeName) {
    return new Response("Missing filename", { status: 400 });
  }

  const key = cleanName.startsWith(`${prefix}/`) ? cleanName : prefix ? `${prefix}/${cleanName}` : cleanName;
  const useUploadBucket = key.includes("customer-uploads/");
  const client = useUploadBucket ? uploadClient ?? publicClient : publicClient;
  const bucket = useUploadBucket ? uploadBucket ?? publicBucket : publicBucket;
  const base = useUploadBucket ? uploadBase || publicBase : publicBase;

  if (!client || !bucket) {
    const fallback = await fetchPublicObject(base, bucket, key, safeName);
    if (fallback) {
      return fallback;
    }
    return new Response("S3 is not configured", { status: 500 });
  }

  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    if (!result.Body) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers();
    headers.set("Content-Type", result.ContentType || guessContentType(safeName));
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    const body = toWebStream(result.Body);
    return new Response(body, { headers });
  } catch (error: any) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      return new Response("Not found", { status: 404 });
    }
    const fallback = await fetchPublicObject(base, bucket, key, safeName);
    if (fallback) {
      return fallback;
    }
    console.error("S3 proxy error", error);
    return new Response("Failed to load file", { status: 500 });
  }
}
