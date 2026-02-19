import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { authorizeAiAsset, resolveOwnedAssetVersion } from "@/lib/aiAssetApi";
import {
  buildPipelineJob,
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

const parseBoolean = (value: unknown, fallback: boolean) => {
  if (value === undefined || value === null) return fallback;
  const raw = toNonEmptyString(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
};

const normalizeFormat = (value: unknown) => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "gltf" || raw === "obj" || raw === "stl") return raw;
  return "glb";
};

const resolveBridgeTokens = () =>
  (process.env.BLENDER_BRIDGE_TOKEN || process.env.BLENDER_BRIDGE_TOKENS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const readAddonToken = (request: NextRequest) => {
  const auth = toNonEmptyString(request.headers.get("authorization"));
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  const fromHeader = toNonEmptyString(request.headers.get("x-addon-token"));
  if (fromHeader) return fromHeader;
  const fromHeaderAlt = toNonEmptyString(request.headers.get("x-blender-token"));
  if (fromHeaderAlt) return fromHeaderAlt;
  const fromQuery = toNonEmptyString(request.nextUrl.searchParams.get("token"));
  return fromQuery;
};

const ensureAddonAuthorized = (request: NextRequest) => {
  const tokens = resolveBridgeTokens();
  if (!tokens.length) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "Blender Bridge token is not configured on server." },
        { status: 503 }
      ),
    };
  }
  const token = readAddonToken(request);
  if (!token || !tokens.includes(token)) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Invalid addon token." }, { status: 401 }),
    };
  }
  return { ok: true as const };
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const body = await request.json().catch(() => null);
    const requestedAssetId = toNonEmptyString(body?.assetId);
    if (!requestedAssetId) {
      return NextResponse.json(
        { success: false, error: "assetId is required." },
        { status: 400 }
      );
    }

    const bridgeEnabled = parseBoolean(
      process.env.BLENDER_BRIDGE_ENABLED,
      resolveBridgeTokens().length > 0
    );
    if (!bridgeEnabled) {
      return NextResponse.json(
        { success: false, error: "Blender Bridge is not enabled on this server." },
        { status: 412 }
      );
    }

    const authorized = await authorizeAiAsset(payload, request, requestedAssetId);
    if (!authorized.ok) return authorized.response;

    const targetAsset = await resolveOwnedAssetVersion({
      payload,
      userId: authorized.userId,
      fallbackAsset: authorized.asset,
      requestedVersionId: body?.versionId,
    });

    const format = normalizeFormat(body?.format);
    const options =
      body?.options && typeof body.options === "object" && !Array.isArray(body.options)
        ? body.options
        : {};

    const jobId = createPipelineJobId(targetAsset.id);
    const createdAt = new Date().toISOString();
    const job = buildPipelineJob({
      id: jobId,
      type: "dcc_blender",
      status: "queued",
      progress: 0,
      inputVersionId: String(targetAsset.id),
      message: "Waiting for Blender Bridge pickup.",
      createdAt,
      updatedAt: createdAt,
      result: {
        format,
        downloadUrl: toNonEmptyString(targetAsset?.modelUrl),
        options,
      },
      logs: ["Blender bridge job queued."],
    });
    const jobs = upsertPipelineJob(normalizePipelineJobs(targetAsset?.pipelineJobs), job);

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
        status: job.status,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[dcc/blender/jobs:create] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to create Blender job.",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const addonAuth = ensureAddonAuthorized(request);
    if (!addonAuth.ok) return addonAuth.response;

    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const statusFilterRaw = toNonEmptyString(request.nextUrl.searchParams.get("status")).toLowerCase();
    const statusFilter = statusFilterRaw === "pending" ? "queued" : statusFilterRaw || "queued";

    const found = await payload.find({
      collection: "ai_assets",
      depth: 0,
      limit: 240,
      sort: "-updatedAt",
      overrideAccess: true,
    });
    const docs = Array.isArray(found?.docs) ? found.docs : [];

    const items = docs
      .flatMap((asset) => {
        const jobs = normalizePipelineJobs(asset?.pipelineJobs);
        return jobs
          .filter((job) => job.type === "dcc_blender")
          .filter((job) => (statusFilter ? job.status === statusFilter : true))
          .map((job) => ({
            jobId: job.id,
            status: job.status,
            assetId: String(asset.id),
            versionId: job.inputVersionId || String(asset.id),
            downloadUrl: toNonEmptyString(job.result?.downloadUrl),
            options:
              job.result && typeof job.result.options === "object" && job.result.options
                ? job.result.options
                : {},
            format: toNonEmptyString(job.result?.format) || "glb",
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
          }));
      })
      .filter((item) => item.downloadUrl);

    return NextResponse.json(
      {
        success: true,
        jobs: items,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[dcc/blender/jobs:list] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch Blender jobs.",
      },
      { status: 500 }
    );
  }
}
