import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";
import { analyzeAiAssetTopology, simulateAiAssetRepair } from "@/lib/aiAssetRepair";
import { normalizePipelineJobs, normalizeVersionLabel } from "@/lib/aiAssetPipeline";
import {
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
  jobId: (() => {
    const id = normalizeRelationshipId(asset?.job);
    return id === null ? null : String(id);
  })(),
  previousAssetId: (() => {
    const id = normalizeRelationshipId(asset?.previousAsset);
    return id === null ? null : String(id);
  })(),
  familyId: resolveAiAssetFamilyId(asset),
  version: normalizeAssetVersion(asset?.version, 1),
  versionLabel: normalizeVersionLabel(asset?.versionLabel),
  checks: asset?.checks && typeof asset.checks === "object" ? asset.checks : null,
  fixAvailable: Boolean(asset?.checks?.topology?.fixAvailable),
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

const resolveRepairMode = (value: unknown): "analyze" | "repair" => {
  const raw = toNonEmptyString(value).toLowerCase();
  return raw === "repair" ? "repair" : "analyze";
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
    const { asset, userId } = authorized;

    const body = await request.json().catch(() => null);
    const mode = resolveRepairMode(body?.mode);
    const analyzedAt = new Date().toISOString();

    const topology = await analyzeAiAssetTopology({
      modelUrl: toNonEmptyString(asset?.modelUrl),
      format: asset?.format,
      precheckLogs: asset?.precheckLogs,
    });

    const updatedSourceChecks = {
      ...(asset?.checks && typeof asset.checks === "object" ? asset.checks : {}),
      topology: {
        ...topology,
        analyzedAt,
        analyzer: "mock-repair-v1",
      },
    };

    await payload.update({
      collection: "ai_assets",
      id: asset.id,
      overrideAccess: true,
      data: {
        checks: updatedSourceChecks,
      },
    });

    if (mode === "analyze") {
      return NextResponse.json(
        {
          success: true,
          mode,
          asset: serializeAsset({
            ...asset,
            checks: updatedSourceChecks,
          }),
          analysis: {
            nonManifold: topology.nonManifold,
            holes: topology.holes,
            selfIntersections: topology.selfIntersections,
            thinWallsRisk: topology.thinWallsRisk,
            watertightStatus: topology.watertight,
            fixAvailable: topology.fixAvailable,
            riskScore: topology.riskScore,
            modelBytes: topology.modelBytes,
            contentType: topology.contentType,
            issues: topology.issues,
          },
        },
        { status: 200 }
      );
    }

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
      sort: "-createdAt",
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
      overrideAccess: true,
    });
    const lineageDocs = Array.isArray(lineageFound?.docs) ? lineageFound.docs : [];
    const family = sortAssetsByVersion(
      lineageDocs.length > 0 ? lineageDocs : [{ ...asset, familyId }]
    );
    const latestAsset = family[family.length - 1] || asset;
    const nextVersion = normalizeAssetVersion(latestAsset?.version, 1) + 1;

    const repair = simulateAiAssetRepair(topology);
    const repairedAt = new Date().toISOString();
    const sourceRepairLogs = Array.isArray(asset?.repairLogs) ? asset.repairLogs : [];
    const nextRepairLogs = [
      ...sourceRepairLogs,
      {
        at: repairedAt,
        operation: "repair",
        sourceAssetId: String(asset.id),
        sourceVersion: normalizeAssetVersion(asset?.version, 1),
        mode: repair.repairLog.mode,
        appliedFixes: repair.repairLog.appliedFixes,
        skippedChecks: repair.repairLog.skippedChecks,
        warnings: repair.repairLog.warnings,
        estimatedGeometryChangePercent: repair.estimatedGeometryChangePercent,
        estimatedDetailLossPercent: repair.estimatedDetailLossPercent,
      },
    ].slice(-30);

    const repairedChecks = {
      topology: {
        ...topology,
        analyzedAt,
        repairedAt,
        analyzer: "mock-repair-v1",
        fixAvailable: false,
      },
      repair: {
        sourceAssetId: String(asset.id),
        sourceVersion: normalizeAssetVersion(asset?.version, 1),
        estimatedGeometryChangePercent: repair.estimatedGeometryChangePercent,
        estimatedDetailLossPercent: repair.estimatedDetailLossPercent,
      },
    };

    const repairedTitleBase = toNonEmptyString(asset?.title) || "AI Model";
    const repairedTitle = `${repairedTitleBase} repair-v${nextVersion}`;
    const created = await payload.create({
      collection: "ai_assets",
      overrideAccess: true,
      data: {
        user: userId as any,
        job: normalizeRelationshipId(asset?.job) ?? undefined,
        previousAsset: normalizeRelationshipId(latestAsset?.id) as any,
        familyId,
        version: nextVersion,
        versionLabel: "fixed_safe",
        status: "ready",
        provider: `${toNonEmptyString(asset?.provider) || "mock"}-repair`,
        title: repairedTitle,
        prompt: toNonEmptyString(asset?.prompt) || undefined,
        sourceType:
          asset?.sourceType === "url" || asset?.sourceType === "image"
            ? asset.sourceType
            : "url",
        sourceUrl: toNonEmptyString(asset?.modelUrl) || toNonEmptyString(asset?.sourceUrl) || undefined,
        previewUrl: toNonEmptyString(asset?.previewUrl) || undefined,
        modelUrl: toNonEmptyString(asset?.modelUrl),
        format: normalizeAssetFormat(asset?.format, asset?.modelUrl),
        precheckLogs: Array.isArray(asset?.precheckLogs) ? asset.precheckLogs : undefined,
        checks: repairedChecks,
        repairLogs: nextRepairLogs,
      },
    });

    return NextResponse.json(
      {
        success: true,
        mode,
        sourceAssetId: String(asset.id),
        repairedAsset: serializeAsset(created),
        repairedModelUrl: toNonEmptyString(created?.modelUrl),
        repairLog: repair.repairLog,
        estimatedGeometryChangePercent: repair.estimatedGeometryChangePercent,
        estimatedDetailLossPercent: repair.estimatedDetailLossPercent,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/assets:repair] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to analyze/repair AI asset.",
      },
      { status: 500 }
    );
  }
}
