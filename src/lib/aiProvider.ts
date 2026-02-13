type AiProviderName = "mock" | "meshy";
type AiMode = "image" | "text";
type AiSourceType = "none" | "url" | "image";

type ProviderResolution = {
  requestedProvider: AiProviderName;
  effectiveProvider: AiProviderName;
  fallbackToMock: boolean;
  configured: boolean;
  reason: string | null;
};

type SubmitJobInput = {
  provider: AiProviderName;
  mode: AiMode;
  prompt: string;
  sourceType: AiSourceType;
  sourceUrl: string;
};

type PollJobInput = {
  provider: AiProviderName;
  mode: AiMode;
  sourceType: AiSourceType;
  providerJobId: string;
};

type ProviderJobStatus = "queued" | "processing" | "completed" | "failed";

type ProviderJobResult = {
  status: ProviderJobStatus;
  progress: number;
  providerJobId?: string;
  result?: {
    modelUrl: string;
    previewUrl: string;
    format: string;
  };
  errorMessage?: string;
};

const MESHY_DEFAULT_BASE_URL = "https://api.meshy.ai/openapi/v2";

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const toLower = (value: unknown) => toNonEmptyString(value).toLowerCase();

const clampProgress = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

const normalizeProviderName = (value: unknown): AiProviderName => {
  const normalized = toLower(value);
  if (normalized === "meshy") return "meshy";
  return "mock";
};

const safeParseJson = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const firstNonEmptyString = (...values: unknown[]) => {
  for (const value of values) {
    const normalized = toNonEmptyString(value);
    if (normalized) return normalized;
  }
  return "";
};

const getAtPath = (obj: unknown, path: string) => {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let current: any = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
};

const firstStringByPaths = (obj: unknown, paths: string[]) =>
  firstNonEmptyString(...paths.map((path) => getAtPath(obj, path)));

const firstNumberByPaths = (obj: unknown, paths: string[]) => {
  for (const path of paths) {
    const value = getAtPath(obj, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
};

const inferFormatFromUrl = (url: string) => {
  const normalized = url.toLowerCase();
  if (normalized.includes(".gltf")) return "gltf";
  if (normalized.includes(".obj")) return "obj";
  if (normalized.includes(".stl")) return "stl";
  if (normalized.includes(".glb")) return "glb";
  return "unknown";
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const getMeshyApiKey = () =>
  toNonEmptyString(process.env.AI_MESHY_API_KEY) ||
  toNonEmptyString(process.env.MESHY_API_KEY);

const getMeshyBaseUrl = () =>
  toNonEmptyString(process.env.AI_MESHY_BASE_URL) || MESHY_DEFAULT_BASE_URL;

const buildMeshyAuthHeaders = () => {
  const key = getMeshyApiKey();
  if (!key) return null;
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
};

const ensureMeshyConfigured = () => {
  const headers = buildMeshyAuthHeaders();
  if (!headers) {
    throw new Error("Meshy API key is missing (AI_MESHY_API_KEY).");
  }
  return headers;
};

const mapMeshyStatus = (rawStatus: string): ProviderJobStatus => {
  const normalized = rawStatus.trim().toLowerCase();
  if (!normalized) return "queued";
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("cancel")) {
    return "failed";
  }
  if (
    normalized.includes("done") ||
    normalized.includes("success") ||
    normalized.includes("complete") ||
    normalized === "succeeded"
  ) {
    return "completed";
  }
  if (normalized.includes("queue") || normalized.includes("pending")) return "queued";
  return "processing";
};

const submitMeshyJob = async (input: SubmitJobInput): Promise<ProviderJobResult> => {
  if (input.mode === "image" && !toNonEmptyString(input.sourceUrl)) {
    throw new Error("Meshy image mode requires a public sourceUrl.");
  }
  const headers = ensureMeshyConfigured();
  const baseUrl = getMeshyBaseUrl().replace(/\/$/, "");
  const endpoint = input.mode === "text" ? "text-to-3d" : "image-to-3d";
  const url = `${baseUrl}/${endpoint}`;

  const body =
    input.mode === "text"
      ? {
          mode: "preview",
          prompt: input.prompt,
        }
      : {
          mode: "preview",
          image_url: input.sourceUrl,
          prompt: input.prompt || undefined,
        };

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await safeParseJson(response);
  if (!response.ok) {
    const providerError = firstStringByPaths(data, ["message", "error", "detail"]);
    throw new Error(providerError || `Meshy submit failed with status ${response.status}.`);
  }

  const providerJobId = firstStringByPaths(data, [
    "result",
    "id",
    "task_id",
    "job_id",
    "data.id",
    "data.result",
  ]);
  if (!providerJobId) {
    throw new Error("Meshy submit succeeded but provider job id is missing.");
  }

  return {
    status: "queued",
    progress: 3,
    providerJobId,
  };
};

const pollMeshyJob = async (input: PollJobInput): Promise<ProviderJobResult> => {
  const headers = ensureMeshyConfigured();
  const baseUrl = getMeshyBaseUrl().replace(/\/$/, "");
  const endpoint = input.mode === "text" ? "text-to-3d" : "image-to-3d";
  const url = `${baseUrl}/${endpoint}/${encodeURIComponent(input.providerJobId)}`;

  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers,
  });
  const data = await safeParseJson(response);
  if (!response.ok) {
    const providerError = firstStringByPaths(data, ["message", "error", "detail"]);
    throw new Error(providerError || `Meshy poll failed with status ${response.status}.`);
  }

  const rawStatus = firstStringByPaths(data, ["status", "state", "task_status", "data.status"]);
  const status = mapMeshyStatus(rawStatus);
  const progress = clampProgress(
    firstNumberByPaths(data, [
      "progress",
      "progress_percentage",
      "progressPercent",
      "data.progress",
      "data.progress_percentage",
      "task_progress",
    ])
  );

  const providerJobId = firstStringByPaths(data, ["id", "task_id", "job_id", "data.id"]);

  if (status === "completed") {
    const modelUrl = firstStringByPaths(data, [
      "model_urls.glb",
      "model_urls.gltf",
      "model_url",
      "output.model_url",
      "output.glb_url",
      "output.gltf_url",
      "result.modelUrl",
      "result.model_url",
      "data.model_urls.glb",
      "data.model_urls.gltf",
    ]);
    const previewUrl = firstStringByPaths(data, [
      "thumbnail_url",
      "preview_url",
      "output.preview_url",
      "output.thumbnail_url",
      "data.preview_url",
      "result.previewUrl",
    ]);
    const explicitFormat = toLower(firstStringByPaths(data, ["format", "output.format", "result.format"]));
    const format = explicitFormat || inferFormatFromUrl(modelUrl || previewUrl);

    return {
      status,
      progress: 100,
      providerJobId: providerJobId || input.providerJobId,
      result: {
        modelUrl,
        previewUrl,
        format: format || "unknown",
      },
    };
  }

  if (status === "failed") {
    const errorMessage = firstStringByPaths(data, [
      "error",
      "error_message",
      "message",
      "detail",
      "data.error",
      "data.error_message",
    ]);
    return {
      status,
      progress,
      providerJobId: providerJobId || input.providerJobId,
      errorMessage: errorMessage || "Provider returned failed status.",
    };
  }

  return {
    status,
    progress,
    providerJobId: providerJobId || input.providerJobId,
  };
};

export const resolveProvider = (requested?: unknown): ProviderResolution => {
  const requestedProvider = normalizeProviderName(
    requested ?? process.env.AI_GENERATION_PROVIDER ?? "mock"
  );
  if (requestedProvider === "mock") {
    return {
      requestedProvider,
      effectiveProvider: "mock",
      fallbackToMock: false,
      configured: true,
      reason: null,
    };
  }

  const configured = Boolean(getMeshyApiKey());
  const allowFallback = parseBoolean(process.env.AI_PROVIDER_FALLBACK_TO_MOCK, true);
  if (configured) {
    return {
      requestedProvider,
      effectiveProvider: requestedProvider,
      fallbackToMock: false,
      configured: true,
      reason: null,
    };
  }

  if (allowFallback) {
    return {
      requestedProvider,
      effectiveProvider: "mock",
      fallbackToMock: true,
      configured: false,
      reason: "Provider API key is missing. Fallback to mock mode.",
    };
  }

  return {
    requestedProvider,
    effectiveProvider: requestedProvider,
    fallbackToMock: false,
    configured: false,
    reason: "Provider API key is missing.",
  };
};

export const submitProviderJob = async (input: SubmitJobInput): Promise<ProviderJobResult> => {
  if (input.provider === "mock") {
    return { status: "queued", progress: 5 };
  }
  if (input.provider === "meshy") {
    return submitMeshyJob(input);
  }
  return { status: "queued", progress: 5 };
};

export const pollProviderJob = async (input: PollJobInput): Promise<ProviderJobResult> => {
  if (input.provider === "mock") {
    return { status: "queued", progress: 0 };
  }
  if (input.provider === "meshy") {
    return pollMeshyJob(input);
  }
  return { status: "queued", progress: 0 };
};

export const normalizeProviderStatus = (value: unknown): ProviderJobStatus => {
  const normalized = toLower(value);
  if (normalized === "failed") return "failed";
  if (normalized === "completed") return "completed";
  if (normalized === "processing") return "processing";
  return "queued";
};

export const validateProviderInput = (input: SubmitJobInput): string | null => {
  if (input.provider === "meshy" && input.mode === "image" && !toNonEmptyString(input.sourceUrl)) {
    return "Meshy image mode requires public sourceUrl. Falling back to mock mode.";
  }
  return null;
};
