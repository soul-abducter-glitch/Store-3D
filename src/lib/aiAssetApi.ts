import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeRelationshipId,
  resolveAiAssetFamilyId,
  resolveUserOwnsAsset,
} from "@/lib/aiAssetVersioning";
import {
  normalizePipelineJobs,
  type PipelineJobRecord,
  upsertPipelineJob,
} from "@/lib/aiAssetPipeline";

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

export type AuthorizedAiAsset =
  | {
      ok: true;
      user: any;
      userId: string | number;
      asset: any;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export const authorizeAiAsset = async (
  payload: any,
  request: NextRequest,
  assetIdRaw: string
): Promise<AuthorizedAiAsset> => {
  const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
  const user = authResult?.user ?? null;
  const userId = normalizeRelationshipId(user?.id);
  if (!user || userId === null) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 }),
    };
  }

  const assetId = toNonEmptyString(assetIdRaw);
  if (!assetId) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Asset id is required." }, { status: 400 }),
    };
  }

  const asset = await payload
    .findByID({
      collection: "ai_assets",
      id: assetId,
      depth: 0,
      overrideAccess: true,
    })
    .catch(() => null);

  if (!asset) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Asset not found." }, { status: 404 }),
    };
  }

  if (!isAdmin(user) && !resolveUserOwnsAsset(asset, userId)) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 }),
    };
  }

  return {
    ok: true,
    user,
    userId,
    asset,
  };
};

export const resolveOwnedAssetVersion = async (input: {
  payload: any;
  userId: string | number;
  fallbackAsset: any;
  requestedVersionId?: unknown;
}) => {
  const requestedVersionId = toNonEmptyString(input.requestedVersionId);
  if (!requestedVersionId || requestedVersionId === String(input.fallbackAsset?.id)) {
    return input.fallbackAsset;
  }

  const requestedAsset = await input.payload
    .findByID({
      collection: "ai_assets",
      id: requestedVersionId,
      depth: 0,
      overrideAccess: true,
    })
    .catch(() => null);
  if (!requestedAsset) {
    throw new Error("Requested version was not found.");
  }
  if (!resolveUserOwnsAsset(requestedAsset, input.userId)) {
    throw new Error("Requested version does not belong to current user.");
  }

  const baseFamilyId = resolveAiAssetFamilyId(input.fallbackAsset);
  const requestedFamilyId = resolveAiAssetFamilyId(requestedAsset);
  if (baseFamilyId && requestedFamilyId && baseFamilyId !== requestedFamilyId) {
    throw new Error("Requested version belongs to a different asset family.");
  }

  return requestedAsset;
};

export const savePipelineJobForAsset = async (
  payload: any,
  asset: any,
  job: PipelineJobRecord
) => {
  const current = normalizePipelineJobs(asset?.pipelineJobs);
  const next = upsertPipelineJob(current, job);
  const updated = await payload.update({
    collection: "ai_assets",
    id: asset.id,
    overrideAccess: true,
    data: {
      pipelineJobs: next,
    },
  });
  return {
    updatedAsset: updated,
    jobs: next,
  };
};

export const resolvePipelineJobFromAsset = (asset: any, jobId: string) => {
  const id = toNonEmptyString(jobId);
  if (!id) return null;
  const jobs = normalizePipelineJobs(asset?.pipelineJobs);
  return jobs.find((entry) => entry.id === id) || null;
};
