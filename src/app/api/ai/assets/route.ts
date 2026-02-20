import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { normalizePipelineJobs, normalizeVersionLabel } from "@/lib/aiAssetPipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

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

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
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

const normalizeFormat = (value: unknown, fallbackUrl?: unknown) => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "glb" || raw === "gltf" || raw === "obj" || raw === "stl") return raw;
  const inferred = inferFormatFromUrl(fallbackUrl);
  if (inferred) return inferred;
  return "unknown";
};

const normalizeStatus = (value: unknown) => {
  const raw = toNonEmptyString(value).toLowerCase();
  if (raw === "archived") return "archived";
  return "ready";
};

const normalizeVersion = (value: unknown, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
};

const ASSET_TITLE_MAX = 40;

const normalizeTitle = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
};

const clampTitle = (value: string) => {
  if (!value) return "";
  return value.slice(0, ASSET_TITLE_MAX).trim();
};

const formatAutoNameStamp = (date = new Date()) => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}.${month} ${hours}:${minutes}`;
};

const extractFilenameBase = (rawUrl: unknown) => {
  const raw = toNonEmptyString(rawUrl);
  if (!raw) return "";
  const withoutQuery = raw.split("?")[0] || raw;
  const withoutHash = withoutQuery.split("#")[0] || withoutQuery;
  const parts = withoutHash.split("/");
  const last = parts[parts.length - 1] || "";
  if (!last) return "";
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last;
  }
  return decoded.replace(/\.[a-z0-9]{2,6}$/i, "");
};

const normalizeFilenameLabel = (value: string) => {
  const normalized = value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  const hasLetterOrDigit = /[a-zа-яё0-9]/i.test(normalized);
  if (!hasLetterOrDigit) return "";
  if (normalized.length < 2) return "";
  return normalized;
};

const buildPromptTitleBase = (prompt: unknown) => {
  const normalized = normalizeTitle(prompt);
  if (!normalized) return "";
  const words = normalized.split(" ").filter(Boolean).slice(0, 6);
  return words.join(" ");
};

const withVersionSuffix = (label: string, version = 1) => {
  const suffix = ` • v${Math.max(1, Math.trunc(version))}`;
  const trimmed = clampTitle(label);
  if (!trimmed) return clampTitle(`Новая модель${suffix}`);
  if ((trimmed + suffix).length <= ASSET_TITLE_MAX) return `${trimmed}${suffix}`;
  const available = Math.max(1, ASSET_TITLE_MAX - suffix.length - 1);
  return `${trimmed.slice(0, available).trim()}${suffix}`;
};

const buildAutoAssetTitle = (params: {
  prompt?: unknown;
  sourceType?: unknown;
  sourceUrl?: unknown;
  version?: number;
  now?: Date;
}) => {
  const version = Math.max(1, Math.trunc(params.version || 1));
  const promptBase = buildPromptTitleBase(params.prompt);
  if (promptBase) return withVersionSuffix(promptBase, version);

  const sourceType = toNonEmptyString(params.sourceType).toLowerCase();
  const filenameBase = normalizeFilenameLabel(extractFilenameBase(params.sourceUrl));
  if (filenameBase) return withVersionSuffix(filenameBase, version);

  const stamp = formatAutoNameStamp(params.now || new Date());
  if (sourceType === "image" || toNonEmptyString(params.sourceUrl)) {
    return withVersionSuffix(`Изображение • ${stamp}`, version);
  }
  return withVersionSuffix(`Новая модель • ${stamp}`, version);
};

const toPublicError = (error: unknown, fallback: string) => {
  const raw = error instanceof Error ? error.message : "";
  if (!raw) return fallback;
  if (/unauthorized/i.test(raw)) return "Unauthorized.";
  if (/forbidden/i.test(raw)) return "Forbidden.";
  if (/relation\\s+\"?.+\"?\\s+does not exist/i.test(raw)) {
    return "AI assets are not initialized yet. Please try again later.";
  }
  if (/column\\s+\"?.+\"?\\s+does not exist/i.test(raw)) {
    return "AI assets schema is out of date.";
  }
  return fallback;
};

const isOwner = (doc: any, userId: string | number) => {
  const ownerId = normalizeRelationshipId(doc?.user);
  return ownerId !== null && String(ownerId) === String(userId);
};

const findMediaIdByModelUrl = async (payload: any, modelUrl: string) => {
  const normalized = toNonEmptyString(modelUrl);
  if (!normalized) return null;
  try {
    const found = await payload.find({
      collection: "media",
      depth: 0,
      limit: 1,
      sort: "-createdAt",
      where: {
        url: {
          equals: normalized,
        },
      },
      overrideAccess: true,
    });
    const id = normalizeRelationshipId(found?.docs?.[0]?.id);
    return id === null ? null : String(id);
  } catch {
    return null;
  }
};

const resolveFamilyKey = (asset: any) => toNonEmptyString(asset?.familyId) || String(asset?.id || "");

const resolveModelBytesFromAsset = (asset: any) => {
  const fromChecks = Number(asset?.checks?.topology?.modelBytes);
  if (Number.isFinite(fromChecks) && fromChecks > 0) return Math.trunc(fromChecks);
  const logs = Array.isArray(asset?.precheckLogs) ? asset.precheckLogs : [];
  const latest = logs.length > 0 ? logs[logs.length - 1] : null;
  const fromLog = Number(latest?.modelBytes);
  if (Number.isFinite(fromLog) && fromLog > 0) return Math.trunc(fromLog);
  return null;
};

const buildVersionDiff = (current: any, previous: any) => {
  if (!previous) {
    return {
      formatChanged: false,
      sizeChanged: false,
      checksChanged: false,
      sourceChanged: false,
      changedKeys: [] as string[],
    };
  }

  const formatChanged = normalizeFormat(current?.format, current?.modelUrl) !== normalizeFormat(previous?.format, previous?.modelUrl);
  const currentSize = resolveModelBytesFromAsset(current);
  const previousSize = resolveModelBytesFromAsset(previous);
  const sizeChanged =
    currentSize !== null &&
    previousSize !== null &&
    Math.abs(currentSize - previousSize) > Math.max(1024, previousSize * 0.03);
  const checksChanged =
    JSON.stringify(current?.checks?.topology || null) !== JSON.stringify(previous?.checks?.topology || null);
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

const serializeAsset = (
  asset: any,
  mediaId: string | null = null,
  previousAsset: any | null = null
) => ({
  id: String(asset?.id ?? ""),
  title: typeof asset?.title === "string" ? asset.title : "",
  prompt: typeof asset?.prompt === "string" ? asset.prompt : "",
  status: typeof asset?.status === "string" ? asset.status : "ready",
  provider: typeof asset?.provider === "string" ? asset.provider : "mock",
  sourceType: typeof asset?.sourceType === "string" ? asset.sourceType : "none",
  sourceUrl: typeof asset?.sourceUrl === "string" ? asset.sourceUrl : "",
  previewUrl: typeof asset?.previewUrl === "string" ? asset.previewUrl : "",
  modelUrl: typeof asset?.modelUrl === "string" ? asset.modelUrl : "",
  format: normalizeFormat(asset?.format, asset?.modelUrl),
  mediaId,
  isInMedia: Boolean(mediaId),
  jobId: (() => {
    const id = normalizeRelationshipId(asset?.job);
    return id === null ? null : String(id);
  })(),
  previousAssetId: (() => {
    const id = normalizeRelationshipId(asset?.previousAsset);
    return id === null ? null : String(id);
  })(),
  familyId: toNonEmptyString(asset?.familyId),
  version: normalizeVersion(asset?.version, 1),
  versionLabel: normalizeVersionLabel(asset?.versionLabel),
  checks:
    asset?.checks && typeof asset.checks === "object" ? asset.checks : null,
  fixAvailable: Boolean(asset?.checks?.topology?.fixAvailable),
  repairLogs: Array.isArray(asset?.repairLogs) ? asset.repairLogs : [],
  splitPartSet:
    asset?.splitPartSet && typeof asset.splitPartSet === "object" ? asset.splitPartSet : null,
  pipelineJobs: normalizePipelineJobs(asset?.pipelineJobs),
  lastRepairAt: (() => {
    const logs = Array.isArray(asset?.repairLogs) ? asset.repairLogs : [];
    const latest = logs.length > 0 ? logs[logs.length - 1] : null;
    const at = toNonEmptyString(latest?.at);
    return at || null;
  })(),
  versionDiff: buildVersionDiff(asset, previousAsset),
  createdAt: asset?.createdAt,
  updatedAt: asset?.updatedAt,
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

    const rawLimit = Number(request.nextUrl.searchParams.get("limit") || 20);
    const versionsView = request.nextUrl.searchParams.get("versions") === "all" ? "all" : "latest";
    const limit = Math.max(1, Math.min(60, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 20));
    const queryLimit =
      versionsView === "all" ? limit : Math.min(240, Math.max(limit * 4, 120));

    const found = await payload.find({
      collection: "ai_assets",
      depth: 0,
      limit: queryLimit,
      sort: "-createdAt",
      where: {
        user: {
          equals: userId as any,
        },
      },
      overrideAccess: true,
    });

    const docs = Array.isArray(found?.docs) ? found.docs : [];
    const docsById = new Map<string, any>();
    docs.forEach((doc) => {
      const id = normalizeRelationshipId(doc?.id);
      if (id !== null) docsById.set(String(id), doc);
    });

    const familyMap = new Map<string, any[]>();
    docs.forEach((doc) => {
      const familyKey = resolveFamilyKey(doc);
      if (!familyMap.has(familyKey)) familyMap.set(familyKey, []);
      familyMap.get(familyKey)?.push(doc);
    });
    familyMap.forEach((items) => {
      items.sort((a, b) => normalizeVersion(a?.version, 1) - normalizeVersion(b?.version, 1));
    });

    let selectedDocs: any[] = [];
    if (versionsView === "all") {
      selectedDocs = docs.slice(0, limit);
    } else {
      const latestByFamily = new Map<string, any>();
      docs.forEach((doc) => {
        const familyKey = resolveFamilyKey(doc);
        const existing = latestByFamily.get(familyKey);
        if (!existing) {
          latestByFamily.set(familyKey, doc);
          return;
        }
        const docVersion = normalizeVersion(doc?.version, 1);
        const existingVersion = normalizeVersion(existing?.version, 1);
        if (docVersion > existingVersion) {
          latestByFamily.set(familyKey, doc);
          return;
        }
        if (docVersion === existingVersion) {
          const docTime = new Date(String(doc?.createdAt || 0)).getTime();
          const existingTime = new Date(String(existing?.createdAt || 0)).getTime();
          if (Number.isFinite(docTime) && Number.isFinite(existingTime) && docTime > existingTime) {
            latestByFamily.set(familyKey, doc);
          }
        }
      });

      selectedDocs = Array.from(latestByFamily.values())
        .sort((a, b) => {
          const at = new Date(String(a?.createdAt || 0)).getTime();
          const bt = new Date(String(b?.createdAt || 0)).getTime();
          if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
          return 0;
        })
        .slice(0, limit);
    }

    const assets = await Promise.all(
      selectedDocs.map(async (doc) => {
        const previousAssetId = normalizeRelationshipId(doc?.previousAsset);
        let previousAsset = previousAssetId !== null ? docsById.get(String(previousAssetId)) || null : null;
        if (!previousAsset) {
          const family = familyMap.get(resolveFamilyKey(doc)) || [];
          const version = normalizeVersion(doc?.version, 1);
          if (version > 1) {
            previousAsset =
              family.find((entry) => normalizeVersion(entry?.version, 1) === version - 1) || null;
          }
        }
        const mediaId = await findMediaIdByModelUrl(payload, toNonEmptyString(doc?.modelUrl));
        return serializeAsset(doc, mediaId, previousAsset);
      })
    );

    return NextResponse.json({ success: true, assets, versionsView }, { status: 200 });
  } catch (error) {
    console.error("[ai/assets:list] failed", error);
    return NextResponse.json(
      { success: false, error: toPublicError(error, "Failed to fetch AI assets.") },
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
    const jobId = normalizeRelationshipId(body?.jobId);

    if (jobId !== null) {
      const job = await payload.findByID({
        collection: "ai_jobs",
        id: jobId as any,
        depth: 0,
        overrideAccess: true,
      });

      if (!job || !isOwner(job, userId)) {
        return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
      }

      const modelUrl = toNonEmptyString(job?.result?.modelUrl);
      if (!modelUrl) {
        return NextResponse.json(
          { success: false, error: "Job result is not ready yet." },
          { status: 400 }
        );
      }

      const requestedPreviousAssetId =
        normalizeRelationshipId(body?.previousAssetId) ?? normalizeRelationshipId(job?.parentAsset);
      const requestedFamilyId = toNonEmptyString(body?.familyId).slice(0, 120);
      let previousAsset: any = null;
      if (requestedPreviousAssetId !== null) {
        previousAsset = await payload
          .findByID({
            collection: "ai_assets",
            id: requestedPreviousAssetId as any,
            depth: 0,
            overrideAccess: true,
          })
          .catch(() => null);
        if (!previousAsset || !isOwner(previousAsset, userId)) {
          return NextResponse.json(
            { success: false, error: "Previous asset not found." },
            { status: 404 }
          );
        }
      }
      const forceNewVersion = Boolean(previousAsset) || Boolean(requestedFamilyId);

      if (!forceNewVersion) {
        const existing = await payload.find({
          collection: "ai_assets",
          depth: 0,
          limit: 1,
          sort: "-createdAt",
          where: {
            and: [
              {
                user: {
                  equals: userId as any,
                },
              },
              {
                job: {
                  equals: jobId as any,
                },
              },
            ],
          },
          overrideAccess: true,
        });

        const first = existing?.docs?.[0];
        if (first) {
          return NextResponse.json(
            {
              success: true,
              created: false,
              asset: serializeAsset(first),
            },
            { status: 200 }
          );
        }
      }

      const familyId =
        toNonEmptyString(previousAsset?.familyId) ||
        (previousAsset ? String(previousAsset.id) : requestedFamilyId);
      const version = previousAsset ? normalizeVersion(previousAsset?.version, 1) + 1 : 1;
      const explicitTitle = clampTitle(normalizeTitle(body?.title));
      const autoTitle = buildAutoAssetTitle({
        prompt: job?.prompt,
        sourceType: job?.sourceType,
        sourceUrl: job?.sourceUrl,
        version,
      });

      const created = await payload.create({
        collection: "ai_assets",
        overrideAccess: true,
        data: {
          user: userId as any,
          job: jobId as any,
          status: "ready",
          provider: toNonEmptyString(job?.provider) || "mock",
          title: explicitTitle || autoTitle,
          prompt: toNonEmptyString(job?.prompt),
          sourceType:
            job?.sourceType === "url" || job?.sourceType === "image" ? job.sourceType : "none",
          sourceUrl: toNonEmptyString(job?.sourceUrl) || undefined,
          previewUrl: toNonEmptyString(job?.result?.previewUrl) || undefined,
          modelUrl,
          format: normalizeFormat(job?.result?.format, modelUrl),
          previousAsset: previousAsset ? (previousAsset.id as any) : undefined,
          familyId: familyId || undefined,
          version,
          versionLabel: "original",
        },
      });

      const finalized = !familyId
        ? await payload.update({
            collection: "ai_assets",
            id: created.id,
            overrideAccess: true,
            data: {
              familyId: String(created.id),
              version: 1,
            },
          })
        : created;

      return NextResponse.json(
        {
          success: true,
          created: true,
          asset: serializeAsset(finalized),
        },
        { status: 201 }
      );
    }

    const modelUrl = toNonEmptyString(body?.modelUrl);
    if (!modelUrl) {
      return NextResponse.json(
        { success: false, error: "modelUrl is required." },
        { status: 400 }
      );
    }

    const requestedPreviousAssetId = normalizeRelationshipId(body?.previousAssetId);
    let previousAsset: any = null;
    if (requestedPreviousAssetId !== null) {
      previousAsset = await payload
        .findByID({
          collection: "ai_assets",
          id: requestedPreviousAssetId as any,
          depth: 0,
          overrideAccess: true,
        })
        .catch(() => null);
      if (!previousAsset || !isOwner(previousAsset, userId)) {
        return NextResponse.json(
          { success: false, error: "Previous asset not found." },
          { status: 404 }
        );
      }
    }
    const requestedFamilyId = toNonEmptyString(body?.familyId).slice(0, 120);
    const familyId =
      toNonEmptyString(previousAsset?.familyId) || (previousAsset ? String(previousAsset.id) : requestedFamilyId);
    const version = previousAsset ? normalizeVersion(previousAsset?.version, 1) + 1 : 1;
    const explicitTitle = clampTitle(normalizeTitle(body?.title));
    const autoTitle = buildAutoAssetTitle({
      prompt: body?.prompt,
      sourceType: body?.sourceType,
      sourceUrl: body?.sourceUrl,
      version,
    });

    const created = await payload.create({
      collection: "ai_assets",
      overrideAccess: true,
      data: {
        user: userId as any,
        status: normalizeStatus(body?.status),
        provider: toNonEmptyString(body?.provider) || "manual",
        title: explicitTitle || autoTitle,
        prompt: toNonEmptyString(body?.prompt) || undefined,
        sourceType:
          body?.sourceType === "url" || body?.sourceType === "image" ? body.sourceType : "none",
        sourceUrl: toNonEmptyString(body?.sourceUrl) || undefined,
        previewUrl: toNonEmptyString(body?.previewUrl) || undefined,
        modelUrl,
        format: normalizeFormat(body?.format, modelUrl),
        previousAsset: previousAsset ? (previousAsset.id as any) : undefined,
        familyId: familyId || undefined,
        version,
        versionLabel: "original",
      },
    });

    const finalized = !familyId
      ? await payload.update({
          collection: "ai_assets",
          id: created.id,
          overrideAccess: true,
          data: {
            familyId: String(created.id),
            version: 1,
          },
        })
      : created;

    return NextResponse.json(
      {
        success: true,
        created: true,
        asset: serializeAsset(finalized),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[ai/assets:create] failed", error);
    return NextResponse.json(
      { success: false, error: toPublicError(error, "Failed to save AI asset.") },
      { status: 500 }
    );
  }
}
