import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { normalizePipelineJobs, normalizeVersionLabel } from "@/lib/aiAssetPipeline";
import {
  buildAiAssetVersionDiff,
  normalizeAssetFormat,
  normalizeAssetVersion,
  normalizeRelationshipId,
  resolveAiAssetFamilyId,
  resolveUserOwnsAsset,
  sortAssetsByVersion,
} from "@/lib/aiAssetVersioning";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeEmail = (value?: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

const isAdmin = (user?: any) => {
  const email = normalizeEmail(user?.email);
  if (!email) return false;
  return parseAdminEmails().includes(email);
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const serializeAsset = (asset: any) => ({
  id: String(asset?.id ?? ""),
  title: toNonEmptyString(asset?.title),
  modelUrl: toNonEmptyString(asset?.modelUrl),
  previewUrl: toNonEmptyString(asset?.previewUrl),
  format: normalizeAssetFormat(asset?.format, asset?.modelUrl),
  status: toNonEmptyString(asset?.status) || "ready",
  provider: toNonEmptyString(asset?.provider) || "mock",
  previousAssetId: (() => {
    const id = normalizeRelationshipId(asset?.previousAsset);
    return id === null ? null : String(id);
  })(),
  familyId: resolveAiAssetFamilyId(asset),
  version: normalizeAssetVersion(asset?.version, 1),
  versionLabel: normalizeVersionLabel(asset?.versionLabel),
  checks: asset?.checks && typeof asset.checks === "object" ? asset.checks : null,
  splitPartSet:
    asset?.splitPartSet && typeof asset.splitPartSet === "object" ? asset.splitPartSet : null,
  pipelineJobs: normalizePipelineJobs(asset?.pipelineJobs),
  createdAt: asset?.createdAt,
  updatedAt: asset?.updatedAt,
});

const findAuthorizedAsset = async (
  payload: any,
  request: NextRequest,
  params: Promise<{ id: string }>
) => {
  const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
  const user = authResult?.user ?? null;
  const userId = normalizeRelationshipId(user?.id);
  if (!user || userId === null) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 }),
    };
  }

  const resolvedParams = await params;
  const id = resolvedParams?.id ? String(resolvedParams.id).trim() : "";
  if (!id) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Asset id is required." }, { status: 400 }),
    };
  }

  const asset = await payload
    .findByID({
      collection: "ai_assets",
      id,
      depth: 0,
      overrideAccess: true,
    })
    .catch(() => null);

  if (!asset) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Asset not found." }, { status: 404 }),
    };
  }

  if (!isAdmin(user) && !resolveUserOwnsAsset(asset, userId)) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    userId,
    asset,
  };
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const authorized = await findAuthorizedAsset(payload, request, params);
    if (!authorized.ok) return authorized.response;
    const { userId, asset } = authorized;

    const body = await request.json().catch(() => null);
    const titleSuffix = toNonEmptyString(body?.titleSuffix).slice(0, 64);

    const familyId = resolveAiAssetFamilyId(asset);
    if (!toNonEmptyString(asset?.familyId)) {
      await payload.update({
        collection: "ai_assets",
        id: asset.id,
        overrideAccess: true,
        data: {
          familyId,
          version: normalizeAssetVersion(asset?.version, 1),
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
    const family = sortAssetsByVersion(lineageDocs.length > 0 ? lineageDocs : [{ ...asset, familyId }]);
    const latestAsset = family[family.length - 1] || asset;
    const nextVersion = normalizeAssetVersion(latestAsset?.version, 1) + 1;
    const sourceVersion = normalizeAssetVersion(asset?.version, 1);

    const rollbackChecks = {
      ...(asset?.checks && typeof asset.checks === "object" ? asset.checks : {}),
      rollback: {
        at: new Date().toISOString(),
        fromAssetId: String(asset.id),
        fromVersion: sourceVersion,
        appliedToVersion: nextVersion,
      },
    };
    const sourceRepairLogs = Array.isArray(asset?.repairLogs) ? asset.repairLogs : [];
    const rollbackLog = {
      at: new Date().toISOString(),
      operation: "rollback",
      fromAssetId: String(asset.id),
      fromVersion: sourceVersion,
      appliedToVersion: nextVersion,
    };
    const nextRepairLogs = [...sourceRepairLogs, rollbackLog].slice(-30);

    const createdTitleBase = toNonEmptyString(asset?.title) || "AI Model";
    const createdTitle = titleSuffix
      ? `${createdTitleBase} ${titleSuffix}`
      : `${createdTitleBase} rollback-v${nextVersion}`;

    const created = await payload.create({
      collection: "ai_assets",
      overrideAccess: true,
      data: {
        user: userId as any,
        job: normalizeRelationshipId(latestAsset?.job) ?? normalizeRelationshipId(asset?.job) ?? undefined,
        previousAsset: normalizeRelationshipId(latestAsset?.id) as any,
        familyId,
        version: nextVersion,
        versionLabel: "original",
        status: "ready",
        provider: `${toNonEmptyString(asset?.provider) || "mock"}-rollback`,
        title: createdTitle,
        prompt: toNonEmptyString(asset?.prompt) || undefined,
        sourceType:
          asset?.sourceType === "url" || asset?.sourceType === "image"
            ? asset.sourceType
            : "url",
        sourceUrl: toNonEmptyString(asset?.sourceUrl) || toNonEmptyString(asset?.modelUrl) || undefined,
        previewUrl: toNonEmptyString(asset?.previewUrl) || undefined,
        modelUrl: toNonEmptyString(asset?.modelUrl),
        format: normalizeAssetFormat(asset?.format, asset?.modelUrl),
        precheckLogs: Array.isArray(asset?.precheckLogs) ? asset.precheckLogs : undefined,
        checks: rollbackChecks,
        repairLogs: nextRepairLogs,
      },
    });

    return NextResponse.json(
      {
        success: true,
        sourceAssetId: String(asset.id),
        latestBeforeRollbackId: String(latestAsset?.id || ""),
        rolledBackAsset: serializeAsset(created),
        versionDiffFromPrevious: buildAiAssetVersionDiff(created, latestAsset),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/assets:rollback] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to rollback AI asset version.",
      },
      { status: 500 }
    );
  }
}
