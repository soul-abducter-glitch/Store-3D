import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { resolveProvider, submitProviderJob, validateProviderInput } from "@/lib/aiProvider";
import { runAiWorkerTick } from "@/lib/aiWorker";
import { AI_TOKEN_COST, refundUserAiCredits, spendUserAiCredits } from "@/lib/aiCredits";
import { buildAiQueueSnapshot, withAiQueueMeta } from "@/lib/aiQueue";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { checkRateLimit, resolveClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_MOCK_MODEL_URL =
  "https://modelviewer.dev/shared-assets/models/Astronaut.glb";

const getPayloadClient = async () => getPayload({ config: payloadConfig });
const GENERATE_RATE_LIMIT_MAX = (() => {
  const parsed = Number.parseInt(process.env.AI_GENERATE_RATE_LIMIT_MAX || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 12;
  return parsed;
})();
const GENERATE_RATE_LIMIT_WINDOW_MS = (() => {
  const parsed = Number.parseInt(process.env.AI_GENERATE_RATE_LIMIT_WINDOW_MS || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return 60_000;
  return parsed;
})();

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

const normalizeMode = (value: unknown): "image" | "text" => {
  if (value === "text") return "text";
  return "image";
};

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

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(authResult?.user?.id);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const rawLimit = Number(request.nextUrl.searchParams.get("limit") || 8);
    const limit = Math.max(1, Math.min(20, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 8));

    await runAiWorkerTick(payload as any, { limit });

    const found = await payload.find({
      collection: "ai_jobs",
      depth: 0,
      limit,
      sort: "-createdAt",
      where: {
        user: {
          equals: userId as any,
        },
      },
      overrideAccess: true,
    });

    const serializedJobs = Array.isArray(found?.docs) ? found.docs.map(serializeJob) : [];
    const queueSnapshot = await buildAiQueueSnapshot(payload as any);
    const jobsWithQueue = withAiQueueMeta(serializedJobs, queueSnapshot);

    return NextResponse.json(
      {
        success: true,
        jobs: jobsWithQueue,
        queueDepth: queueSnapshot.queueDepth,
        activeQueueJobs: queueSnapshot.activeCount,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/generate:list] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: toPublicError(error, "Failed to fetch AI generation jobs."),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let payloadRef: Awaited<ReturnType<typeof getPayloadClient>> | null = null;
  let chargedUserId: string | number | null = null;
  try {
    const payload = await getPayloadClient();
    payloadRef = payload;
    await ensureAiLabSchemaOnce(payload as any);
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(authResult?.user?.id);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const mode = normalizeMode(body?.mode);
    const prompt = toNonEmptyString(body?.prompt).slice(0, 800);
    const sourceUrl = toNonEmptyString(body?.sourceUrl).slice(0, 2048);
    const hasImageReference = Boolean(body?.hasImageReference);
    const sourceType = sourceUrl ? "url" : hasImageReference ? "image" : "none";

    if (!prompt && sourceType === "none") {
      return NextResponse.json(
        { success: false, error: "Prompt or reference is required." },
        { status: 400 }
      );
    }

    const rateKey = `${String(userId)}:${resolveClientIp(request.headers)}`;
    const rateResult = checkRateLimit({
      scope: "ai-generate-create",
      key: rateKey,
      max: GENERATE_RATE_LIMIT_MAX,
      windowMs: GENERATE_RATE_LIMIT_WINDOW_MS,
    });
    if (!rateResult.ok) {
      const retryAfterSec = Math.max(1, Math.ceil(rateResult.retryAfterMs / 1000));
      return NextResponse.json(
        {
          success: false,
          error: "Too many generation requests. Please retry later.",
          retryAfter: retryAfterSec,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
          },
        }
      );
    }

    const providerResolution = resolveProvider();
    if (!providerResolution.configured && !providerResolution.fallbackToMock) {
      return NextResponse.json(
        {
          success: false,
          error: providerResolution.reason || "AI provider is not configured.",
        },
        { status: 400 }
      );
    }

    let provider = providerResolution.effectiveProvider;
    let fallbackHint = providerResolution.fallbackToMock ? providerResolution.reason : null;
    const inputValidationError = validateProviderInput({
      provider,
      mode,
      prompt: prompt || "Reference import",
      sourceType: sourceType as "none" | "url" | "image",
      sourceUrl,
    });
    if (inputValidationError && provider !== "mock") {
      provider = "mock";
      fallbackHint = inputValidationError;
    }

    const chargeResult = await spendUserAiCredits(payload as any, userId, AI_TOKEN_COST, {
      reason: "spend",
      source: "ai_generate:create",
      meta: {
        mode,
        providerRequested: providerResolution.requestedProvider,
      },
    });
    if (!chargeResult.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Insufficient AI tokens. Need ${AI_TOKEN_COST}.`,
          tokensRemaining: chargeResult.remaining,
          tokenCost: AI_TOKEN_COST,
        },
        { status: 402 }
      );
    }
    chargedUserId = userId;

    const now = new Date().toISOString();
    const submission = await submitProviderJob({
      provider,
      mode,
      prompt: prompt || "Reference import",
      sourceType: sourceType as "none" | "url" | "image",
      sourceUrl,
    });

    const created = await payload.create({
      collection: "ai_jobs",
      overrideAccess: true,
      data: {
        user: userId as any,
        status: submission.status,
        mode,
        provider,
        providerJobId: submission.providerJobId || undefined,
        progress: submission.progress,
        prompt: prompt || "Reference import",
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
    const queueSnapshot = await buildAiQueueSnapshot(payload as any);
    const [jobWithQueue] = withAiQueueMeta([serializeJob(created)], queueSnapshot);

    return NextResponse.json(
      {
        success: true,
        job: jobWithQueue,
        mock: provider === "mock",
        hint: fallbackHint
          ? fallbackHint
          : provider === "mock"
            ? "MVP mock mode: status will auto-complete during polling."
            : "Provider job submitted successfully.",
        providerRequested: providerResolution.requestedProvider,
        providerEffective: provider,
        queueDepth: queueSnapshot.queueDepth,
        activeQueueJobs: queueSnapshot.activeCount,
        tokensRemaining: chargeResult.remaining,
        tokenCost: AI_TOKEN_COST,
        defaults: {
          modelUrl: process.env.AI_GENERATION_MOCK_MODEL_URL || DEFAULT_MOCK_MODEL_URL,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    if (payloadRef && chargedUserId !== null) {
      try {
        await refundUserAiCredits(payloadRef as any, chargedUserId, AI_TOKEN_COST, {
          reason: "refund",
          source: "ai_generate:create_error",
        });
      } catch (refundError) {
        console.error("[ai/generate:create] token refund failed", refundError);
      }
    }
    console.error("[ai/generate:create] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: toPublicError(error, "Failed to create AI generation job."),
      },
      { status: 500 }
    );
  }
}
