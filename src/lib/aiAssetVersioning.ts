const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

export const normalizeRelationshipId = (value: unknown): string | number | null => {
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

export const normalizeAssetVersion = (value: unknown, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
};

const inferFormatFromUrl = (value: unknown) => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (!raw) return "";
  if (raw.includes(".gltf")) return "gltf";
  if (raw.includes(".obj")) return "obj";
  if (raw.includes(".stl")) return "stl";
  if (raw.includes(".glb")) return "glb";
  return "";
};

export const normalizeAssetFormat = (value: unknown, fallbackUrl?: unknown) => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "glb" || raw === "gltf" || raw === "obj" || raw === "stl") return raw;
  const inferred = inferFormatFromUrl(fallbackUrl);
  if (inferred) return inferred;
  return "unknown";
};

export const resolveAiAssetFamilyId = (asset: any) =>
  toNonEmptyString(asset?.familyId) || String(asset?.id || "");

export const sortAssetsByVersion = <T extends { version?: unknown; createdAt?: unknown }>(assets: T[]) =>
  [...assets].sort((a, b) => {
    const av = normalizeAssetVersion(a?.version, 1);
    const bv = normalizeAssetVersion(b?.version, 1);
    if (av !== bv) return av - bv;
    const ad = new Date(String(a?.createdAt || "")).getTime();
    const bd = new Date(String(b?.createdAt || "")).getTime();
    return Number.isFinite(ad) && Number.isFinite(bd) ? ad - bd : 0;
  });

export const resolveModelBytesFromChecks = (asset: any) => {
  const direct = Number((asset as any)?.checks?.topology?.modelBytes);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
  const logs = Array.isArray((asset as any)?.precheckLogs) ? (asset as any).precheckLogs : [];
  const latest = logs.length > 0 ? logs[logs.length - 1] : null;
  const fromLog = Number((latest as any)?.modelBytes);
  if (Number.isFinite(fromLog) && fromLog > 0) return Math.trunc(fromLog);
  return null;
};

export const buildAiAssetVersionDiff = (current: any, previous: any) => {
  if (!previous) {
    return {
      formatChanged: false,
      sizeChanged: false,
      checksChanged: false,
      sourceChanged: false,
      changedKeys: [] as string[],
    };
  }

  const formatChanged =
    normalizeAssetFormat(current?.format, current?.modelUrl) !==
    normalizeAssetFormat(previous?.format, previous?.modelUrl);

  const currentSize = resolveModelBytesFromChecks(current);
  const previousSize = resolveModelBytesFromChecks(previous);
  const sizeChanged =
    currentSize !== null &&
    previousSize !== null &&
    Math.abs(currentSize - previousSize) > Math.max(1024, previousSize * 0.03);

  const currentChecks = JSON.stringify((current as any)?.checks?.topology || null);
  const previousChecks = JSON.stringify((previous as any)?.checks?.topology || null);
  const checksChanged = currentChecks !== previousChecks;

  const sourceChanged =
    toNonEmptyString(current?.sourceType) !== toNonEmptyString(previous?.sourceType) ||
    toNonEmptyString(current?.sourceUrl) !== toNonEmptyString(previous?.sourceUrl);

  const changedKeys = [
    formatChanged ? "format" : "",
    sizeChanged ? "size" : "",
    checksChanged ? "checks" : "",
    sourceChanged ? "source" : "",
  ].filter(Boolean);

  return {
    formatChanged,
    sizeChanged,
    checksChanged,
    sourceChanged,
    changedKeys,
  };
};

export const resolveUserOwnsAsset = (asset: any, userId: string | number) => {
  const ownerId = normalizeRelationshipId(asset?.user);
  return ownerId !== null && String(ownerId) === String(userId);
};
