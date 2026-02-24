export type AIJobStatus =
  | "queued"
  | "running"
  | "provider_pending"
  | "provider_processing"
  | "postprocessing"
  | "completed"
  | "failed"
  | "cancelled"
  | "retrying";

export type LegacyAIJobStatus = "queued" | "processing" | "completed" | "failed";

const ACTIVE_STATUSES: AIJobStatus[] = [
  "queued",
  "running",
  "provider_pending",
  "provider_processing",
  "postprocessing",
  "retrying",
];

const TERMINAL_STATUSES: AIJobStatus[] = ["completed", "failed", "cancelled"];

const toStringSafe = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const normalizeAiJobStatus = (value: unknown): AIJobStatus => {
  const raw = toStringSafe(value);
  if (raw === "running") return "running";
  if (raw === "provider_pending") return "provider_pending";
  if (raw === "provider_processing") return "provider_processing";
  if (raw === "postprocessing") return "postprocessing";
  if (raw === "completed") return "completed";
  if (raw === "failed") return "failed";
  if (raw === "cancelled" || raw === "canceled") return "cancelled";
  if (raw === "retrying") return "retrying";
  if (raw === "processing") return "provider_processing";
  return "queued";
};

export const toLegacyAiJobStatus = (value: unknown): LegacyAIJobStatus => {
  const normalized = normalizeAiJobStatus(value);
  if (normalized === "completed") return "completed";
  if (normalized === "failed" || normalized === "cancelled") return "failed";
  if (normalized === "queued") return "queued";
  return "processing";
};

export const isAiJobTerminalStatus = (value: unknown) =>
  TERMINAL_STATUSES.includes(normalizeAiJobStatus(value));

export const isAiJobActiveStatus = (value: unknown) =>
  ACTIVE_STATUSES.includes(normalizeAiJobStatus(value));

export const getAiActiveStatuses = () => [...ACTIVE_STATUSES];
