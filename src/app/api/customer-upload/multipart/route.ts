import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const PART_SIZE_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 900;

const ALLOWED_EXTENSIONS = new Set([".stl", ".obj", ".glb", ".gltf"]);
const EXTENSION_CONTENT_TYPE: Record<string, string> = {
  ".stl": "model/stl",
  ".obj": "model/obj",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};
const EXTENSION_ALLOWED_CONTENT_TYPES: Record<string, string[]> = {
  ".stl": [
    "model/stl",
    "application/sla",
    "application/vnd.ms-pki.stl",
    "application/octet-stream",
  ],
  ".obj": ["model/obj", "text/plain", "application/octet-stream"],
  ".glb": ["model/gltf-binary", "application/octet-stream"],
  ".gltf": ["model/gltf+json", "application/gltf+json", "application/octet-stream"],
};

const sanitizeFilename = (filename: string) =>
  filename
    .replace(/[/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);

const getExtension = (filename: string) => {
  const lower = filename.toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === lower.length - 1) {
    return "";
  }
  return lower.slice(dotIndex);
};

const normalizeContentType = (value: string) => value.split(";")[0].trim().toLowerCase();

const isAllowedContentType = (extension: string, value: string) => {
  const allowed = EXTENSION_ALLOWED_CONTENT_TYPES[extension];
  if (!allowed) return false;
  return allowed.includes(value);
};

const getUploadConfig = () => {
  const endpoint = (process.env.S3_UPLOAD_ENDPOINT || process.env.S3_ENDPOINT || "").replace(
    /\/$/,
    ""
  );
  const region = process.env.S3_UPLOAD_REGION || process.env.S3_REGION || "us-east-1";
  const accessKeyId =
    process.env.S3_UPLOAD_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || "";
  const secretAccessKey =
    process.env.S3_UPLOAD_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || "";
  const bucket = process.env.S3_UPLOAD_BUCKET || process.env.S3_BUCKET || "";
  return { endpoint, region, accessKeyId, secretAccessKey, bucket };
};

const getS3Client = () => {
  const { endpoint, region, accessKeyId, secretAccessKey } = getUploadConfig();
  return new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
};

const buildPublicUrl = (bucket: string, key: string) => {
  const endpoint = getUploadConfig().endpoint;
  return `${endpoint}/${bucket}/${key}`;
};

const parseJson = async (request: NextRequest) => {
  const rawBody = await request.text();
  if (!rawBody) {
    return { error: "Empty request body." };
  }
  try {
    return { data: JSON.parse(rawBody) };
  } catch {
    return { error: "Invalid JSON body." };
  }
};

export async function POST(request: NextRequest) {
  const requestId = randomBytes(3).toString("hex");
  try {
    const { data, error } = await parseJson(request);
    if (error) {
      return NextResponse.json({ success: false, error }, { status: 400 });
    }

    const action = data?.action;
    if (!action) {
      return NextResponse.json(
        { success: false, error: "Missing action." },
        { status: 400 }
      );
    }

    const bucket = getUploadConfig().bucket;
    if (!bucket) {
      return NextResponse.json(
        { success: false, error: "S3 bucket is not configured." },
        { status: 500 }
      );
    }

    const s3 = getS3Client();

    if (action === "start") {
      const filename = typeof data?.filename === "string" ? data.filename : "";
      const size = typeof data?.size === "number" ? data.size : 0;
      const providedContentType =
        typeof data?.contentType === "string" && data.contentType
          ? normalizeContentType(data.contentType)
          : "";

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

      const safeFilename = sanitizeFilename(filename);
      const extension = getExtension(safeFilename);
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        return NextResponse.json(
          { success: false, error: "Unsupported file type." },
          { status: 400 }
        );
      }
      if (providedContentType && !isAllowedContentType(extension, providedContentType)) {
        return NextResponse.json(
          { success: false, error: "Unsupported content type." },
          { status: 400 }
        );
      }

      const key = `media/customer-uploads/${Date.now()}-${requestId}-${safeFilename}`;
      const contentTypeValue = EXTENSION_CONTENT_TYPE[extension] || "application/octet-stream";
      const createCommand = new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentTypeValue,
      });
      const createResult = await s3.send(createCommand);

      if (!createResult.UploadId) {
        return NextResponse.json(
          { success: false, error: "Failed to start multipart upload." },
          { status: 500 }
        );
      }

      const partCount = Math.max(1, Math.ceil(size / PART_SIZE_BYTES));
      return NextResponse.json(
        {
          success: true,
          uploadId: createResult.UploadId,
          key,
          partSize: PART_SIZE_BYTES,
          partCount,
          fileUrl: buildPublicUrl(bucket, key),
          contentType: contentTypeValue,
        },
        { status: 200 }
      );
    }

    if (action === "part") {
      const uploadId = typeof data?.uploadId === "string" ? data.uploadId : "";
      const key = typeof data?.key === "string" ? data.key : "";
      const partNumber = typeof data?.partNumber === "number" ? data.partNumber : 0;

      if (!uploadId || !key || partNumber <= 0) {
        return NextResponse.json(
          { success: false, error: "Missing uploadId, key, or partNumber." },
          { status: 400 }
        );
      }

      const command = new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      const uploadUrl = await getSignedUrl(s3, command, {
        expiresIn: SIGNED_URL_TTL_SECONDS,
      });

      return NextResponse.json(
        {
          success: true,
          uploadUrl,
          partNumber,
          expiresIn: SIGNED_URL_TTL_SECONDS,
        },
        { status: 200 }
      );
    }

    if (action === "complete") {
      const uploadId = typeof data?.uploadId === "string" ? data.uploadId : "";
      const key = typeof data?.key === "string" ? data.key : "";
      const parts = Array.isArray(data?.parts) ? data.parts : [];

      if (!uploadId || !key || parts.length === 0) {
        return NextResponse.json(
          { success: false, error: "Missing uploadId, key, or parts." },
          { status: 400 }
        );
      }

      const mappedParts = parts
        .map((part: any) => ({
          ETag: typeof part?.ETag === "string" ? part.ETag : undefined,
          PartNumber: typeof part?.PartNumber === "number" ? part.PartNumber : undefined,
        }))
        .filter(
          (part: { ETag?: string; PartNumber?: number }) =>
            part.ETag && part.PartNumber
        );

      if (mappedParts.length === 0) {
        return NextResponse.json(
          { success: false, error: "Parts missing ETag/PartNumber." },
          { status: 400 }
        );
      }

      const completeCommand = new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: mappedParts },
      });
      await s3.send(completeCommand);

      return NextResponse.json(
        { success: true, key, fileUrl: buildPublicUrl(bucket, key) },
        { status: 200 }
      );
    }

    if (action === "abort") {
      const uploadId = typeof data?.uploadId === "string" ? data.uploadId : "";
      const key = typeof data?.key === "string" ? data.key : "";
      if (!uploadId || !key) {
        return NextResponse.json(
          { success: false, error: "Missing uploadId or key." },
          { status: 400 }
        );
      }
      const abortCommand = new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
      });
      await s3.send(abortCommand);
      return NextResponse.json({ success: true }, { status: 200 });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action." },
      { status: 400 }
    );
  } catch (error) {
    console.error("[customer-upload:multipart] error", { requestId, error });
    return NextResponse.json(
      { success: false, error: "Failed to process multipart upload." },
      { status: 500 }
    );
  }
}
