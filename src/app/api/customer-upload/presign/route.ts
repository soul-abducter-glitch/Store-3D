import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 900;

const sanitizeFilename = (filename: string) =>
  filename
    .replace(/[/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);

const getS3Client = () => {
  const endpoint = process.env.S3_ENDPOINT || "";
  const region = process.env.S3_REGION || "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || "";

  return new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
};

const buildPublicUrl = (bucket: string, key: string) => {
  const endpoint = (process.env.S3_ENDPOINT || "").replace(/\/$/, "");
  return `${endpoint}/${bucket}/${key}`;
};

export async function POST(request: NextRequest) {
  const requestId = randomBytes(3).toString("hex");
  try {
    const method = request.method || "POST";
    if (method !== "POST") {
      console.warn("[customer-upload:presign] invalid method", { requestId, method });
      return NextResponse.json(
        { success: false, error: "Method not allowed." },
        { status: 405 }
      );
    }

    const contentType = request.headers.get("content-type") || "unknown";
    const contentLength = request.headers.get("content-length") || "unknown";
    const rawBody = await request.text();
    console.log("[customer-upload:presign] request body", {
      requestId,
      contentType,
      contentLength,
      length: rawBody.length,
    });

    if (!rawBody) {
      return NextResponse.json(
        { success: false, error: "Empty request body." },
        { status: 400 }
      );
    }

    let payload: any = null;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      console.error("[customer-upload:presign] invalid JSON", {
        requestId,
        error,
        bodyPreview: rawBody.slice(0, 200),
      });
      return NextResponse.json(
        { success: false, error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const filename = typeof payload?.filename === "string" ? payload.filename : "";
    const size = typeof payload?.size === "number" ? payload.size : 0;
    const contentTypeValue =
      typeof payload?.contentType === "string" && payload.contentType
        ? payload.contentType
        : "application/octet-stream";

    if (!filename || size <= 0) {
      return NextResponse.json(
        { success: false, error: "Missing filename or size." },
        { status: 400 }
      );
    }
    if (size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { success: false, error: "File exceeds 100MB limit." },
        { status: 400 }
      );
    }

    const bucket = process.env.S3_BUCKET || "";
    if (!bucket) {
      return NextResponse.json(
        { success: false, error: "S3 bucket is not configured." },
        { status: 500 }
      );
    }

    const safeFilename = sanitizeFilename(filename);
    const key = `media/customer-uploads/${Date.now()}-${requestId}-${safeFilename}`;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentTypeValue,
    });

    const s3 = getS3Client();
    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });

    const fileUrl = buildPublicUrl(bucket, key);

    console.log("[customer-upload:presign] ok", {
      requestId,
      filename,
      size,
      key,
    });

    return NextResponse.json(
      {
        success: true,
        uploadUrl,
        fileUrl,
        key,
        contentType: contentTypeValue,
        expiresIn: SIGNED_URL_TTL_SECONDS,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[customer-upload:presign] error", { requestId, error });
    return NextResponse.json(
      { success: false, error: "Failed to generate upload URL." },
      { status: 500 }
    );
  }
}
