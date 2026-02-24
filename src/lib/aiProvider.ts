import { resolveRequestedAiProvider, type AiProviderName } from "@/lib/aiConfig";

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

export type ProviderCapabilities = {
  supportsTextTo3D: boolean;
  supportsImageTo3D: boolean;
  supportsCancel: boolean;
  supportsProgress: boolean;
  supportsTextureGeneration?: boolean;
  supportsRemesh?: boolean;
};

export type ProviderErrorCode =
  | "PROVIDER_AUTH_ERROR"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_VALIDATION_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_UNKNOWN";

export type NormalizedProviderError = {
  code: ProviderErrorCode;
  retryable: boolean;
  httpStatusSuggested: number;
  providerCode: string | null;
  providerMessage: string;
};

export interface AIProvider {
  name: "mock" | "meshy" | "tripo";
  capabilities: ProviderCapabilities;
  createGenerationJob(input: SubmitJobInput): Promise<ProviderJobResult>;
  getJobStatus(input: PollJobInput): Promise<ProviderJobResult>;
  getJobResult?(input: PollJobInput): Promise<ProviderJobResult>;
  cancelJob?(input: { providerJobId: string }): Promise<{ ok: boolean }>;
}

const MESHY_DEFAULT_BASE_URL = "https://api.meshy.ai/openapi/v2";
const TRIPO_DEFAULT_BASE_URL = "https://api.tripo3d.ai/v2/openapi";
const TRIPO_DEFAULT_SUBMIT_PATH = "/task";
const TRIPO_DEFAULT_POLL_TEMPLATE = "/task/{id}";

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const resolveAllowProviderFallback = () => {
  const explicit = process.env.ALLOW_PROVIDER_FALLBACK_TO_MOCK;
  if (explicit !== undefined) return parseBoolean(explicit, false);
  const legacy = process.env.AI_PROVIDER_FALLBACK_TO_MOCK;
  if (legacy !== undefined) return parseBoolean(legacy, false);
  return process.env.NODE_ENV !== "production";
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

const toProviderErrorCode = (status: number, message: string): ProviderErrorCode => {
  const normalized = message.toLowerCase();
  if (status === 401 || status === 403 || normalized.includes("unauthorized")) {
    return "PROVIDER_AUTH_ERROR";
  }
  if (status === 429 || normalized.includes("rate")) {
    return "PROVIDER_RATE_LIMIT";
  }
  if (status === 408 || status === 504 || normalized.includes("timeout")) {
    return "PROVIDER_TIMEOUT";
  }
  if (status >= 400 && status < 500) {
    return "PROVIDER_VALIDATION_ERROR";
  }
  if (status >= 500 && status < 600) {
    return "PROVIDER_UNAVAILABLE";
  }
  return "PROVIDER_UNKNOWN";
};

const getRetryableByCode = (code: ProviderErrorCode) =>
  code === "PROVIDER_RATE_LIMIT" ||
  code === "PROVIDER_TIMEOUT" ||
  code === "PROVIDER_UNAVAILABLE";

export class AIProviderError extends Error {
  normalized: NormalizedProviderError;

  constructor(message: string, normalized: NormalizedProviderError) {
    super(message);
    this.name = "AIProviderError";
    this.normalized = normalized;
  }
}

const buildNormalizedProviderError = (input: {
  code: ProviderErrorCode;
  providerCode?: unknown;
  providerMessage?: unknown;
  httpStatusSuggested?: unknown;
  retryable?: unknown;
}): NormalizedProviderError => {
  const providerMessage = toNonEmptyString(input.providerMessage) || "Provider request failed.";
  const httpStatusSuggested = Number(input.httpStatusSuggested);
  const retryable =
    typeof input.retryable === "boolean" ? input.retryable : getRetryableByCode(input.code);
  return {
    code: input.code,
    retryable,
    httpStatusSuggested: Number.isFinite(httpStatusSuggested)
      ? Math.max(400, Math.min(599, Math.trunc(httpStatusSuggested)))
      : retryable
        ? 503
        : 400,
    providerCode: toNonEmptyString(input.providerCode) || null,
    providerMessage,
  };
};

const throwNormalizedProviderError = (input: {
  status?: number;
  providerCode?: unknown;
  providerMessage?: unknown;
}): never => {
  const status = Number(input.status);
  const providerMessage = toNonEmptyString(input.providerMessage) || "Provider request failed.";
  const code = Number.isFinite(status)
    ? toProviderErrorCode(status, providerMessage)
    : providerMessage.toLowerCase().includes("timeout")
      ? "PROVIDER_TIMEOUT"
      : "PROVIDER_UNKNOWN";
  const normalized = buildNormalizedProviderError({
    code,
    providerCode: input.providerCode,
    providerMessage,
    httpStatusSuggested: Number.isFinite(status) ? status : undefined,
  });
  throw new AIProviderError(providerMessage, normalized);
};

export const normalizeProviderError = (error: unknown): NormalizedProviderError => {
  if (error instanceof AIProviderError) {
    return error.normalized;
  }
  const message = error instanceof Error ? error.message : String(error || "");
  if ((error as any)?.name === "AbortError") {
    return buildNormalizedProviderError({
      code: "PROVIDER_TIMEOUT",
      providerMessage: message || "Provider timed out.",
      httpStatusSuggested: 504,
    });
  }
  return buildNormalizedProviderError({
    code: "PROVIDER_UNKNOWN",
    providerMessage: message || "Provider request failed.",
    httpStatusSuggested: 502,
  });
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

const ensureMeshyConfigured = (): NonNullable<ReturnType<typeof buildMeshyAuthHeaders>> => {
  const headers = buildMeshyAuthHeaders();
  if (!headers) {
    throwNormalizedProviderError({
      status: 401,
      providerMessage: "Meshy API key is missing (AI_MESHY_API_KEY).",
    });
  }
  return headers as { Authorization: string; "Content-Type": string };
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
    throwNormalizedProviderError({
      status: 400,
      providerMessage: "Meshy image mode requires a public sourceUrl.",
    });
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
    throwNormalizedProviderError({
      status: response.status,
      providerMessage: providerError || `Meshy submit failed with status ${response.status}.`,
    });
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
    throwNormalizedProviderError({
      status: 502,
      providerMessage: "Meshy submit succeeded but provider job id is missing.",
    });
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
    throwNormalizedProviderError({
      status: response.status,
      providerMessage: providerError || `Meshy poll failed with status ${response.status}.`,
    });
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

const getTripoApiKey = () =>
  toNonEmptyString(process.env.AI_TRIPO_API_KEY) ||
  toNonEmptyString(process.env.TRIPO_API_KEY);

const getTripoBaseUrl = () =>
  toNonEmptyString(process.env.AI_TRIPO_BASE_URL) || TRIPO_DEFAULT_BASE_URL;

const getTripoSubmitPath = () =>
  toNonEmptyString(process.env.AI_TRIPO_SUBMIT_PATH) || TRIPO_DEFAULT_SUBMIT_PATH;

const getTripoPollTemplate = () =>
  toNonEmptyString(process.env.AI_TRIPO_POLL_TEMPLATE) || TRIPO_DEFAULT_POLL_TEMPLATE;

const buildTripoHeaders = () => {
  const key = getTripoApiKey();
  if (!key) return null;
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
};

const ensureTripoConfigured = (): NonNullable<ReturnType<typeof buildTripoHeaders>> => {
  const headers = buildTripoHeaders();
  if (!headers) {
    throwNormalizedProviderError({
      status: 401,
      providerMessage: "Tripo API key is missing (AI_TRIPO_API_KEY).",
    });
  }
  return headers as { Authorization: string; "Content-Type": string };
};

const mapTripoStatus = (rawStatus: string): ProviderJobStatus => {
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
  if (normalized.includes("queue") || normalized.includes("pending") || normalized.includes("wait")) {
    return "queued";
  }
  return "processing";
};

const resolveUrl = (baseUrl: string, path: string) => {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};

const submitTripoJob = async (input: SubmitJobInput): Promise<ProviderJobResult> => {
  if (input.mode === "image" && !toNonEmptyString(input.sourceUrl)) {
    throwNormalizedProviderError({
      status: 400,
      providerMessage: "Tripo image mode requires a public sourceUrl.",
    });
  }
  const headers = ensureTripoConfigured();
  const url = resolveUrl(getTripoBaseUrl(), getTripoSubmitPath());

  const body =
    input.mode === "text"
      ? {
          type: "text_to_model",
          prompt: input.prompt,
        }
      : {
          type: "image_to_model",
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
    throwNormalizedProviderError({
      status: response.status,
      providerMessage: providerError || `Tripo submit failed with status ${response.status}.`,
    });
  }

  const providerJobId = firstStringByPaths(data, [
    "task_id",
    "data.task_id",
    "id",
    "data.id",
    "result.task_id",
    "job_id",
  ]);
  if (!providerJobId) {
    throwNormalizedProviderError({
      status: 502,
      providerMessage: "Tripo submit succeeded but provider job id is missing.",
    });
  }

  return {
    status: "queued",
    progress: 3,
    providerJobId,
  };
};

const pollTripoJob = async (input: PollJobInput): Promise<ProviderJobResult> => {
  const headers = ensureTripoConfigured();
  const pollTemplate = getTripoPollTemplate();
  const pollPath = pollTemplate.includes("{id}")
    ? pollTemplate.replace("{id}", encodeURIComponent(input.providerJobId))
    : `${pollTemplate.replace(/\/$/, "")}/${encodeURIComponent(input.providerJobId)}`;
  const url = resolveUrl(getTripoBaseUrl(), pollPath);

  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers,
  });
  const data = await safeParseJson(response);
  if (!response.ok) {
    const providerError = firstStringByPaths(data, ["message", "error", "detail"]);
    throwNormalizedProviderError({
      status: response.status,
      providerMessage: providerError || `Tripo poll failed with status ${response.status}.`,
    });
  }

  const rawStatus = firstStringByPaths(data, ["status", "state", "task_status", "data.status"]);
  const status = mapTripoStatus(rawStatus);
  const progress = clampProgress(
    firstNumberByPaths(data, [
      "progress",
      "progress_percentage",
      "data.progress",
      "data.progress_percentage",
      "task_progress",
    ])
  );

  const providerJobId = firstStringByPaths(data, ["task_id", "id", "data.task_id", "data.id"]);

  if (status === "completed") {
    const modelUrl = firstStringByPaths(data, [
      "model_urls.glb",
      "model_urls.gltf",
      "output.model_url",
      "output.glb_url",
      "output.gltf_url",
      "result.model_url",
      "result.modelUrl",
      "data.output.model_url",
      "data.output.glb_url",
      "data.output.gltf_url",
      "data.model_url",
    ]);
    const previewUrl = firstStringByPaths(data, [
      "thumbnail_url",
      "preview_url",
      "output.preview_url",
      "output.thumbnail_url",
      "result.preview_url",
      "result.thumbnail_url",
      "data.output.preview_url",
      "data.thumbnail_url",
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
  const requestedProvider = resolveRequestedAiProvider(requested);
  if (requestedProvider === "mock") {
    return {
      requestedProvider,
      effectiveProvider: "mock",
      fallbackToMock: false,
      configured: true,
      reason: null,
    };
  }

  const configured =
    requestedProvider === "meshy" ? Boolean(getMeshyApiKey()) : Boolean(getTripoApiKey());
  const allowFallback = resolveAllowProviderFallback();
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
      reason: `${requestedProvider} API key is missing. Fallback to mock mode.`,
    };
  }

  return {
    requestedProvider,
    effectiveProvider: requestedProvider,
    fallbackToMock: false,
    configured: false,
    reason: `${requestedProvider} API key is missing.`,
  };
};

export const PROVIDER_CAPABILITIES: Record<AiProviderName, ProviderCapabilities> = {
  mock: {
    supportsTextTo3D: true,
    supportsImageTo3D: true,
    supportsCancel: false,
    supportsProgress: true,
  },
  meshy: {
    supportsTextTo3D: true,
    supportsImageTo3D: true,
    supportsCancel: false,
    supportsProgress: true,
    supportsTextureGeneration: true,
  },
  tripo: {
    supportsTextTo3D: true,
    supportsImageTo3D: true,
    supportsCancel: false,
    supportsProgress: true,
  },
};

export const submitProviderJob = async (input: SubmitJobInput): Promise<ProviderJobResult> => {
  try {
    if (input.provider === "mock") {
      return { status: "queued", progress: 5 };
    }
    if (input.provider === "meshy") {
      return submitMeshyJob(input);
    }
    if (input.provider === "tripo") {
      return submitTripoJob(input);
    }
    return { status: "queued", progress: 5 };
  } catch (error) {
    const normalized = normalizeProviderError(error);
    throw new AIProviderError(normalized.providerMessage, normalized);
  }
};

export const pollProviderJob = async (input: PollJobInput): Promise<ProviderJobResult> => {
  try {
    if (input.provider === "mock") {
      return { status: "queued", progress: 0 };
    }
    if (input.provider === "meshy") {
      return pollMeshyJob(input);
    }
    if (input.provider === "tripo") {
      return pollTripoJob(input);
    }
    return { status: "queued", progress: 0 };
  } catch (error) {
    const normalized = normalizeProviderError(error);
    throw new AIProviderError(normalized.providerMessage, normalized);
  }
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
  if (input.provider === "tripo" && input.mode === "image" && !toNonEmptyString(input.sourceUrl)) {
    return "Tripo image mode requires public sourceUrl. Falling back to mock mode.";
  }
  return null;
};
