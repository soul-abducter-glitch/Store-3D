import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { authorizeAiAsset } from "@/lib/aiAssetApi";
import {
  normalizePipelineJobs,
  parseAssetIdFromPipelineJobId,
} from "@/lib/aiAssetPipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const resolvedParams = await params;
    const jobId = toNonEmptyString(resolvedParams?.jobId);
    if (!jobId) {
      return NextResponse.json({ success: false, error: "Job id is required." }, { status: 400 });
    }

    const assetId = parseAssetIdFromPipelineJobId(jobId);
    if (!assetId) {
      return NextResponse.json(
        { success: false, error: "Invalid job id format." },
        { status: 400 }
      );
    }

    const authorized = await authorizeAiAsset(payload, request, assetId);
    if (!authorized.ok) return authorized.response;

    const jobs = normalizePipelineJobs(authorized.asset?.pipelineJobs);
    const job = jobs.find((entry) => entry.id === jobId);
    if (!job) {
      return NextResponse.json(
        { success: false, error: "Job not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        jobId: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        result: job.result,
        error: job.error,
        message: job.message,
        inputVersionId: job.inputVersionId,
        outputVersionId: job.outputVersionId,
        partSetId: job.partSetId,
        updatedAt: job.updatedAt,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[jobs:id] failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch job status." },
      { status: 500 }
    );
  }
}
