import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import {
  buildPipelineJob,
  normalizePipelineJobs,
  parseAssetIdFromPipelineJobId,
  upsertPipelineJob,
} from "@/lib/aiAssetPipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
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

const resolveAckStatus = (value: unknown): "picked" | "imported" | "error" => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "picked" || raw === "error") return raw;
  return "imported";
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const addonAuth = ensureAddonAuthorized(request);
    if (!addonAuth.ok) return addonAuth.response;

    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const resolvedParams = await params;
    const jobId = toNonEmptyString(resolvedParams?.jobId);
    if (!jobId) {
      return NextResponse.json({ success: false, error: "Job id is required." }, { status: 400 });
    }

    const assetId = parseAssetIdFromPipelineJobId(jobId);
    if (!assetId) {
      return NextResponse.json({ success: false, error: "Invalid job id." }, { status: 400 });
    }

    const asset = await payload
      .findByID({
        collection: "ai_assets",
        id: assetId,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);
    if (!asset) {
      return NextResponse.json({ success: false, error: "Asset not found for job." }, { status: 404 });
    }

    const jobs = normalizePipelineJobs(asset?.pipelineJobs);
    const existing = jobs.find((entry) => entry.id === jobId);
    if (!existing || existing.type !== "dcc_blender") {
      return NextResponse.json({ success: false, error: "Blender job not found." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const ackStatus = resolveAckStatus(body?.status);
    const ackMessage = toNonEmptyString(body?.message);
    const nowIso = new Date().toISOString();

    const updated = buildPipelineJob({
      ...existing,
      status: ackStatus === "error" ? "error" : ackStatus === "picked" ? "running" : "done",
      progress: ackStatus === "error" || ackStatus === "imported" ? 100 : 60,
      message:
        ackMessage ||
        (ackStatus === "picked"
          ? "Picked by Blender Bridge."
          : ackStatus === "error"
            ? "Blender Bridge import failed."
            : "Imported to Blender."),
      error: ackStatus === "error" ? ackMessage || "Blender import error." : null,
      logs: [
        ...existing.logs,
        `[${nowIso}] addon ack status=${ackStatus}${ackMessage ? ` message=${ackMessage}` : ""}`,
      ],
      updatedAt: nowIso,
    });
    const nextJobs = upsertPipelineJob(jobs, updated);

    await payload.update({
      collection: "ai_assets",
      id: asset.id,
      overrideAccess: true,
      data: {
        pipelineJobs: nextJobs,
      },
    });

    return NextResponse.json(
      {
        success: true,
        jobId: updated.id,
        status: updated.status,
        message: updated.message,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[dcc/blender/jobs:ack] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to acknowledge Blender job.",
      },
      { status: 500 }
    );
  }
}
