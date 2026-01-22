import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";
import { Readable } from "stream";

const bucket = process.env.S3_BUCKET;
const endpoint = process.env.S3_ENDPOINT;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const region = process.env.S3_REGION || "us-east-1";
const prefix = "media";

const client =
  bucket && endpoint && accessKeyId && secretAccessKey
    ? new S3Client({
        region,
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
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

export async function GET(
  _request: NextRequest,
  { params }: { params: { filename: string } }
) {
  if (!client || !bucket) {
    return new Response("S3 is not configured", { status: 500 });
  }

  const rawName = params?.filename ? decodeURIComponent(params.filename) : "";
  const safeName = rawName.replace(/\\/g, "/").split("/").pop() || "";
  if (!safeName) {
    return new Response("Missing filename", { status: 400 });
  }

  const key = prefix ? `${prefix}/${safeName}` : safeName;

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
    console.error("S3 proxy error", error);
    return new Response("Failed to load file", { status: 500 });
  }
}
