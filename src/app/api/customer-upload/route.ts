import { NextResponse, type NextRequest } from "next/server";
import { getPayloadHMR } from "@payloadcms/next/utilities";

import payloadConfig from "../../../../payload.config";
import { importMap } from "../../(payload)/admin/importMap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayload = async () =>
  getPayloadHMR({
    config: payloadConfig,
    importMap,
  });

const resolveFileType = (filename: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".stl")) return "stl";
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

export async function POST(request: NextRequest) {
  try {
    console.log("[customer-upload] request start");
    const payload = await getPayload();
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
      filename,
      type: uploadFile.type,
      size: uploadFile.size,
    });
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
      fileType,
      mimeType,
      bufferSize: buffer.length,
    });

    const created = await payload.create({
      collection: "media",
      overrideAccess: true,
      data: {
        alt: filename,
        fileType,
        isCustomerUpload: true,
      },
      file: {
        data: buffer,
        mimetype: mimeType,
        name: filename,
        size: buffer.length,
      },
    });
    console.log("[customer-upload] upload success", {
      id: created.id,
      filename: (created as any).filename,
      url: (created as any).url,
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
  } catch (error: any) {
    console.error("[customer-upload] error", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to upload file.",
      },
      { status: 500 }
    );
  }
}
