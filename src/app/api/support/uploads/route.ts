import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import {
  SUPPORT_ALLOWED_ATTACHMENT_EXTENSIONS,
  SUPPORT_MAX_ATTACHMENT_BYTES,
} from "@/lib/supportCenter";
import { checkRateLimit, resolveClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });
const SUPPORT_UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const SUPPORT_UPLOAD_MAX_REQUESTS = 20;

const resolveExt = (fileName: string) => {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "";
  return lower.slice(dot);
};

const resolveMimeType = (ext: string, fallback: string) => {
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".txt") return "text/plain";
  if (ext === ".glb") return "model/gltf-binary";
  if (ext === ".gltf") return "model/gltf+json";
  if (ext === ".stl") return "model/stl";
  if (ext === ".pdf" || ext === ".zip") return "application/octet-stream";
  if (fallback) return fallback;
  return "application/octet-stream";
};

const resolveFileType = (ext: string) => {
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") return "image";
  if (ext === ".glb" || ext === ".gltf" || ext === ".stl") return "3d-model";
  return "other";
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    const auth = await payload.auth({ headers: request.headers }).catch(() => null);
    if (!auth?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }
    const rate = checkRateLimit({
      scope: "support-upload",
      key: `${String(auth.user.id)}:${resolveClientIp(request.headers)}`,
      max: SUPPORT_UPLOAD_MAX_REQUESTS,
      windowMs: SUPPORT_UPLOAD_WINDOW_MS,
    });
    if (!rate.ok) {
      const retryAfter = Math.max(1, Math.ceil(Math.max(0, rate.retryAfterMs) / 1000));
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

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
      return NextResponse.json(
        { success: false, error: "\u0424\u0430\u0439\u043b \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d." },
        { status: 400 }
      );
    }

    const uploadFile = file as File;
    const fileName = String(uploadFile.name || "").trim();
    const ext = resolveExt(fileName);
    if (!fileName || !SUPPORT_ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { success: false, error: "\u0424\u043e\u0440\u043c\u0430\u0442 \u0444\u0430\u0439\u043b\u0430 \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f" },
        { status: 400 }
      );
    }

    if (uploadFile.size > SUPPORT_MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { success: false, error: "\u0424\u0430\u0439\u043b \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0439" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await uploadFile.arrayBuffer());
    const created = await payload.create({
      collection: "media",
      overrideAccess: true,
      disableTransaction: true,
      data: {
        alt: fileName,
        fileType: resolveFileType(ext),
        isCustomerUpload: true,
        ownerUser: auth.user.id,
        ownerEmail: typeof auth.user.email === "string" ? auth.user.email.trim().toLowerCase() : undefined,
      },
      file: {
        data: buffer,
        name: fileName,
        size: buffer.length,
        mimetype: resolveMimeType(ext, uploadFile.type || ""),
      },
    });

    const url =
      typeof (created as any)?.url === "string" && (created as any).url
        ? (created as any).url
        : typeof (created as any)?.filename === "string" && (created as any).filename
          ? `/api/media-file/${encodeURIComponent((created as any).filename)}`
          : "";

    return NextResponse.json(
      {
        success: true,
        attachment: {
          id: String(created.id),
          fileName,
          size: buffer.length,
          mimeType: resolveMimeType(ext, uploadFile.type || ""),
          url,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[support/uploads] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0444\u0430\u0439\u043b. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.",
      },
      { status: 500 }
    );
  }
}
