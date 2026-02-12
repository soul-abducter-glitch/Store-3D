import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
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

const toPublicError = (error: unknown, fallback: string) => {
  const raw = error instanceof Error ? error.message : "";
  if (!raw) return fallback;
  if (/unauthorized/i.test(raw)) return "Unauthorized.";
  if (/forbidden/i.test(raw)) return "Forbidden.";
  return fallback;
};

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

  const asset = await payload.findByID({
    collection: "ai_assets",
    id,
    depth: 0,
    overrideAccess: true,
  });

  if (!asset) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Asset not found." }, { status: 404 }),
    };
  }

  const ownerId = normalizeRelationshipId(asset?.user);
  if (!isAdmin(user) && (ownerId === null || String(ownerId) !== String(userId))) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    asset,
  };
};

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authorized = await findAuthorizedAsset(payload, request, params);
    if (!authorized.ok) return authorized.response;

    await payload.delete({
      collection: "ai_assets",
      id: authorized.asset.id,
      overrideAccess: true,
    });

    return NextResponse.json(
      {
        success: true,
        id: String(authorized.asset.id),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/assets:id:delete] failed", error);
    return NextResponse.json(
      { success: false, error: toPublicError(error, "Failed to delete AI asset.") },
      { status: 500 }
    );
  }
}
