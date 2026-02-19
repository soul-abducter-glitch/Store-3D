import {
  normalizeAssetFormat,
  normalizeAssetVersion,
  normalizeRelationshipId,
  resolveAiAssetFamilyId,
  sortAssetsByVersion,
} from "@/lib/aiAssetVersioning";
import type { AssetTopologyAnalysis } from "@/lib/aiAssetRepair";

export type AssetVersionLabel =
  | "original"
  | "fixed_safe"
  | "fixed_strong"
  | "split_set"
  | "blender_edit";

export type PipelineJobType = "analyze" | "mesh_fix" | "split" | "dcc_blender";
export type PipelineJobStatus = "queued" | "running" | "done" | "error";

export type PipelineJobRecord = {
  id: string;
  type: PipelineJobType;
  status: PipelineJobStatus;
  progress: number;
  inputVersionId: string | null;
  outputVersionId: string | null;
  partSetId: string | null;
  message: string;
  result: Record<string, unknown> | null;
  error: string | null;
  logs: string[];
  createdAt: string;
  updatedAt: string;
};

export type MeshDiagnostics = {
  status: "ok" | "warning" | "critical";
  manifold: "yes" | "no" | "unknown";
  nonManifold: boolean | "unknown";
  openEdgesCount: number | null;
  holesDetected: boolean | "unknown";
  invertedNormalsPercent: number | null;
  polycount: number | null;
  componentsCount: number | null;
  bbox: { x: number; y: number; z: number } | null;
  units: "mm" | "m" | "unknown";
  scaleSanity: "ok" | "warning" | "critical" | "unknown";
  riskScore: number;
  issues: Array<{ code: string; severity: "info" | "risk" | "critical"; message: string }>;
  analyzedAt: string;
};

const MAX_PIPELINE_JOBS = 45;
const JOB_SEPARATOR = "::";

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const asFiniteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asInt = (value: unknown) => {
  const parsed = asFiniteNumber(value);
  if (parsed === null) return null;
  return Math.trunc(parsed);
};

const normalizeJobType = (value: unknown): PipelineJobType => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "mesh_fix" || raw === "split" || raw === "dcc_blender") return raw;
  return "analyze";
};

const normalizeJobStatus = (value: unknown): PipelineJobStatus => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "running" || raw === "done" || raw === "error") return raw;
  return "queued";
};

const normalizeStringList = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => toNonEmptyString(item))
    .filter(Boolean)
    .slice(0, 20);
};

const normalizeResultObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

export const normalizeVersionLabel = (
  value: unknown,
  fallback: AssetVersionLabel = "original"
): AssetVersionLabel => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (
    raw === "original" ||
    raw === "fixed_safe" ||
    raw === "fixed_strong" ||
    raw === "split_set" ||
    raw === "blender_edit"
  ) {
    return raw;
  }
  return fallback;
};

export const createPipelineJobId = (assetId: string | number) =>
  `${String(assetId)}${JOB_SEPARATOR}${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;

export const parseAssetIdFromPipelineJobId = (jobId: string) => {
  const raw = toNonEmptyString(jobId);
  if (!raw.includes(JOB_SEPARATOR)) return "";
  return raw.split(JOB_SEPARATOR)[0]?.trim() || "";
};

export const normalizePipelineJobs = (value: unknown): PipelineJobRecord[] => {
  if (!Array.isArray(value)) return [];
  const now = new Date().toISOString();
  const normalized = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<PipelineJobRecord>;
      const id = toNonEmptyString(record.id);
      if (!id) return null;
      const createdAt = toNonEmptyString(record.createdAt) || now;
      const updatedAt = toNonEmptyString(record.updatedAt) || createdAt;
      return {
        id,
        type: normalizeJobType(record.type),
        status: normalizeJobStatus(record.status),
        progress: clamp(asInt(record.progress) ?? 0, 0, 100),
        inputVersionId: (() => {
          const value = toNonEmptyString(record.inputVersionId);
          return value || null;
        })(),
        outputVersionId: (() => {
          const value = toNonEmptyString(record.outputVersionId);
          return value || null;
        })(),
        partSetId: (() => {
          const value = toNonEmptyString(record.partSetId);
          return value || null;
        })(),
        message: toNonEmptyString(record.message),
        result: normalizeResultObject(record.result),
        error: (() => {
          const value = toNonEmptyString(record.error);
          return value || null;
        })(),
        logs: normalizeStringList(record.logs),
        createdAt,
        updatedAt,
      } satisfies PipelineJobRecord;
    })
    .filter(Boolean) as PipelineJobRecord[];

  return normalized.slice(-MAX_PIPELINE_JOBS);
};

export const upsertPipelineJob = (
  jobs: PipelineJobRecord[],
  job: PipelineJobRecord
): PipelineJobRecord[] => {
  const next = [...jobs.filter((entry) => entry.id !== job.id), job];
  next.sort((a, b) => {
    const at = new Date(a.updatedAt).getTime();
    const bt = new Date(b.updatedAt).getTime();
    if (Number.isFinite(at) && Number.isFinite(bt)) return at - bt;
    return 0;
  });
  return next.slice(-MAX_PIPELINE_JOBS);
};

export const buildPipelineJob = (input: {
  id: string;
  type: PipelineJobType;
  status: PipelineJobStatus;
  progress: number;
  inputVersionId?: string | null;
  outputVersionId?: string | null;
  partSetId?: string | null;
  message?: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
  logs?: string[];
  createdAt?: string;
  updatedAt?: string;
}): PipelineJobRecord => {
  const createdAt = toNonEmptyString(input.createdAt) || new Date().toISOString();
  const updatedAt = toNonEmptyString(input.updatedAt) || createdAt;
  return {
    id: toNonEmptyString(input.id),
    type: input.type,
    status: input.status,
    progress: clamp(Math.trunc(input.progress || 0), 0, 100),
    inputVersionId: toNonEmptyString(input.inputVersionId) || null,
    outputVersionId: toNonEmptyString(input.outputVersionId) || null,
    partSetId: toNonEmptyString(input.partSetId) || null,
    message: toNonEmptyString(input.message),
    result: input.result && typeof input.result === "object" ? input.result : null,
    error: toNonEmptyString(input.error) || null,
    logs: Array.isArray(input.logs) ? normalizeStringList(input.logs) : [],
    createdAt,
    updatedAt,
  };
};

export const buildDiagnosticsFromTopology = (
  topology: AssetTopologyAnalysis,
  asset: any
): MeshDiagnostics => {
  const hasCritical = topology.issues.some((issue) => issue.severity === "critical");
  const hasRisk = topology.issues.some((issue) => issue.severity === "risk");
  const status: MeshDiagnostics["status"] = hasCritical
    ? "critical"
    : hasRisk || topology.fixAvailable
      ? "warning"
      : "ok";

  const bboxX = asFiniteNumber((asset as any)?.checks?.mesh?.bbox?.x);
  const bboxY = asFiniteNumber((asset as any)?.checks?.mesh?.bbox?.y);
  const bboxZ = asFiniteNumber((asset as any)?.checks?.mesh?.bbox?.z);
  const bbox =
    bboxX !== null && bboxY !== null && bboxZ !== null
      ? { x: bboxX, y: bboxY, z: bboxZ }
      : null;

  const unitsRaw = toNonEmptyString((asset as any)?.checks?.mesh?.units).toLowerCase();
  const units: MeshDiagnostics["units"] =
    unitsRaw === "mm" || unitsRaw === "m" ? unitsRaw : "unknown";

  let scaleSanity: MeshDiagnostics["scaleSanity"] = "unknown";
  if (bbox) {
    const maxDim = Math.max(bbox.x, bbox.y, bbox.z);
    if (maxDim > 4000) scaleSanity = "critical";
    else if (maxDim > 1200) scaleSanity = "warning";
    else if (maxDim > 0) scaleSanity = "ok";
  }

  const polycount =
    asInt((asset as any)?.checks?.mesh?.polycount) ??
    asInt((asset as any)?.checks?.topology?.polycount) ??
    null;
  const componentsCount =
    asInt((asset as any)?.checks?.mesh?.componentsCount) ??
    asInt((asset as any)?.checks?.topology?.componentsCount) ??
    1;

  const openEdgesCount = topology.holes === true ? 1 : topology.holes === false ? 0 : null;

  return {
    status,
    manifold:
      topology.nonManifold === "unknown" ? "unknown" : topology.nonManifold ? "no" : "yes",
    nonManifold: topology.nonManifold,
    openEdgesCount,
    holesDetected: topology.holes,
    invertedNormalsPercent: null,
    polycount: polycount && polycount > 0 ? polycount : null,
    componentsCount: componentsCount && componentsCount > 0 ? componentsCount : null,
    bbox,
    units,
    scaleSanity,
    riskScore: clamp(Math.round(topology.riskScore), 0, 100),
    issues: topology.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
    })),
    analyzedAt: new Date().toISOString(),
  };
};

export const summarizeDiagnosticIssues = (diagnostics: MeshDiagnostics) => {
  if (!diagnostics.issues.length) return "No geometry issues detected.";
  return diagnostics.issues
    .slice(0, 4)
    .map((issue) => issue.message)
    .join(" ");
};

export const createDerivedAssetVersion = async (input: {
  payload: any;
  sourceAsset: any;
  userId: string | number;
  versionLabel: AssetVersionLabel;
  providerSuffix: string;
  titleSuffix: string;
  checks: Record<string, unknown>;
  splitPartSet?: Record<string, unknown> | null;
}) => {
  const { payload, sourceAsset, userId, versionLabel, providerSuffix, titleSuffix, checks } = input;
  const familyId = resolveAiAssetFamilyId(sourceAsset);

  if (!toNonEmptyString(sourceAsset?.familyId)) {
    await payload.update({
      collection: "ai_assets",
      id: sourceAsset.id,
      overrideAccess: true,
      data: {
        familyId,
        version: normalizeAssetVersion(sourceAsset?.version, 1),
      },
    });
  }

  const lineageFound = await payload.find({
    collection: "ai_assets",
    depth: 0,
    limit: 200,
    where: {
      and: [
        {
          user: {
            equals: userId as any,
          },
        },
        {
          familyId: {
            equals: familyId,
          },
        },
      ],
    },
    sort: "-createdAt",
    overrideAccess: true,
  });
  const lineageDocs = Array.isArray(lineageFound?.docs) ? lineageFound.docs : [];
  const family = sortAssetsByVersion(lineageDocs.length > 0 ? lineageDocs : [{ ...sourceAsset, familyId }]);
  const latestAsset = family[family.length - 1] || sourceAsset;
  const nextVersion = normalizeAssetVersion(latestAsset?.version, 1) + 1;

  const created = await payload.create({
    collection: "ai_assets",
    overrideAccess: true,
    data: {
        user: userId as any,
        job: normalizeRelationshipId(sourceAsset?.job) ?? undefined,
        previousAsset: normalizeRelationshipId((latestAsset as any)?.id) as any,
        familyId,
      version: nextVersion,
      versionLabel,
      status: "ready",
      provider: `${toNonEmptyString(sourceAsset?.provider) || "mock"}-${providerSuffix}`,
      title: `${toNonEmptyString(sourceAsset?.title) || "AI Model"} ${titleSuffix}`.trim(),
      prompt: toNonEmptyString(sourceAsset?.prompt) || undefined,
      sourceType:
        sourceAsset?.sourceType === "url" || sourceAsset?.sourceType === "image"
          ? sourceAsset.sourceType
          : "url",
      sourceUrl:
        toNonEmptyString(sourceAsset?.sourceUrl) || toNonEmptyString(sourceAsset?.modelUrl) || undefined,
      previewUrl: toNonEmptyString(sourceAsset?.previewUrl) || undefined,
      modelUrl: toNonEmptyString(sourceAsset?.modelUrl),
      format: normalizeAssetFormat(sourceAsset?.format, sourceAsset?.modelUrl),
      precheckLogs: Array.isArray(sourceAsset?.precheckLogs) ? sourceAsset.precheckLogs : undefined,
      checks,
      repairLogs: Array.isArray(sourceAsset?.repairLogs) ? sourceAsset.repairLogs : undefined,
      splitPartSet: input.splitPartSet || undefined,
      pipelineJobs: [],
    },
  });

  return created;
};
