import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { analyzeAiAssetTopology, simulateAiAssetRepair } from "@/lib/aiAssetRepair";
import { authorizeAiAsset, resolveOwnedAssetVersion } from "@/lib/aiAssetApi";
import {
  buildDiagnosticsFromTopology,
  buildPipelineJob,
  createDerivedAssetVersion,
  createPipelineJobId,
  normalizePipelineJobs,
  upsertPipelineJob,
  type AssetVersionLabel,
} from "@/lib/aiAssetPipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const resolvePreset = (value: unknown): "safe" | "strong" => {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "strong" ? "strong" : "safe";
};

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
    const preset = resolvePreset(body?.preset);

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
      type: "mesh_fix",
      status: "queued",
      progress: 8,
      inputVersionId: String(targetAsset.id),
      message: `Quick Fix (${preset}) queued.`,
      createdAt,
      updatedAt: createdAt,
      logs: [`Quick Fix requested with preset=${preset}.`],
    });
    let jobs = upsertPipelineJob(normalizePipelineJobs(targetAsset?.pipelineJobs), job);

    job = buildPipelineJob({
      ...job,
      status: "running",
      progress: 35,
      message: "Inspecting mesh and preparing fixes.",
      logs: [...job.logs, "Analyzing topology before repair."],
      updatedAt: new Date().toISOString(),
    });
    jobs = upsertPipelineJob(jobs, job);

    const topology = await analyzeAiAssetTopology({
      modelUrl: toNonEmptyString(targetAsset?.modelUrl),
      format: targetAsset?.format,
      precheckLogs: targetAsset?.precheckLogs,
    });
    const diagnostics = buildDiagnosticsFromTopology(topology, targetAsset);
    const analyzedAt = new Date().toISOString();
    const sourceChecks = {
      ...(targetAsset?.checks && typeof targetAsset.checks === "object" ? targetAsset.checks : {}),
      topology: {
        ...topology,
        analyzedAt,
        analyzer: "mesh-pipeline-v1",
      },
      diagnostics,
    };

    if (!topology.fixAvailable) {
      job = buildPipelineJob({
        ...job,
        status: "done",
        progress: 100,
        message: "No changes required.",
        result: {
          noChanges: true,
          preset,
          diagnostics,
        },
        logs: [...job.logs, "No changes were required."],
        updatedAt: new Date().toISOString(),
      });
      jobs = upsertPipelineJob(jobs, job);

      await payload.update({
        collection: "ai_assets",
        id: targetAsset.id,
        overrideAccess: true,
        data: {
          checks: sourceChecks,
          pipelineJobs: jobs,
        },
      });

      return NextResponse.json(
        {
          success: true,
          jobId,
          result: {
            noChanges: true,
            preset,
          },
        },
        { status: 200 }
      );
    }

    const simulated = simulateAiAssetRepair(topology);
    const effectiveRepair =
      preset === "strong"
        ? {
            ...simulated,
            repairLog: {
              ...simulated.repairLog,
              appliedFixes: [
                ...simulated.repairLog.appliedFixes,
                "Voxel remesh pass for merged non-manifold zones.",
                "Aggressive hole fill in unresolved open boundaries.",
              ],
              warnings: [
                ...simulated.repairLog.warnings,
                "Strong preset may alter small details and thin features.",
              ],
            },
            estimatedGeometryChangePercent: Number(
              Math.min(45, simulated.estimatedGeometryChangePercent + 12).toFixed(2)
            ),
            estimatedDetailLossPercent: Number(
              Math.min(24, simulated.estimatedDetailLossPercent + 6).toFixed(2)
            ),
          }
        : simulated;

    const repairedAt = new Date().toISOString();
    const versionLabel: AssetVersionLabel = preset === "strong" ? "fixed_strong" : "fixed_safe";
    const repairedChecks = {
      ...sourceChecks,
      topology: {
        ...topology,
        analyzedAt,
        repairedAt,
        analyzer: "mesh-pipeline-v1",
        fixAvailable: false,
      },
      repair: {
        preset,
        sourceAssetId: String(targetAsset.id),
        sourceVersion: Number(targetAsset?.version) || 1,
        estimatedGeometryChangePercent: effectiveRepair.estimatedGeometryChangePercent,
        estimatedDetailLossPercent: effectiveRepair.estimatedDetailLossPercent,
        appliedFixes: effectiveRepair.repairLog.appliedFixes,
        warnings: effectiveRepair.repairLog.warnings,
      },
    };

    const repairedAsset = await createDerivedAssetVersion({
      payload,
      sourceAsset: targetAsset,
      userId: authorized.userId,
      versionLabel,
      providerSuffix: preset === "strong" ? "fix-strong" : "fix-safe",
      titleSuffix: preset === "strong" ? "fixed-strong" : "fixed-safe",
      checks: repairedChecks,
    });

    job = buildPipelineJob({
      ...job,
      status: "done",
      progress: 100,
      outputVersionId: String(repairedAsset.id),
      message: "Quick Fix completed.",
      result: {
        newVersionId: String(repairedAsset.id),
        preset,
        warning:
          preset === "strong"
            ? "Strong preset may change fine details."
            : "Safe preset applied conservative mesh cleanup.",
      },
      logs: [...job.logs, `Created version ${String(repairedAsset.id)} (${versionLabel}).`],
      updatedAt: new Date().toISOString(),
    });
    jobs = upsertPipelineJob(jobs, job);

    await payload.update({
      collection: "ai_assets",
      id: targetAsset.id,
      overrideAccess: true,
      data: {
        checks: sourceChecks,
        pipelineJobs: jobs,
      },
    });

    return NextResponse.json(
      {
        success: true,
        jobId,
        result: {
          newVersionId: String(repairedAsset.id),
          preset,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[assets:fix] failed", error);

    if (jobId && targetAsset?.id) {
      try {
        const currentJobs = normalizePipelineJobs(targetAsset?.pipelineJobs);
        const failed = buildPipelineJob({
          id: jobId,
          type: "mesh_fix",
          status: "error",
          progress: 100,
          inputVersionId: String(targetAsset.id),
          error: error instanceof Error ? error.message : "Quick Fix failed.",
          message: "Quick Fix failed.",
          logs: ["Quick Fix failed."],
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
        console.error("[assets:fix] failed to persist error state", persistError);
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: "Failed to run Quick Fix.",
      },
      { status: 500 }
    );
  }
}
