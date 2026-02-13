import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { resolveProvider, submitProviderJob } from "@/lib/aiProvider";
import { runAiWorkerTick } from "@/lib/aiWorker";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const clampProgress = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

const resolveStage = (status: string, progress: number) => {
  const normalizedStatus = status.trim().toLowerCase();
  if (normalizedStatus === "failed") return "SYNTHESIS_FAILED";
  if (normalizedStatus === "completed") return "SYNTHESIS_DONE";
  if (normalizedStatus === "queued") return "QUEUE_ASSIGNMENT";
  if (progress >= 94) return "OPTICAL_SOLVER";
  if (progress >= 82) return "MATERIAL_BIND";
  if (progress >= 65) return "TOPOLOGY_SYNTH";
  if (progress >= 45) return "GENETIC_MAPPING";
  if (progress >= 25) return "PREP_INPUT";
  return "QUEUE_ASSIGNMENT";
};

const normalizeEmail = (value?: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

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

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const toPublicError = (error: unknown, fallback: string) => {
  const raw = error instanceof Error ? error.message : "";
  if (!raw) return fallback;
  if (/unauthorized/i.test(raw)) return "Unauthorized.";
  if (/forbidden/i.test(raw)) return "Forbidden.";
  if (/relation\\s+\"?.+\"?\\s+does not exist/i.test(raw)) {
    return "AI service is not initialized yet. Please try again later.";
  }
  if (/column\\s+\"?.+\"?\\s+does not exist/i.test(raw)) {
    return "AI service schema is out of date. Please contact support.";
  }
  if (/payload_locked_documents/i.test(raw)) {
    return "AI service lock table is out of sync.";
  }
  return fallback;
};

const isOwnerOrAdmin = (job: any, user: any) => {
  if (!user) return false;
  const userId = normalizeRelationshipId(user.id);
  const ownerId = normalizeRelationshipId(job?.user);
  if (userId !== null && ownerId !== null && String(userId) === String(ownerId)) {
    return true;
  }
  const userEmail = normalizeEmail(user.email);
  if (!userEmail) return false;
  return parseAdminEmails().includes(userEmail);
};

const serializeJob = (job: any) => ({
  id: String(job?.id ?? ""),
  status: typeof job?.status === "string" ? job.status : "queued",
  mode: typeof job?.mode === "string" ? job.mode : "image",
  provider: typeof job?.provider === "string" ? job.provider : "mock",
  providerJobId:
    typeof job?.providerJobId === "string" || typeof job?.providerJobId === "number"
      ? String(job.providerJobId)
      : "",
  progress: clampProgress(job?.progress),
  stage: resolveStage(
    typeof job?.status === "string" ? job.status : "queued",
    clampProgress(job?.progress)
  ),
  prompt: typeof job?.prompt === "string" ? job.prompt : "",
  sourceType: typeof job?.sourceType === "string" ? job.sourceType : "none",
  sourceUrl: typeof job?.sourceUrl === "string" ? job.sourceUrl : "",
  errorMessage: typeof job?.errorMessage === "string" ? job.errorMessage : "",
  result: {
    modelUrl: typeof job?.result?.modelUrl === "string" ? job.result.modelUrl : "",
    previewUrl: typeof job?.result?.previewUrl === "string" ? job.result.previewUrl : "",
    format: typeof job?.result?.format === "string" ? job.result.format : "unknown",
  },
  createdAt: job?.createdAt,
  updatedAt: job?.updatedAt,
  startedAt: job?.startedAt,
  completedAt: job?.completedAt,
});

const findAuthorizedJob = async (
  payload: any,
  request: NextRequest,
  params: Promise<{ id: string }>
) => {
  const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
  const user = authResult?.user ?? null;
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 }),
    };
  }

  const resolvedParams = await params;
  const id = resolvedParams?.id ? String(resolvedParams.id).trim() : "";
  if (!id) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Job id is required." }, { status: 400 }),
    };
  }

  const job = await payload.findByID({
    collection: "ai_jobs",
    id,
    depth: 0,
    overrideAccess: true,
  });

  if (!job) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Job not found." }, { status: 404 }),
    };
  }

  if (!isOwnerOrAdmin(job, user)) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    job,
  };
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authorized = await findAuthorizedJob(payload, request, params);
    if (!authorized.ok) return authorized.response;
    const job = authorized.job;

    await runAiWorkerTick(payload as any, { jobId: job.id, limit: 1 });
    const actualJob =
      (await payload.findByID({
        collection: "ai_jobs",
        id: job.id,
        depth: 0,
        overrideAccess: true,
      })) ?? job;

    return NextResponse.json(
      {
        success: true,
        job: serializeJob(actualJob),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/generate:id] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: toPublicError(error, "Failed to fetch AI generation job."),
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authorized = await findAuthorizedJob(payload, request, params);
    if (!authorized.ok) return authorized.response;
    const sourceJob = authorized.job;
    const now = new Date().toISOString();

    const sourceProvider = toNonEmptyString(sourceJob?.provider).toLowerCase() || "mock";
    const providerResolution = resolveProvider(sourceProvider);
    if (!providerResolution.configured && !providerResolution.fallbackToMock) {
      return NextResponse.json(
        {
          success: false,
          error: providerResolution.reason || "AI provider is not configured.",
        },
        { status: 400 }
      );
    }

    const provider = providerResolution.effectiveProvider;
    const mode = sourceJob.mode === "text" ? "text" : "image";
    const prompt =
      typeof sourceJob.prompt === "string" && sourceJob.prompt.trim()
        ? sourceJob.prompt.trim()
        : "Reference import";
    const sourceType =
      sourceJob.sourceType === "url" || sourceJob.sourceType === "image"
        ? sourceJob.sourceType
        : "none";
    const sourceUrl =
      typeof sourceJob.sourceUrl === "string" && sourceJob.sourceUrl.trim()
        ? sourceJob.sourceUrl.trim()
        : "";

    const submission = await submitProviderJob({
      provider,
      mode,
      prompt,
      sourceType,
      sourceUrl,
    });

    const created = await payload.create({
      collection: "ai_jobs",
      overrideAccess: true,
      data: {
        user: sourceJob.user,
        status: submission.status,
        mode,
        provider,
        providerJobId: submission.providerJobId || undefined,
        progress: submission.progress,
        prompt,
        sourceType,
        sourceUrl: sourceUrl || undefined,
        startedAt:
          submission.status === "processing" || submission.status === "completed" ? now : undefined,
        completedAt: submission.status === "completed" ? now : undefined,
        result: {
          modelUrl: submission.result?.modelUrl || "",
          previewUrl: submission.result?.previewUrl || "",
          format: submission.result?.format || "unknown",
        },
        errorMessage: submission.errorMessage || "",
      },
    });

    return NextResponse.json(
      {
        success: true,
        job: serializeJob(created),
        providerRequested: providerResolution.requestedProvider,
        providerEffective: provider,
        hint: providerResolution.fallbackToMock ? providerResolution.reason : null,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/generate:id:retry] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: toPublicError(error, "Failed to retry AI generation job."),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authorized = await findAuthorizedJob(payload, request, params);
    if (!authorized.ok) return authorized.response;
    const job = authorized.job;

    await payload.delete({
      collection: "ai_jobs",
      id: job.id,
      overrideAccess: true,
    });

    return NextResponse.json(
      {
        success: true,
        id: String(job.id),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/generate:id:delete] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: toPublicError(error, "Failed to delete AI generation job."),
      },
      { status: 500 }
    );
  }
}
