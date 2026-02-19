import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { analyzeAiAssetTopology } from "@/lib/aiAssetRepair";
import { authorizeAiAsset, resolveOwnedAssetVersion } from "@/lib/aiAssetApi";
import {
  buildDiagnosticsFromTopology,
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
      type: "analyze",
      status: "queued",
      progress: 5,
      inputVersionId: String(targetAsset.id),
      message: "Analyze queued.",
      createdAt,
      updatedAt: createdAt,
      logs: ["Analyze job created."],
    });
    let jobs = upsertPipelineJob(normalizePipelineJobs(targetAsset?.pipelineJobs), job);

    job = buildPipelineJob({
      ...job,
      status: "running",
      progress: 30,
      message: "Collecting topology diagnostics.",
      logs: [...job.logs, "Running topology checks."],
      updatedAt: new Date().toISOString(),
    });
    jobs = upsertPipelineJob(jobs, job);

    const topology = await analyzeAiAssetTopology({
      modelUrl: toNonEmptyString(targetAsset?.modelUrl),
      format: targetAsset?.format,
      precheckLogs: targetAsset?.precheckLogs,
    });
    const diagnostics = buildDiagnosticsFromTopology(topology, targetAsset);
    const nextChecks = {
      ...(targetAsset?.checks && typeof targetAsset.checks === "object" ? targetAsset.checks : {}),
      topology: {
        ...topology,
        analyzedAt: diagnostics.analyzedAt,
        analyzer: "mesh-pipeline-v1",
      },
      diagnostics,
    };

    job = buildPipelineJob({
      ...job,
      status: "done",
      progress: 100,
      message: "Diagnostics ready.",
      result: {
        stats: diagnostics,
        issues: diagnostics.issues,
      },
      logs: [...job.logs, `Completed with status ${diagnostics.status}.`],
      updatedAt: new Date().toISOString(),
    });
    jobs = upsertPipelineJob(jobs, job);

    await payload.update({
      collection: "ai_assets",
      id: targetAsset.id,
      overrideAccess: true,
      data: {
        checks: nextChecks,
        pipelineJobs: jobs,
      },
    });

    return NextResponse.json(
      {
        success: true,
        jobId,
        result: {
          stats: diagnostics,
          issues: diagnostics.issues,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[assets:analyze] failed", error);

    if (jobId && targetAsset?.id) {
      try {
        const currentJobs = normalizePipelineJobs(targetAsset?.pipelineJobs);
        const failed = buildPipelineJob({
          id: jobId,
          type: "analyze",
          status: "error",
          progress: 100,
          inputVersionId: String(targetAsset.id),
          error: error instanceof Error ? error.message : "Analyze failed.",
          message: "Analyze failed.",
          updatedAt: new Date().toISOString(),
          logs: ["Analyze failed."],
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
        console.error("[assets:analyze] failed to persist error state", persistError);
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: "Failed to analyze asset.",
      },
      { status: 500 }
    );
  }
}
