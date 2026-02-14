import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";

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

const serializeAsset = (asset: any, mediaId: string | null = null) => ({
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
    const limit = Math.max(1, Math.min(60, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 20));

    const found = await payload.find({
      collection: "ai_assets",
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

    const docs = Array.isArray(found?.docs) ? found.docs : [];
    const assets = await Promise.all(
      docs.map(async (doc) => {
        const mediaId = await findMediaIdByModelUrl(payload, toNonEmptyString(doc?.modelUrl));
        return serializeAsset(doc, mediaId);
      })
    );

    return NextResponse.json({ success: true, assets }, { status: 200 });
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

      const created = await payload.create({
        collection: "ai_assets",
        overrideAccess: true,
        data: {
          user: userId as any,
          job: jobId as any,
          status: "ready",
          provider: toNonEmptyString(job?.provider) || "mock",
          title: toNonEmptyString(body?.title) || toNonEmptyString(job?.prompt) || `AI Model #${jobId}`,
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

    const created = await payload.create({
      collection: "ai_assets",
      overrideAccess: true,
      data: {
        user: userId as any,
        status: normalizeStatus(body?.status),
        provider: toNonEmptyString(body?.provider) || "manual",
        title: toNonEmptyString(body?.title) || "AI Model",
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
