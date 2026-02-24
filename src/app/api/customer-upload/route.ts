import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../payload.config";
import {
  attachCustomerUploadOwnerCookie,
  ensureCustomerUploadOwnerToken,
  hashCustomerUploadOwnerToken,
} from "@/lib/customerUploadOwnership";
import { checkRateLimit, resolveClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const resolveFileType = (filename: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".stl")) return "3d-model";
  if (lower.endsWith(".obj")) return "3d-model";
  if (lower.endsWith(".glb") || lower.endsWith(".gltf")) return "3d-model";
  return "other";
};

const resolveMimeType = (filename: string, fallback: string | undefined) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".stl")) return "model/stl";
  if (lower.endsWith(".obj")) return "model/obj";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  return fallback || "application/octet-stream";
};

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const CREATE_TIMEOUT_MS = 300_000;
const CUSTOMER_UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const CUSTOMER_UPLOAD_MAX_REQUESTS = 12;

const normalizeRelationshipId = (value: unknown): string | number | null => {
  let current: unknown = value;
  while (typeof current === "object" && current !== null) {
    current =
      (current as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (current as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (current as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
  }
  if (current === null || current === undefined) return null;
  if (typeof current === "number") return current;
  const raw = String(current).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
};

const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const extractErrorMessage = (error: unknown) => {
  if (!error) return "Failed to upload file.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || "Failed to upload file.";
  const message = (error as any)?.message;
  return typeof message === "string" && message ? message : "Failed to upload file.";
};

const extractErrorDetails = (error: unknown) => {
  if (!error || typeof error !== "object") return undefined;
  const anyError = error as any;
  return {
    name: anyError.name,
    code: anyError.code,
    message: anyError.message,
    label: anyError.label,
    stack: anyError.stack,
    hint: anyError.hint,
    detail: anyError.detail,
    where: anyError.where,
    schema: anyError.schema,
    table: anyError.table,
    column: anyError.column,
    constraint: anyError.constraint,
    position: anyError.position,
    routine: anyError.routine,
    severity: anyError.severity,
    file: anyError.file,
    line: anyError.line,
    query: anyError.query,
    internalQuery: anyError.internalQuery,
    internalPosition: anyError.internalPosition,
    data: anyError.data,
    errors: anyError.errors,
  };
};

const isRetryablePayloadError = (error: unknown) => {
  const message = extractErrorMessage(error).toLowerCase();
  const code = (error as any)?.code;
  return (
    code === "22P02" ||
    message.includes("enum") ||
    message.includes("column") ||
    message.includes("does not exist")
  );
};

const withTimeout = async <T>(
  promise: Promise<T>,
  label: string,
  startedAt?: number
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`Upload timed out after ${CREATE_TIMEOUT_MS}ms`);
      (error as any).code = "UPLOAD_TIMEOUT";
      (error as any).label = label;
      console.error("[customer-upload] create timeout", {
        label,
        timeoutMs: CREATE_TIMEOUT_MS,
        elapsedMs: startedAt ? Date.now() - startedAt : undefined,
      });
      reject(error);
    }, CREATE_TIMEOUT_MS);
  });

  try {
    return (await Promise.race([promise, timeoutPromise])) as T;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const toRetryAfterSec = (retryAfterMs: number) =>
  Math.max(1, Math.ceil(Math.max(0, retryAfterMs) / 1000));

export async function POST(request: NextRequest) {
  try {
    const requestStartedAt = Date.now();
    const requestId = Math.random().toString(36).slice(2, 8);
    console.log("[customer-upload] request start", { requestId });
    if (request.signal) {
      request.signal.addEventListener("abort", () => {
        console.warn("[customer-upload] request aborted by client", {
          requestId,
          ms: Date.now() - requestStartedAt,
        });
      });
    }
    const rate = checkRateLimit({
      scope: "customer-upload:direct",
      key: resolveClientIp(request.headers),
      max: CUSTOMER_UPLOAD_MAX_REQUESTS,
      windowMs: CUSTOMER_UPLOAD_WINDOW_MS,
    });
    if (!rate.ok) {
      const retryAfter = toRetryAfterSec(rate.retryAfterMs);
      return NextResponse.json(
        {
          success: false,
          error: "Too many upload attempts. Please retry later.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
          },
        }
      );
    }
    const payload = await getPayloadClient();
    const auth = await payload.auth({ headers: request.headers }).catch(() => null);
    const ownerUser = normalizeRelationshipId(auth?.user?.id);
    const ownerEmail = normalizeEmail(auth?.user?.email);
    const ownerToken = ensureCustomerUploadOwnerToken(request);
    const ownerSessionHash = hashCustomerUploadOwnerToken(ownerToken.token);
    console.log("[customer-upload] parsing formData", { requestId });
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
      console.warn("[customer-upload] missing file in formData");
      return NextResponse.json(
        { success: false, error: "Missing file upload." },
        { status: 400 }
      );
    }

    const uploadFile = file as File;
    const filename = uploadFile.name || "upload.stl";
    const lower = filename.toLowerCase();
    console.log("[customer-upload] file meta", {
      requestId,
      filename,
      type: uploadFile.type,
      size: uploadFile.size,
    });
    if (uploadFile.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: "Файл превышает 100MB. Уменьшите размер и попробуйте снова.",
        },
        { status: 400 }
      );
    }
    if (
      !lower.endsWith(".stl") &&
      !lower.endsWith(".obj") &&
      !lower.endsWith(".glb") &&
      !lower.endsWith(".gltf")
    ) {
      console.warn("[customer-upload] unsupported file type", { filename });
      return NextResponse.json(
        { success: false, error: "Unsupported file type." },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(await uploadFile.arrayBuffer());
    const fileType = resolveFileType(filename);
    const mimeType = resolveMimeType(filename, uploadFile.type || undefined);
    console.log("[customer-upload] resolved", {
      requestId,
      fileType,
      mimeType,
      bufferSize: buffer.length,
    });

    let created;
    const uploadStartedAt = Date.now();
    try {
      console.log("[customer-upload] creating media record", { requestId });
      created = await withTimeout(
        payload.create({
          collection: "media",
          overrideAccess: true,
          disableTransaction: true,
          data: {
            alt: filename,
            fileType,
            isCustomerUpload: true,
            ownerUser: ownerUser ?? undefined,
            ownerEmail: ownerEmail || undefined,
            ownerSessionHash: ownerSessionHash || undefined,
          },
          file: {
            data: buffer,
            mimetype: mimeType,
            name: filename,
            size: buffer.length,
          },
        }),
        "primary",
        uploadStartedAt
      );
    } catch (error) {
      console.error("[customer-upload] primary upload failed", {
        requestId,
        message: extractErrorMessage(error),
        details: extractErrorDetails(error),
      });
      if (!isRetryablePayloadError(error)) {
        throw error;
      }
      console.warn("[customer-upload] retrying upload with minimal data");
      created = await withTimeout(
        payload.create({
          collection: "media",
          overrideAccess: true,
          disableTransaction: true,
          data: {
            alt: filename,
            fileType,
            isCustomerUpload: true,
            ownerUser: ownerUser ?? undefined,
            ownerEmail: ownerEmail || undefined,
            ownerSessionHash: ownerSessionHash || undefined,
          },
          file: {
            data: buffer,
            mimetype: mimeType,
            name: filename,
            size: buffer.length,
          },
        }),
        "retry",
        uploadStartedAt
      );
    }
    console.log("[customer-upload] create completed", {
      requestId,
      ms: Date.now() - uploadStartedAt,
    });
    console.log("[customer-upload] upload success", {
      requestId,
      id: created.id,
      filename: (created as any).filename,
      url: (created as any).url,
    });

    const response = NextResponse.json(
      {
        success: true,
        doc: {
          id: created.id,
          url: (created as any).url,
          filename: (created as any).filename,
        },
      },
      { status: 201 }
    );
    attachCustomerUploadOwnerCookie(response, ownerToken.token);
    return response;
  } catch (error: any) {
    const errorMessage = extractErrorMessage(error);
    const errorDetails = extractErrorDetails(error);
    console.error("[customer-upload] error", { message: errorMessage, details: errorDetails });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to upload file.",
      },
      { status: 500 }
    );
  }
}

