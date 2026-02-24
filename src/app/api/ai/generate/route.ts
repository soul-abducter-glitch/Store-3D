import { type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import {
  normalizeProviderError,
  resolveProvider,
  submitProviderJob,
  validateProviderInput,
} from "@/lib/aiProvider";
import { runAiWorkerTick } from "@/lib/aiWorker";
import { AI_TOKEN_COST, getUserAiCredits } from "@/lib/aiCredits";
import { buildAiQueueSnapshot, withAiQueueMeta } from "@/lib/aiQueue";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { enforceUserAndIpQuota } from "@/lib/aiQuota";
import { resolveClientIp } from "@/lib/rateLimit";
import { aiError, aiOk } from "@/lib/aiApiContract";
import { buildAiRequestHash } from "@/lib/aiRequestHash";
import { normalizeAiJobStatus, toLegacyAiJobStatus } from "@/lib/aiJobStatus";
import { getAiQueueAdapter } from "@/lib/aiQueueAdapter";
import { createAiJobEvent } from "@/lib/aiJobEvents";
import { releaseAiJobTokens, reserveAiJobTokens } from "@/lib/aiTokenLifecycle";
import {
  canUseAiModeTier,
  getUserAiSubscriptionRecord,
  normalizeAiModeTier,
  toAiSubscriptionSummary,
} from "@/lib/aiSubscriptions";
import {
  buildProviderPromptWithGenerationProfile,
  normalizeAiGenerationProfile,
  resolveAiModeFromGenerationProfile,
  resolveGenerationTokenCost,
} from "@/lib/aiGenerationProfile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_MOCK_MODEL_URL =
  "https://modelviewer.dev/shared-assets/models/Astronaut.glb";

const getPayloadClient = async () => getPayload({ config: payloadConfig });
const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
};
const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};
const GENERATE_QUOTA = {
  userMinute: toPositiveInt(
    process.env.AI_GENERATE_LIMIT_USER_MINUTE,
    toPositiveInt(process.env.AI_GENERATE_RATE_LIMIT_MAX, 12)
  ),
  userHour: toPositiveInt(process.env.AI_GENERATE_LIMIT_USER_HOUR, 72),
  userDay: toPositiveInt(process.env.AI_GENERATE_LIMIT_USER_DAY, 220),
  ipMinute: toPositiveInt(process.env.AI_GENERATE_LIMIT_IP_MINUTE, 24),
  ipHour: toPositiveInt(process.env.AI_GENERATE_LIMIT_IP_HOUR, 220),
  ipDay: toPositiveInt(process.env.AI_GENERATE_LIMIT_IP_DAY, 720),
};
const STATUS_QUOTA = {
  userMinute: toPositiveInt(process.env.AI_STATUS_LIMIT_USER_MINUTE, 80),
  userHour: toPositiveInt(process.env.AI_STATUS_LIMIT_USER_HOUR, 1600),
  userDay: toPositiveInt(process.env.AI_STATUS_LIMIT_USER_DAY, 12000),
  ipMinute: toPositiveInt(process.env.AI_STATUS_LIMIT_IP_MINUTE, 140),
  ipHour: toPositiveInt(process.env.AI_STATUS_LIMIT_IP_HOUR, 2600),
  ipDay: toPositiveInt(process.env.AI_STATUS_LIMIT_IP_DAY, 18000),
};
const ENABLE_PROVIDER_RUNTIME_FALLBACK = parseBoolean(
  process.env.AI_PROVIDER_RUNTIME_FALLBACK_TO_MOCK,
  process.env.NODE_ENV !== "production"
);

const clampProgress = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

const resolveStage = (status: string, progress: number) => {
  const normalizedStatus = normalizeAiJobStatus(status);
  if (normalizedStatus === "failed" || normalizedStatus === "cancelled") return "SYNTHESIS_FAILED";
  if (normalizedStatus === "completed") return "SYNTHESIS_DONE";
  if (normalizedStatus === "queued") return "QUEUE_ASSIGNMENT";
  if (normalizedStatus === "postprocessing") return "OPTICAL_SOLVER";
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

type InputReference = {
  url: string;
  name?: string;
  type?: string;
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const normalizeInputReferences = (value: unknown): InputReference[] => {
  if (!Array.isArray(value)) return [];
  const normalized: InputReference[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const url = toNonEmptyString((item as { url?: unknown; sourceUrl?: unknown }).url);
    const fallbackUrl = toNonEmptyString((item as { url?: unknown; sourceUrl?: unknown }).sourceUrl);
    const name = toNonEmptyString((item as { name?: unknown }).name).slice(0, 120);
    const rawUrl = (url || fallbackUrl).slice(0, 2048);
    const resolvedUrl = rawUrl.startsWith("data:")
      ? `inline://local-image/${encodeURIComponent(name || `ref-${normalized.length + 1}`)}`
      : rawUrl;
    if (!resolvedUrl) continue;
    const type = toNonEmptyString((item as { type?: unknown; mime?: unknown }).type || (item as any).mime).slice(
      0,
      80
    );
    normalized.push({
      url: resolvedUrl,
      ...(name ? { name } : {}),
      ...(type ? { type } : {}),
    });
    if (normalized.length >= 4) break;
  }
  return normalized;
};

const pickProviderSourceUrl = (sourceUrl: string, refs: InputReference[]) => {
  if (isHttpUrl(sourceUrl)) return sourceUrl;
  const firstPublic = refs.find((ref) => isHttpUrl(ref.url));
  if (firstPublic) return firstPublic.url;
  return "";
};

const extractRelationshipId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const candidate =
      (value as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (value as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (value as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
    return normalizeRelationshipId(candidate);
  }
  return normalizeRelationshipId(value);
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

const toProviderFallbackHint = (provider: string, error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error || "");
  const safeError = raw.replace(/\s+/g, " ").trim().slice(0, 180);
  if (!safeError) return `Provider ${provider} failed. Switched to mock mode.`;
  return `Provider ${provider} failed (${safeError}). Switched to mock mode.`;
};

const getIdempotencyKey = (request: NextRequest, body: any) =>
  toNonEmptyString(
    request.headers.get("Idempotency-Key") ||
      request.headers.get("x-idempotency-key") ||
      body?.idempotencyKey
  ).slice(0, 160);

const buildCreateJobRequestHash = (input: {
  userId: string | number;
  mode: string;
  prompt: string;
  sourceUrl: string;
  sourceRefs: InputReference[];
  providerRequested: string;
  providerEffective: string;
  parentJobId: string | number | null;
  parentAssetId: string | number | null;
}) =>
  buildAiRequestHash({
    userId: String(input.userId),
    mode: input.mode,
    prompt: input.prompt,
    sourceUrl: input.sourceUrl,
    sourceRefs: input.sourceRefs,
    providerRequested: input.providerRequested,
    providerEffective: input.providerEffective,
    parentJobId: input.parentJobId === null ? null : String(input.parentJobId),
    parentAssetId: input.parentAssetId === null ? null : String(input.parentAssetId),
  });

const findDedupedJob = async (
  payload: Awaited<ReturnType<typeof getPayloadClient>>,
  userId: string | number,
  idempotencyKey: string
) => {
  if (!idempotencyKey) return null;
  const found = await payload.find({
    collection: "ai_jobs",
    depth: 0,
    limit: 1,
    sort: "-createdAt",
    where: {
      and: [
        {
          user: {
            equals: userId as any,
          },
        },
        {
          idempotencyKey: {
            equals: idempotencyKey,
          },
        },
      ],
    },
    overrideAccess: true,
  });
  return Array.isArray(found?.docs) ? found.docs[0] || null : null;
};

const serializeJob = (job: any) => ({
  id: String(job?.id ?? ""),
  statusRaw: typeof job?.status === "string" ? normalizeAiJobStatus(job.status) : "queued",
  status: toLegacyAiJobStatus(job?.status),
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
  inputRefs: normalizeInputReferences(job?.inputRefs),
  parentJobId: (() => {
    const id = extractRelationshipId(job?.parentJob);
    return id === null ? null : String(id);
  })(),
  parentAssetId: (() => {
    const id = extractRelationshipId(job?.parentAsset);
    return id === null ? null : String(id);
  })(),
  errorMessage: typeof job?.errorMessage === "string" ? job.errorMessage : "",
  errorCode: typeof job?.errorCode === "string" ? job.errorCode : "",
  reservedTokens: typeof job?.reservedTokens === "number" ? Math.max(0, Math.trunc(job.reservedTokens)) : 0,
  etaSeconds: typeof job?.etaSeconds === "number" ? Math.max(0, Math.trunc(job.etaSeconds)) : null,
  idempotencyKey: typeof job?.idempotencyKey === "string" ? job.idempotencyKey : "",
  result: {
    modelUrl: typeof job?.result?.modelUrl === "string" ? job.result.modelUrl : "",
    previewUrl: typeof job?.result?.previewUrl === "string" ? job.result.previewUrl : "",
    format: typeof job?.result?.format === "string" ? job.result.format : "unknown",
  },
  createdAt: job?.createdAt,
  updatedAt: job?.updatedAt,
  startedAt: job?.startedAt,
  completedAt: job?.completedAt,
  failedAt: job?.failedAt,
});

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(authResult?.user?.id);
    if (!userId) {
      return aiError(
        { code: "UNAUTHORIZED", message: "Unauthorized.", retryable: false },
        { status: 401 }
      );
    }

    const quota = await enforceUserAndIpQuota({
      scope: "ai-generate-status",
      userId,
      ip: resolveClientIp(request.headers),
      actionLabel: "AI status",
      ...STATUS_QUOTA,
    });
    if (!quota.ok) {
      return aiError(
        { code: "RATE_LIMITED", message: quota.message, retryable: true },
        {
          status: 429,
          headers: {
            "Retry-After": String(quota.retryAfterSec),
          },
        },
        {
          retryAfter: quota.retryAfterSec,
        }
      );
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

    return aiOk(
      {
        jobs: jobsWithQueue,
        queueDepth: queueSnapshot.queueDepth,
        activeQueueJobs: queueSnapshot.activeCount,
      },
      {
        jobs: jobsWithQueue,
        queueDepth: queueSnapshot.queueDepth,
        activeQueueJobs: queueSnapshot.activeCount,
      }
    );
  } catch (error) {
    console.error("[ai/generate:list] failed", error);
    return aiError(
      {
        code: "INTERNAL_ERROR",
        message: toPublicError(error, "Failed to fetch AI generation jobs."),
        retryable: false,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(authResult?.user?.id);
    if (!userId) {
      return aiError(
        { code: "UNAUTHORIZED", message: "Unauthorized.", retryable: false },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    const mode = normalizeMode(body?.mode);
    const generationProfile = normalizeAiGenerationProfile(body?.generationProfile);
    const aiMode = normalizeAiModeTier(body?.aiMode || resolveAiModeFromGenerationProfile(generationProfile));
    const requestedTokenCost = resolveGenerationTokenCost(AI_TOKEN_COST, generationProfile);
    const prompt = toNonEmptyString(body?.prompt).slice(0, 800);
    const providerPrompt = buildProviderPromptWithGenerationProfile(
      prompt || "Reference import",
      generationProfile
    );
    const sourceUrl = toNonEmptyString(body?.sourceUrl).slice(0, 2048);
    const parentJobId = normalizeRelationshipId(body?.parentJobId);
    const parentAssetId = normalizeRelationshipId(body?.parentAssetId);
    const sourceRefsFromBody = normalizeInputReferences(body?.sourceRefs);
    const sourceRefs = (() => {
      const next = [...sourceRefsFromBody];
      if (sourceUrl && !next.some((ref) => ref.url === sourceUrl)) {
        next.unshift({
          url: sourceUrl,
          name: "primary-reference",
        });
      }
      return next.slice(0, 4);
    })();
    const hasImageReference = Boolean(body?.hasImageReference) || sourceRefs.length > 0;
    const providerSourceUrl = pickProviderSourceUrl(sourceUrl, sourceRefs);
    const sourceType: "none" | "url" | "image" =
      providerSourceUrl ? "url" : hasImageReference ? "image" : "none";
    const idempotencyKey = getIdempotencyKey(request, body);

    if (!prompt && sourceType === "none") {
      return aiError(
        { code: "VALIDATION_ERROR", message: "Prompt or reference is required.", retryable: false },
        { status: 400 }
      );
    }

    const subscriptionRecord = await getUserAiSubscriptionRecord(payload as any, userId);
    const subscription = toAiSubscriptionSummary(subscriptionRecord);
    if (!canUseAiModeTier(aiMode, subscription?.planCode || null, subscription?.status || "incomplete")) {
      return aiError(
        {
          code: "FORBIDDEN",
          message: "AI mode pro is available only for active M/L subscription.",
          retryable: false,
        },
        { status: 403 }
      );
    }

    const quota = await enforceUserAndIpQuota({
      scope: "ai-generate-create",
      userId,
      ip: resolveClientIp(request.headers),
      actionLabel: "AI generation",
      ...GENERATE_QUOTA,
    });
    if (!quota.ok) {
      return aiError(
        { code: "RATE_LIMITED", message: quota.message, retryable: true },
        {
          status: 429,
          headers: {
            "Retry-After": String(quota.retryAfterSec),
          },
        },
        {
          retryAfter: quota.retryAfterSec,
        }
      );
    }

    const providerResolution = resolveProvider();
    if (!providerResolution.configured && !providerResolution.fallbackToMock) {
      return aiError(
        {
          code: "PROVIDER_UNAVAILABLE",
          message: providerResolution.reason || "AI provider is not configured.",
          retryable: false,
        },
        { status: 400 }
      );
    }

    let provider = providerResolution.effectiveProvider;
    let fallbackHint = providerResolution.fallbackToMock ? providerResolution.reason : null;
    const inputValidationError = validateProviderInput({
      provider,
      mode,
      prompt: providerPrompt,
      sourceType,
      sourceUrl: providerSourceUrl,
    });
    if (inputValidationError && provider !== "mock") {
      provider = "mock";
      fallbackHint = inputValidationError;
    }

    const requestHash = buildCreateJobRequestHash({
      userId,
      mode,
      prompt,
      sourceUrl: sourceUrl || providerSourceUrl,
      sourceRefs,
      providerRequested: providerResolution.requestedProvider,
      providerEffective: provider,
      parentJobId,
      parentAssetId,
    });

    const dedupedJob = await findDedupedJob(payload, userId, idempotencyKey);
    if (dedupedJob) {
      const queueSnapshot = await buildAiQueueSnapshot(payload as any);
      const [jobWithQueue] = withAiQueueMeta([serializeJob(dedupedJob)], queueSnapshot);
      return aiOk(
        {
          jobId: String(dedupedJob.id),
          status: jobWithQueue.statusRaw || jobWithQueue.status,
          etaSeconds: jobWithQueue.etaSeconds ?? null,
          deduped: true,
        },
        {
          job: jobWithQueue,
          deduped: true,
          providerRequested: providerResolution.requestedProvider,
          providerEffective: provider,
          queueDepth: queueSnapshot.queueDepth,
          activeQueueJobs: queueSnapshot.activeCount,
          tokenCost: requestedTokenCost,
        }
      );
    }

    const now = new Date().toISOString();
    let created = await payload
      .create({
        collection: "ai_jobs",
        overrideAccess: true,
        data: {
          user: userId as any,
          status: "queued",
          mode,
          provider,
          progress: 0,
          prompt: prompt || "Reference import",
          sourceType,
          sourceUrl: sourceUrl || providerSourceUrl || undefined,
          inputRefs: sourceRefs.length > 0 ? sourceRefs : undefined,
          idempotencyKey: idempotencyKey || undefined,
          requestHash,
          retryCount: 0,
          etaSeconds: null,
          reservedTokens: requestedTokenCost,
          parentJob: parentJobId ?? undefined,
          parentAsset: parentAssetId ?? undefined,
          startedAt: undefined,
          completedAt: undefined,
          failedAt: undefined,
          result: {
            modelUrl: "",
            previewUrl: "",
            format: "unknown",
          },
          errorMessage: "",
          errorCode: "",
        },
      })
      .catch(async (error) => {
        if (idempotencyKey) {
          const existing = await findDedupedJob(payload, userId, idempotencyKey);
          if (existing) return existing;
        }
        throw error;
      });

    const reserve = await reserveAiJobTokens(payload as any, created, requestedTokenCost);
    if (!reserve.ok) {
      const remaining = reserve.remaining ?? (await getUserAiCredits(payload as any, userId));
      created = await payload.update({
        collection: "ai_jobs",
        id: created.id,
        overrideAccess: true,
        data: {
          status: "failed",
          failedAt: now,
          errorCode: "INSUFFICIENT_TOKENS",
          errorMessage: `Insufficient AI tokens. Need ${requestedTokenCost}.`,
        },
      });
      return aiError(
        {
          code: "INSUFFICIENT_TOKENS",
          message: `Insufficient AI tokens. Need ${requestedTokenCost}.`,
          retryable: false,
        },
        { status: 402 },
        {
          tokensRemaining: remaining,
          tokenCost: requestedTokenCost,
          jobId: String(created.id),
        }
      );
    }

    let submission: Awaited<ReturnType<typeof submitProviderJob>>;
    try {
      submission = await submitProviderJob({
        provider,
        mode,
        prompt: providerPrompt,
        sourceType,
        sourceUrl: providerSourceUrl,
      });
    } catch (providerError) {
      if (ENABLE_PROVIDER_RUNTIME_FALLBACK && provider !== "mock") {
        const failedProvider = provider;
        provider = "mock";
        fallbackHint = toProviderFallbackHint(failedProvider, providerError);
        await createAiJobEvent(payload as any, {
          jobId: created.id,
          userId,
          eventType: "provider.fallback_to_mock",
          statusBefore: normalizeAiJobStatus(created?.status || "queued"),
          statusAfter: normalizeAiJobStatus(created?.status || "queued"),
          provider: failedProvider,
          payload: {
            reason: fallbackHint,
          },
        });
        submission = await submitProviderJob({
          provider: "mock",
          mode,
          prompt: providerPrompt,
          sourceType,
          sourceUrl: providerSourceUrl,
        });
      } else {
        const normalized = normalizeProviderError(providerError);
        const failedJob = await payload.update({
          collection: "ai_jobs",
          id: created.id,
          overrideAccess: true,
          data: {
            status: "failed",
            failedAt: new Date().toISOString(),
            errorCode: normalized.code,
            errorMessage: normalized.providerMessage,
            errorDetails: {
              providerCode: normalized.providerCode,
            },
          },
        });
        await releaseAiJobTokens(payload as any, failedJob);
        return aiError(
          {
            code: normalized.code as any,
            message: normalized.providerMessage,
            retryable: normalized.retryable,
          },
          { status: normalized.httpStatusSuggested || 502 },
          {
            jobId: String(created.id),
          }
        );
      }
    }

    const normalizedProviderStatus =
      submission.status === "failed"
        ? "failed"
        : submission.status === "completed"
          ? "completed"
          : submission.status === "processing"
            ? "provider_processing"
            : "queued";

    created = await payload.update({
      collection: "ai_jobs",
      id: created.id,
      overrideAccess: true,
      data: {
        status: normalizedProviderStatus,
        provider,
        providerJobId: submission.providerJobId || undefined,
        progress: submission.progress,
        startedAt:
          normalizedProviderStatus === "provider_processing" || normalizedProviderStatus === "completed"
            ? now
            : undefined,
        completedAt: normalizedProviderStatus === "completed" ? now : undefined,
        failedAt: normalizedProviderStatus === "failed" ? now : undefined,
        result: {
          modelUrl: submission.result?.modelUrl || "",
          previewUrl: submission.result?.previewUrl || "",
          format: submission.result?.format || "unknown",
        },
        errorMessage: submission.errorMessage || "",
        errorCode:
          normalizedProviderStatus === "failed" ? "PROVIDER_UNKNOWN" : "",
      },
    });

    if (normalizedProviderStatus === "failed") {
      await releaseAiJobTokens(payload as any, created);
    }
    await getAiQueueAdapter().enqueueJob(String(created.id));

    const queueSnapshot = await buildAiQueueSnapshot(payload as any);
    const [jobWithQueue] = withAiQueueMeta([serializeJob(created)], queueSnapshot);
    const tokensRemaining = reserve.remaining ?? (await getUserAiCredits(payload as any, userId));

    return aiOk(
      {
        jobId: String(created.id),
        status: jobWithQueue.statusRaw || jobWithQueue.status,
        etaSeconds: jobWithQueue.etaSeconds ?? null,
        deduped: false,
      },
      {
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
        tokensRemaining,
        tokenCost: requestedTokenCost,
        deduped: false,
        defaults: {
          modelUrl: process.env.AI_GENERATION_MOCK_MODEL_URL || DEFAULT_MOCK_MODEL_URL,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/generate:create] failed", error);
    return aiError(
      {
        code: "INTERNAL_ERROR",
        message: toPublicError(error, "Failed to create AI generation job."),
        retryable: false,
      },
      { status: 500 }
    );
  }
}
