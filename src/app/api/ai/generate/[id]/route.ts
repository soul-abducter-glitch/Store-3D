import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const DEFAULT_MOCK_MODEL_URL =
  "https://modelviewer.dev/shared-assets/models/Astronaut.glb";

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
  progress: typeof job?.progress === "number" ? job.progress : 0,
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

  if (elapsedMs >= 3500) {
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
  } else if (elapsedMs >= 900) {
    nextData.status = "processing";
    nextData.progress = 65;
    nextData.startedAt = job?.startedAt || new Date().toISOString();
  } else {
    nextData.status = "queued";
    nextData.progress = 15;
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
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to fetch AI generation job.",
      },
      { status: 500 }
    );
  }
}

