import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { authorizeAiAsset, resolveOwnedAssetVersion } from "@/lib/aiAssetApi";
import {
  buildPipelineJob,
  createDerivedAssetVersion,
  createPipelineJobId,
  normalizePipelineJobs,
  upsertPipelineJob,
} from "@/lib/aiAssetPipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const resolveMode = (value: unknown): "image" | "flat" => {
  const raw = toNonEmptyString(value).toLowerCase();
  return raw === "flat" ? "flat" : "image";
};

const normalizeHexColor = (value: unknown, fallback = "#b7a487") => {
  const raw = toNonEmptyString(value);
  if (!raw) return fallback;
  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) return fallback;
  return normalized.toLowerCase();
};

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i;

const looksLikeImageUrl = (value: string) => {
  const raw = value.trim();
  if (!raw) return false;
  if (raw.startsWith("data:image/")) return true;
  const withoutHash = raw.split("#")[0] || raw;
  const withoutQuery = withoutHash.split("?")[0] || withoutHash;
  return IMAGE_EXT_RE.test(withoutQuery);
};

const normalizeTextureImageUrl = (value: unknown) => {
  const raw = toNonEmptyString(value);
  if (!raw) return "";
  if (raw.startsWith("data:image/")) {
    // Keep inline payloads bounded so checks JSON doesn't grow uncontrollably.
    return raw.length <= 260_000 ? raw : "";
  }
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) {
    return looksLikeImageUrl(raw) ? raw : "";
  }
  return "";
};

const hashToTint = (seed: string) => {
  const raw = seed || "texture";
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash % 360);
  const saturation = 34;
  const lightness = 56;

  const c = ((1 - Math.abs((2 * lightness) / 100 - 1)) * saturation) / 100;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness / 100 - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const payload = await getPayloadClient();
  await ensureAiLabSchemaOnce(payload as any);

  const resolvedParams = await params;
  const authorized = await authorizeAiAsset(payload, request, resolvedParams?.assetId || "");
  if (!authorized.ok) return authorized.response;

  let targetAsset = authorized.asset;
  let jobId = "";
  try {
    const body = await request.json().catch(() => null);
    const mode = resolveMode(body?.mode);
    const requestedSourceImageUrl = normalizeTextureImageUrl(
      body?.params?.sourceImageUrl || body?.sourceImageUrl
    );

    targetAsset = await resolveOwnedAssetVersion({
      payload,
      userId: authorized.userId,
      fallbackAsset: authorized.asset,
      requestedVersionId: body?.versionId,
    });

    jobId = createPipelineJobId(targetAsset.id);
    const createdAt = new Date().toISOString();
    let job = buildPipelineJob({
      id: jobId,
      type: "texture",
      status: "queued",
      progress: 9,
      inputVersionId: String(targetAsset.id),
      message: `Texture (${mode}) queued.`,
      createdAt,
      updatedAt: createdAt,
      logs: [`Texture requested with mode=${mode}.`],
    });
    let jobs = upsertPipelineJob(normalizePipelineJobs(targetAsset?.pipelineJobs), job);

    job = buildPipelineJob({
      ...job,
      status: "running",
      progress: 42,
      message: "Preparing texture metadata and material profile.",
      logs: [...job.logs, "Applying default PBR values and tint profile."],
      updatedAt: new Date().toISOString(),
    });
    jobs = upsertPipelineJob(jobs, job);

    const sourceUrl = toNonEmptyString(targetAsset?.sourceUrl);
    const fallbackSourceImageUrl =
      normalizeTextureImageUrl(targetAsset?.sourceUrl) ||
      normalizeTextureImageUrl(targetAsset?.previewUrl) ||
      "";
    const baseColorMapUrl =
      mode === "image" ? requestedSourceImageUrl || fallbackSourceImageUrl || null : null;
    const usedImageMap = Boolean(baseColorMapUrl);
    const tintHex =
      mode === "flat"
        ? normalizeHexColor(body?.params?.color, "#aab0ba")
        : hashToTint(
            (baseColorMapUrl || sourceUrl || toNonEmptyString(targetAsset?.title) || String(targetAsset.id))
              .slice(0, 1024)
          );

    const sourceChecks =
      targetAsset?.checks && typeof targetAsset.checks === "object" ? targetAsset.checks : {};

    const texturedChecks = {
      ...sourceChecks,
      texture: {
        mode,
        sourceImageUrl: baseColorMapUrl || sourceUrl || null,
        baseColorMapUrl,
        mapApplied: usedImageMap,
        tintHex,
        roughness: 0.72,
        metalness: 0.08,
        autoUv: true,
        uvReady: true,
        generatedAt: new Date().toISOString(),
        notes:
          mode === "image"
            ? usedImageMap
              ? "Base color map applied from source image (MVP)."
              : "Source image not found. Fallback color profile applied (MVP)."
            : "Fallback flat material profile applied.",
      },
    };

    const texturedAsset = await createDerivedAssetVersion({
      payload,
      sourceAsset: targetAsset,
      userId: authorized.userId,
      versionLabel: "textured_v1",
      providerSuffix: mode === "image" ? "texture-image" : "texture-flat",
      titleSuffix: "textured-v1",
      checks: texturedChecks,
    });

    job = buildPipelineJob({
      ...job,
      status: "done",
      progress: 100,
      outputVersionId: String(texturedAsset.id),
      message: "Texture pass completed.",
      result: {
        newVersionId: String(texturedAsset.id),
        mode,
        baseColorMapUrl,
        mapApplied: usedImageMap,
        tintHex,
        autoUv: true,
      },
      logs: [...job.logs, `Created textured version ${String(texturedAsset.id)}.`],
      updatedAt: new Date().toISOString(),
    });
    jobs = upsertPipelineJob(jobs, job);

    await payload.update({
      collection: "ai_assets",
      id: targetAsset.id,
      overrideAccess: true,
      data: {
        pipelineJobs: jobs,
      },
    });

    return NextResponse.json(
      {
        success: true,
        jobId,
        result: {
          newVersionId: String(texturedAsset.id),
          mode,
          baseColorMapUrl,
          mapApplied: usedImageMap,
          tintHex,
          autoUv: true,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[assets:texture] failed", error);

    if (jobId && targetAsset?.id) {
      try {
        const currentJobs = normalizePipelineJobs(targetAsset?.pipelineJobs);
        const failed = buildPipelineJob({
          id: jobId,
          type: "texture",
          status: "error",
          progress: 100,
          inputVersionId: String(targetAsset.id),
          error: error instanceof Error ? error.message : "Texture failed.",
          message: "Texture failed.",
          logs: ["Texture failed."],
          updatedAt: new Date().toISOString(),
        });
        const jobs = upsertPipelineJob(currentJobs, failed);
        await payload.update({
          collection: "ai_assets",
          id: targetAsset.id,
          overrideAccess: true,
          data: {
            pipelineJobs: jobs,
          },
        });
      } catch (persistError) {
        console.error("[assets:texture] failed to persist error state", persistError);
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: "Failed to apply texture.",
      },
      { status: 500 }
    );
  }
}
