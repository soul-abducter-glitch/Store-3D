import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const DEFAULT_MOCK_MODEL_URL =
  "https://modelviewer.dev/shared-assets/models/Astronaut.glb";

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

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
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
        status: mockEnabled ? "processing" : "queued",
        mode,
        provider,
        progress: mockEnabled ? 20 : 5,
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
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to create AI generation job.",
      },
      { status: 500 }
    );
  }
}

