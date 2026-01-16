import { NextResponse, type NextRequest } from "next/server";
import { getPayloadHMR } from "@payloadcms/next/utilities";

import payloadConfig from "../../../../../payload.config";
import { importMap } from "../../../(payload)/admin/importMap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayload = async () =>
  getPayloadHMR({
    config: payloadConfig,
    importMap,
  });

const resolveFileType = (filename: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".stl")) return "3d-model";
  if (lower.endsWith(".obj")) return "3d-model";
  if (lower.endsWith(".glb") || lower.endsWith(".gltf")) return "3d-model";
  return "other";
};

const resolveMimeType = (filename: string, fallback?: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".stl")) return "model/stl";
  if (lower.endsWith(".obj")) return "model/obj";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  return fallback || "application/octet-stream";
};

const buildPublicUrl = (bucket: string, key: string) => {
  const endpoint = (process.env.S3_ENDPOINT || "").replace(/\/$/, "");
  return `${endpoint}/${bucket}/${key}`;
};

const buildExistingWhere = (filename: string, size: number, url?: string) => {
  const base: any[] = [
    { filename: { equals: filename } },
    { isCustomerUpload: { equals: true } },
  ];
  if (size > 0) {
    base.push({ filesize: { equals: size } });
  }

  const candidates: any[] = [];
  if (url) {
    candidates.push({ url: { equals: url } });
  }
  candidates.push({ and: base });

  if (candidates.length === 1) {
    return candidates[0];
  }
  return { or: candidates };
};

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).slice(2, 8);
  const startedAt = Date.now();
  try {
    const payload = await getPayload();
    const body = await request.json();
    const filename = typeof body?.filename === "string" ? body.filename : "";
    const size = typeof body?.size === "number" ? body.size : 0;
    const key = typeof body?.key === "string" ? body.key : "";
    const contentType =
      typeof body?.contentType === "string" ? body.contentType : undefined;

    if (!filename || !key) {
      return NextResponse.json(
        { success: false, error: "Missing filename or key." },
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

    const mimeType = resolveMimeType(filename, contentType);
    const fileType = resolveFileType(filename);
    const url =
      typeof body?.fileUrl === "string" && body.fileUrl
        ? body.fileUrl
        : buildPublicUrl(bucket, key);

    const existingWhere = buildExistingWhere(filename, size, url);
    const existing = await payload.find({
      collection: "media",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      sort: "-createdAt",
      where: existingWhere,
    });
    const existingDoc = existing?.docs?.[0];
    if (existingDoc?.id) {
      console.log("[customer-upload:complete] existing media found", {
        requestId,
        id: existingDoc.id,
        url: existingDoc.url,
      });
      return NextResponse.json(
        {
          success: true,
          doc: {
            id: existingDoc.id,
            url: existingDoc.url,
            filename: existingDoc.filename,
          },
        },
        { status: 200 }
      );
    }

    console.log("[customer-upload:complete] creating media", {
      requestId,
      filename,
      key,
      size,
    });

    const created = await payload.create({
      collection: "media",
      overrideAccess: true,
      disableTransaction: true,
      data: {
        alt: filename,
        fileType,
        isCustomerUpload: true,
        filename,
        mimeType,
        filesize: size,
        url,
        prefix: "media",
      },
    });

    console.log("[customer-upload:complete] created", {
      requestId,
      id: created.id,
      url: (created as any).url,
      ms: Date.now() - startedAt,
    });

    return NextResponse.json(
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
  } catch (error) {
    console.error("[customer-upload:complete] error", {
      requestId,
      ms: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { success: false, error: "Failed to finalize upload." },
      { status: 500 }
    );
  }
}
