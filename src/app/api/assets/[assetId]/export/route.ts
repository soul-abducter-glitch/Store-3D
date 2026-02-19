import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { authorizeAiAsset, resolveOwnedAssetVersion } from "@/lib/aiAssetApi";
import { buildStoredZip } from "@/lib/simpleZip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const parsePartsFlag = (value: string | null) => {
  const raw = toNonEmptyString(value).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const safeName = (value: string, fallback: string) => {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const resolvedParams = await params;
    const authorized = await authorizeAiAsset(payload, request, resolvedParams?.assetId || "");
    if (!authorized.ok) return authorized.response;

    const format = toNonEmptyString(request.nextUrl.searchParams.get("format")).toLowerCase();
    const requestedVersionId = toNonEmptyString(request.nextUrl.searchParams.get("versionId"));
    const includeParts = parsePartsFlag(request.nextUrl.searchParams.get("parts"));
    const targetAsset = await resolveOwnedAssetVersion({
      payload,
      userId: authorized.userId,
      fallbackAsset: authorized.asset,
      requestedVersionId: requestedVersionId || undefined,
    });

    const modelUrl = toNonEmptyString(targetAsset?.modelUrl);
    if (!modelUrl) {
      return NextResponse.json(
        { success: false, error: "Model URL is missing for selected version." },
        { status: 400 }
      );
    }

    if (format === "glb") {
      return NextResponse.redirect(modelUrl, { status: 307 });
    }

    if (format === "zip" && includeParts) {
      const partSet =
        targetAsset?.splitPartSet && typeof targetAsset.splitPartSet === "object"
          ? targetAsset.splitPartSet
          : null;
      const parts = Array.isArray((partSet as any)?.parts) ? (partSet as any).parts : [];
      if (!partSet || parts.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Split part set is missing for selected version.",
          },
          { status: 409 }
        );
      }

      const manifest = {
        assetId: String(authorized.asset.id),
        versionId: String(targetAsset.id),
        partSetId: toNonEmptyString((partSet as any)?.id),
        parts,
        exportedAt: new Date().toISOString(),
      };

      const entries: Array<{ name: string; data: Uint8Array }> = [];
      entries.push({
        name: "README.txt",
        data: Buffer.from(
          "3D-STORE split export (MVP): this archive contains manifest and per-part source URLs.\n",
          "utf8"
        ),
      });
      entries.push({
        name: "manifest.json",
        data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      });

      parts.forEach((part: any, index: number) => {
        const id = safeName(toNonEmptyString(part?.partId), `part-${index + 1}`);
        const sourceUrl = toNonEmptyString(part?.fileUrl) || modelUrl;
        entries.push({
          name: `parts/${id}.url`,
          data: Buffer.from(`${sourceUrl}\n`, "utf8"),
        });
      });

      const zipBuffer = buildStoredZip(entries);
      const baseName = safeName(toNonEmptyString(targetAsset?.title), "asset");

      return new NextResponse(zipBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename=\"${baseName}-parts.zip\"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: "Unsupported export format.",
      },
      { status: 400 }
    );
  } catch (error) {
    console.error("[assets:export] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to export asset.",
      },
      { status: 500 }
    );
  }
}
