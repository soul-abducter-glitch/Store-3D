import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { analyzeAiAssetTopology } from "@/lib/aiAssetRepair";
import { authorizeAiAsset, resolveOwnedAssetVersion } from "@/lib/aiAssetApi";
import {
  buildDiagnosticsFromTopology,
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

const resolveMode = (value: unknown): "auto" | "plane" => {
  const raw = toNonEmptyString(value).toLowerCase();
  return raw === "plane" ? "plane" : "auto";
};

const normalizePlanes = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const plane = item as Record<string, unknown>;
      const nx = Number(plane.nx);
      const ny = Number(plane.ny);
      const nz = Number(plane.nz);
      const d = Number(plane.d);
      if (![nx, ny, nz, d].every(Number.isFinite)) return null;
      return { nx, ny, nz, d };
    })
    .filter(Boolean)
    .slice(0, 12) as Array<{ nx: number; ny: number; nz: number; d: number }>;
};

const resolvePartsCount = (mode: "auto" | "plane", diagnostics: ReturnType<typeof buildDiagnosticsFromTopology>, planes: unknown[]) => {
  if (mode === "plane") {
    const requested = Array.isArray(planes) ? planes.length : 0;
    return Math.max(2, Math.min(14, requested + 1));
  }
  const components = Number(diagnostics.componentsCount || 1);
  if (!Number.isFinite(components) || components <= 1) return 1;
  return Math.max(1, Math.min(14, Math.trunc(components)));
};

const buildPartSet = (input: {
  sourceAsset: any;
  partsCount: number;
  mode: "auto" | "plane";
  planes: Array<{ nx: number; ny: number; nz: number; d: number }>;
}) => {
  const partSetId = `partset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceUrl = toNonEmptyString(input.sourceAsset?.modelUrl);
  const sourceBbox =
    input.sourceAsset?.checks?.diagnostics?.bbox && typeof input.sourceAsset.checks.diagnostics.bbox === "object"
      ? input.sourceAsset.checks.diagnostics.bbox
      : null;

  const parts = Array.from({ length: input.partsCount }).map((_, index) => {
    const partNumber = index + 1;
    const suffix = sourceUrl.includes("?") ? `&part=${partNumber}` : `?part=${partNumber}`;
    return {
      partId: `${partSetId}-p${partNumber}`,
      name: `Part ${partNumber}`,
      fileUrl: `${sourceUrl}${suffix}`,
      bbox: sourceBbox,
      volumeEstimateCm3: null,
    };
  });

  return {
    id: partSetId,
    mode: input.mode,
    planes: input.mode === "plane" ? input.planes : [],
    parts,
    createdAt: new Date().toISOString(),
  };
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
    const planes = normalizePlanes(body?.params?.planes);

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
      type: "split",
      status: "queued",
      progress: 7,
      inputVersionId: String(targetAsset.id),
      message: `Split (${mode}) queued.`,
      createdAt,
      updatedAt: createdAt,
      logs: [`Split requested with mode=${mode}.`],
    });
    let jobs = upsertPipelineJob(normalizePipelineJobs(targetAsset?.pipelineJobs), job);

    job = buildPipelineJob({
      ...job,
      status: "running",
      progress: 30,
      message: "Preparing split boundaries.",
      logs: [...job.logs, "Analyzing topology before split."],
      updatedAt: new Date().toISOString(),
    });
    jobs = upsertPipelineJob(jobs, job);

    const topology = await analyzeAiAssetTopology({
      modelUrl: toNonEmptyString(targetAsset?.modelUrl),
      format: targetAsset?.format,
      precheckLogs: targetAsset?.precheckLogs,
    });
    const diagnostics = buildDiagnosticsFromTopology(topology, targetAsset);
    const partsCount = resolvePartsCount(mode, diagnostics, planes);
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

    if (partsCount <= 1) {
      job = buildPipelineJob({
        ...job,
        status: "done",
        progress: 100,
        message: "No split candidates found.",
        result: {
          noChanges: true,
          mode,
          partsCount,
        },
        logs: [...job.logs, "Split skipped because only one connected part was detected."],
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
            mode,
          },
        },
        { status: 200 }
      );
    }

    const partSet = buildPartSet({
      sourceAsset: targetAsset,
      partsCount,
      mode,
      planes,
    });
    const splitChecks = {
      ...sourceChecks,
      split: {
        mode,
        partsCount,
        partSetId: partSet.id,
        planes,
        createdAt: new Date().toISOString(),
      },
    };

    const splitAsset = await createDerivedAssetVersion({
      payload,
      sourceAsset: targetAsset,
      userId: authorized.userId,
      versionLabel: "split_set",
      providerSuffix: mode === "plane" ? "split-plane" : "split-auto",
      titleSuffix: mode === "plane" ? "split-plane" : "split-auto",
      checks: splitChecks,
      splitPartSet: partSet,
    });

    job = buildPipelineJob({
      ...job,
      status: "done",
      progress: 100,
      outputVersionId: String(splitAsset.id),
      partSetId: partSet.id,
      message: `Split completed (${partsCount} parts).`,
      result: {
        newVersionId: String(splitAsset.id),
        partSetId: partSet.id,
        partsCount,
      },
      logs: [...job.logs, `Created split version ${String(splitAsset.id)} with ${partsCount} parts.`],
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
          newVersionId: String(splitAsset.id),
          partSetId: partSet.id,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[assets:split] failed", error);

    if (jobId && targetAsset?.id) {
      try {
        const currentJobs = normalizePipelineJobs(targetAsset?.pipelineJobs);
        const failed = buildPipelineJob({
          id: jobId,
          type: "split",
          status: "error",
          progress: 100,
          inputVersionId: String(targetAsset.id),
          error: error instanceof Error ? error.message : "Split failed.",
          message: "Split failed.",
          logs: ["Split failed."],
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
        console.error("[assets:split] failed to persist error state", persistError);
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: "Failed to split asset.",
      },
      { status: 500 }
    );
  }
}
