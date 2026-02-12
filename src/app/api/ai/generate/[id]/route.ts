import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const DEFAULT_MOCK_MODEL_URL =
  "https://modelviewer.dev/shared-assets/models/Astronaut.glb";

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

const maybeAdvanceMockJob = async (payload: any, job: any) => {
  const provider =
    typeof job?.provider === "string" ? job.provider.trim().toLowerCase() : "mock";
  const status = typeof job?.status === "string" ? job.status.trim().toLowerCase() : "queued";
  if (provider !== "mock") {
    return job;
  }
  if (status === "completed" || status === "failed") {
    return job;
  }

  const createdAtMs = new Date(String(job?.createdAt || Date.now())).getTime();
  const elapsedMs = Math.max(0, Date.now() - createdAtMs);
  const nextData: Record<string, unknown> = {};

  if (elapsedMs >= 6200) {
    const modelUrl = process.env.AI_GENERATION_MOCK_MODEL_URL || DEFAULT_MOCK_MODEL_URL;
    nextData.status = "completed";
    nextData.progress = 100;
    nextData.completedAt = new Date().toISOString();
    nextData.result = {
      modelUrl,
      previewUrl: typeof job?.sourceUrl === "string" ? job.sourceUrl : "",
      format: modelUrl.toLowerCase().includes(".gltf") ? "gltf" : "glb",
    };
    nextData.errorMessage = "";
  } else if (elapsedMs >= 5200) {
    nextData.status = "processing";
    nextData.progress = 94;
    nextData.startedAt = job?.startedAt || new Date().toISOString();
  } else if (elapsedMs >= 4300) {
    nextData.status = "processing";
    nextData.progress = 82;
    nextData.startedAt = job?.startedAt || new Date().toISOString();
  } else if (elapsedMs >= 3200) {
    nextData.status = "processing";
    nextData.progress = 65;
    nextData.startedAt = job?.startedAt || new Date().toISOString();
  } else if (elapsedMs >= 2200) {
    nextData.status = "processing";
    nextData.progress = 45;
    nextData.startedAt = job?.startedAt || new Date().toISOString();
  } else if (elapsedMs >= 1200) {
    nextData.status = "processing";
    nextData.progress = 25;
    nextData.startedAt = job?.startedAt || new Date().toISOString();
  } else {
    nextData.status = "queued";
    nextData.progress = 8;
  }

  const updated = await payload.update({
    collection: "ai_jobs",
    id: job.id,
    data: nextData,
    overrideAccess: true,
  });
  return updated;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await getPayloadClient();
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const user = authResult?.user ?? null;
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const resolvedParams = await params;
    const id = resolvedParams?.id ? String(resolvedParams.id).trim() : "";
    if (!id) {
      return NextResponse.json({ success: false, error: "Job id is required." }, { status: 400 });
    }

    const job = await payload.findByID({
      collection: "ai_jobs",
      id,
      depth: 0,
      overrideAccess: true,
    });

    if (!job) {
      return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
    }

    if (!isOwnerOrAdmin(job, user)) {
      return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
    }

    const actualJob = await maybeAdvanceMockJob(payload, job);

    return NextResponse.json(
      {
        success: true,
        job: serializeJob(actualJob),
      },
      { status: 200 }
    );
  } catch (error: any) {
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
