type RepairIssueSeverity = "info" | "risk" | "critical";

export type AssetTopologyAnalysis = {
  nonManifold: boolean | "unknown";
  holes: boolean | "unknown";
  selfIntersections: boolean | "unknown";
  thinWallsRisk: "low" | "medium" | "high";
  watertight: "yes" | "no" | "unknown";
  fixAvailable: boolean;
  riskScore: number;
  modelBytes: number | null;
  contentType: string;
  issues: Array<{
    code: string;
    severity: RepairIssueSeverity;
    message: string;
  }>;
};

export type AssetRepairResult = {
  repairLog: {
    mode: "auto";
    at: string;
    appliedFixes: string[];
    skippedChecks: string[];
    warnings: string[];
  };
  estimatedGeometryChangePercent: number;
  estimatedDetailLossPercent: number;
};

const ANALYZE_TIMEOUT_MS = 9000;
const RISK_BYTES = 70 * 1024 * 1024;
const CRITICAL_BYTES = 140 * 1024 * 1024;

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const parseContentLength = (value: string | null) => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const inferFormatFromUrl = (value: string) => {
  const lower = value.toLowerCase();
  if (lower.includes(".gltf")) return "gltf";
  if (lower.includes(".obj")) return "obj";
  if (lower.includes(".stl")) return "stl";
  if (lower.includes(".glb")) return "glb";
  return "";
};

const normalizeFormat = (value: unknown, fallbackUrl?: unknown) => {
  const direct = toNonEmptyString(value).toLowerCase();
  if (direct === "glb" || direct === "gltf" || direct === "obj" || direct === "stl") return direct;
  const fromUrl = inferFormatFromUrl(toNonEmptyString(fallbackUrl));
  if (fromUrl) return fromUrl;
  return "unknown";
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const baseChecksByFormat = (
  format: string
): Pick<
  AssetTopologyAnalysis,
  "nonManifold" | "holes" | "selfIntersections" | "thinWallsRisk" | "watertight"
> => {
  if (format === "stl") {
    return {
      nonManifold: "unknown",
      holes: "unknown",
      selfIntersections: "unknown",
      thinWallsRisk: "medium",
      watertight: "unknown",
    };
  }
  if (format === "obj") {
    return {
      nonManifold: "unknown",
      holes: "unknown",
      selfIntersections: "unknown",
      thinWallsRisk: "medium",
      watertight: "unknown",
    };
  }
  if (format === "gltf" || format === "glb") {
    return {
      nonManifold: false,
      holes: false,
      selfIntersections: false,
      thinWallsRisk: "low",
      watertight: "unknown",
    };
  }
  return {
    nonManifold: "unknown",
    holes: "unknown",
    selfIntersections: "unknown",
    thinWallsRisk: "medium",
    watertight: "unknown",
  };
};

export const analyzeAiAssetTopology = async (input: {
  modelUrl: string;
  format?: string;
  precheckLogs?: unknown;
}): Promise<AssetTopologyAnalysis> => {
  const modelUrl = toNonEmptyString(input.modelUrl);
  const format = normalizeFormat(input.format, modelUrl);
  const checks = baseChecksByFormat(format);
  const issues: AssetTopologyAnalysis["issues"] = [];
  let modelBytes: number | null = null;
  let contentType = "";

  if (!modelUrl) {
    return {
      ...checks,
      fixAvailable: false,
      riskScore: 100,
      modelBytes: null,
      contentType: "",
      issues: [
        {
          code: "missing_model_url",
          severity: "critical",
          message: "Model URL is missing.",
        },
      ],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
  try {
    let response = await fetch(modelUrl, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    }).catch(() => null);

    if (!response || !response.ok || response.status === 405) {
      response = await fetch(modelUrl, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: controller.signal,
        cache: "no-store",
      }).catch(() => null);
    }

    if (!response || !response.ok) {
      issues.push({
        code: "source_unreachable",
        severity: "critical",
        message: "File source is not reachable.",
      });
      checks.holes = true;
      checks.watertight = "no";
    } else {
      contentType = toNonEmptyString(response.headers.get("content-type"));
      modelBytes = parseContentLength(response.headers.get("content-length"));
      if (
        contentType &&
        !contentType.toLowerCase().includes("model/") &&
        !contentType.toLowerCase().includes("application/octet-stream") &&
        !contentType.toLowerCase().includes("application/gltf")
      ) {
        issues.push({
          code: "unexpected_content_type",
          severity: "critical",
          message: "Content-Type does not look like a 3D model.",
        });
      }
      if (modelBytes !== null && modelBytes >= CRITICAL_BYTES) {
        issues.push({
          code: "file_size_critical",
          severity: "critical",
          message: "Model file is very large and has high processing risk.",
        });
        checks.selfIntersections = checks.selfIntersections === false ? "unknown" : checks.selfIntersections;
        checks.thinWallsRisk = "high";
      } else if (modelBytes !== null && modelBytes >= RISK_BYTES) {
        issues.push({
          code: "file_size_risk",
          severity: "risk",
          message: "Large model file, repair can be unstable.",
        });
        if (checks.thinWallsRisk === "low") checks.thinWallsRisk = "medium";
      }
    }
  } catch {
    issues.push({
      code: "analyze_fetch_error",
      severity: "risk",
      message: "Topology check used fallback mode due network error.",
    });
  } finally {
    clearTimeout(timeout);
  }

  const logs = Array.isArray(input.precheckLogs) ? input.precheckLogs : [];
  const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;
  const latestIssues = Array.isArray((latestLog as any)?.issues) ? (latestLog as any).issues : [];
  const issueCodes = latestIssues
    .map((issue: any) => toNonEmptyString(issue?.code).toLowerCase())
    .filter(Boolean);

  if (issueCodes.includes("very_low_density")) {
    checks.holes = true;
    checks.nonManifold = true;
    checks.watertight = "no";
    checks.thinWallsRisk = "high";
    issues.push({
      code: "density_critical",
      severity: "critical",
      message: "Precheck indicates open mesh or severe topology defects.",
    });
  } else if (issueCodes.includes("low_density") || issueCodes.includes("estimated_volume")) {
    if (checks.holes === false) checks.holes = "unknown";
    if (checks.watertight === "unknown") checks.watertight = "unknown";
    if (checks.thinWallsRisk === "low") checks.thinWallsRisk = "medium";
    issues.push({
      code: "density_risk",
      severity: "risk",
      message: "Precheck indicates possible non-watertight zones.",
    });
  }

  if (issueCodes.includes("thin_feature_critical")) {
    checks.thinWallsRisk = "high";
  } else if (issueCodes.includes("thin_feature_risk") && checks.thinWallsRisk === "low") {
    checks.thinWallsRisk = "medium";
  }

  const hasCritical = issues.some((issue) => issue.severity === "critical");
  const hasRisk = issues.some((issue) => issue.severity === "risk");
  const riskScore = clamp(
    (hasCritical ? 70 : 0) +
      (hasRisk ? 18 : 0) +
      (checks.thinWallsRisk === "high" ? 20 : checks.thinWallsRisk === "medium" ? 10 : 0),
    0,
    100
  );

  const fixAvailable =
    hasCritical ||
    hasRisk ||
    checks.nonManifold === true ||
    checks.holes === true ||
    checks.selfIntersections === true ||
    checks.thinWallsRisk !== "low" ||
    checks.watertight === "no";

  return {
    ...checks,
    fixAvailable,
    riskScore,
    modelBytes,
    contentType,
    issues,
  };
};

export const simulateAiAssetRepair = (
  analysis: AssetTopologyAnalysis
): AssetRepairResult => {
  const appliedFixes: string[] = [];
  const skippedChecks: string[] = [];
  const warnings: string[] = [];

  if (analysis.nonManifold === true || analysis.nonManifold === "unknown") {
    appliedFixes.push("Rebuilt manifold edges and removed dangling triangles.");
  } else {
    skippedChecks.push("non-manifold cleanup");
  }

  if (analysis.holes === true || analysis.holes === "unknown") {
    appliedFixes.push("Closed open boundaries and stitched shell gaps.");
  } else {
    skippedChecks.push("hole filling");
  }

  if (analysis.selfIntersections === true || analysis.selfIntersections === "unknown") {
    appliedFixes.push("Resolved likely self-intersection clusters.");
  } else {
    skippedChecks.push("self-intersection resolution");
  }

  if (analysis.thinWallsRisk === "high") {
    appliedFixes.push("Applied adaptive wall thickening in fragile zones.");
  } else if (analysis.thinWallsRisk === "medium") {
    appliedFixes.push("Applied conservative shell reinforcement.");
  } else {
    skippedChecks.push("thin-wall reinforcement");
  }

  if (analysis.watertight === "no") {
    appliedFixes.push("Forced watertight mesh reconstruction.");
  } else if (analysis.watertight === "unknown") {
    warnings.push("Watertight validation remains approximate in mock repair mode.");
  }

  if (appliedFixes.length === 0) {
    warnings.push("No significant geometry defects detected. Repair created a safe copy.");
  }

  const estimatedGeometryChangePercent = clamp(
    appliedFixes.length * 2.1 +
      (analysis.thinWallsRisk === "high" ? 4 : analysis.thinWallsRisk === "medium" ? 2 : 0),
    0.4,
    15
  );
  const estimatedDetailLossPercent = clamp(
    estimatedGeometryChangePercent * (analysis.thinWallsRisk === "high" ? 0.65 : 0.42),
    0.2,
    8
  );

  return {
    repairLog: {
      mode: "auto",
      at: new Date().toISOString(),
      appliedFixes,
      skippedChecks,
      warnings,
    },
    estimatedGeometryChangePercent: Number(estimatedGeometryChangePercent.toFixed(2)),
    estimatedDetailLossPercent: Number(estimatedDetailLossPercent.toFixed(2)),
  };
};
