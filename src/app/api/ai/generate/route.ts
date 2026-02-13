import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { runAiWorkerTick } from "@/lib/aiWorker";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";

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

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
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

    return NextResponse.json(
      {
        success: true,
        jobs: Array.isArray(found?.docs) ? found.docs.map(serializeJob) : [],
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
  try {
    const payload = await getPayloadClient();
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
        { success: false, error: "Prompt или референс обязательны." },
        { status: 400 }
      );
    }

    const provider = toNonEmptyString(process.env.AI_GENERATION_PROVIDER).toLowerCase() || "mock";
    const mockEnabled = parseBoolean(process.env.AI_GENERATION_MOCK_ENABLED, true);
    const now = new Date().toISOString();

    const created = await payload.create({
      collection: "ai_jobs",
      overrideAccess: true,
      data: {
        user: userId as any,
        status: "queued",
        mode,
        provider,
        progress: 5,
        prompt: prompt || "Reference import",
        sourceType,
        sourceUrl: sourceUrl || undefined,
        startedAt: mockEnabled ? now : undefined,
        result: {
          modelUrl: "",
          previewUrl: "",
          format: "unknown",
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        job: serializeJob(created),
        mock: mockEnabled,
        hint: mockEnabled
          ? "MVP mock mode: статус завершится автоматически при запросе статуса."
          : "Провайдер не подключен. Задача поставлена в очередь.",
        defaults: {
          modelUrl: process.env.AI_GENERATION_MOCK_MODEL_URL || DEFAULT_MOCK_MODEL_URL,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
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
