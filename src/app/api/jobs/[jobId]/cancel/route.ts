import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { authorizeAiAsset } from "@/lib/aiAssetApi";
import {
  buildPipelineJob,
  normalizePipelineJobs,
  parseAssetIdFromPipelineJobId,
  upsertPipelineJob,
} from "@/lib/aiAssetPipeline";
import { transitionJob } from "@/lib/aiJobStateMachine";
import { normalizeAiJobStatus } from "@/lib/aiJobStatus";
import { releaseAiJobTokens } from "@/lib/aiTokenLifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeRelationshipId = (value: unknown): string | number | null => {
  let current: unknown = value;
  while (typeof current === "object" && current !== null) {
    current =
      (current as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (current as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (current as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
  }
  if (current === null || current === undefined) return null;
  if (typeof current === "number") return current;
  const raw = String(current).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
};

const isOwner = (doc: any, userId: string | number) => {
  const ownerId = normalizeRelationshipId(doc?.user);
  return ownerId !== null && String(ownerId) === String(userId);
};

export async function POST(
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

    const pipelineAssetId = parseAssetIdFromPipelineJobId(jobId);
    if (pipelineAssetId) {
      const authorized = await authorizeAiAsset(payload, request, pipelineAssetId);
      if (!authorized.ok) return authorized.response;

      const currentJobs = normalizePipelineJobs(authorized.asset?.pipelineJobs);
      const target = currentJobs.find((entry) => entry.id === jobId) || null;
      if (!target) {
        return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
      }

      if (target.status === "done" || target.status === "error" || target.status === "canceled") {
        return NextResponse.json(
          { success: true, canceled: false, message: "Job is already finished." },
          { status: 200 }
        );
      }

      const canceled = buildPipelineJob({
        ...target,
        status: "canceled",
        progress: Math.max(target.progress || 0, 1),
        message: "Canceled by user.",
        error: null,
        logs: [...target.logs, "Canceled by user."],
        updatedAt: new Date().toISOString(),
      });
      const jobs = upsertPipelineJob(currentJobs, canceled);

      await payload.update({
        collection: "ai_assets",
        id: authorized.asset.id,
        overrideAccess: true,
        data: {
          pipelineJobs: jobs,
        },
      });

      return NextResponse.json({ success: true, canceled: true, type: "pipeline" }, { status: 200 });
    }

    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(authResult?.user?.id);
    if (userId === null) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const job = await payload
      .findByID({
        collection: "ai_jobs",
        id: jobId,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);

    if (!job) {
      return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
    }
    if (!isOwner(job, userId)) {
      return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
    }

    const status = normalizeAiJobStatus(job?.status);
    if (status === "completed" || status === "failed" || status === "cancelled") {
      return NextResponse.json(
        { success: true, canceled: false, message: "Job is already finished." },
        { status: 200 }
      );
    }

    const cancelled = await transitionJob(payload as any, job.id, "cancelled", {
      eventType: "job.cancelled",
      actor: "user",
      errorCode: "CANCELLED_BY_USER",
      errorMessage: "Canceled by user.",
    });
    await releaseAiJobTokens(payload as any, cancelled);

    return NextResponse.json({ success: true, canceled: true, type: "generation" }, { status: 200 });
  } catch (error) {
    console.error("[jobs:cancel] failed", error);
    return NextResponse.json({ success: false, error: "Failed to cancel job." }, { status: 500 });
  }
}
