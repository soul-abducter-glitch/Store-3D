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

const normalizeAssetName = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
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

    const resolvedFamilyId =
      typeof authorized.asset?.familyId === "string" && authorized.asset.familyId.trim()
        ? authorized.asset.familyId.trim()
        : String(authorized.asset.id);
    const descendantsFound = await payload.find({
      collection: "ai_assets",
      depth: 0,
      limit: 200,
      where: {
        and: [
          {
            user: {
              equals: normalizeRelationshipId(authorized.asset?.user) as any,
            },
          },
          {
            familyId: {
              equals: resolvedFamilyId,
            },
          },
        ],
      },
      overrideAccess: true,
    });
    const familyDocs = Array.isArray(descendantsFound?.docs) ? descendantsFound.docs : [];
    const children = familyDocs.filter((doc) => {
      const previousId = normalizeRelationshipId(doc?.previousAsset);
      return previousId !== null && String(previousId) === String(authorized.asset.id);
    });

    const requireConfirm = children.length > 0;
    const confirmChainDeleteRaw =
      request.nextUrl.searchParams.get("confirmChainDelete") ||
      request.headers.get("x-confirm-chain-delete") ||
      "";
    const confirmChainDelete = ["1", "true", "yes", "on"].includes(
      String(confirmChainDeleteRaw).trim().toLowerCase()
    );

    if (requireConfirm && !confirmChainDelete) {
      return NextResponse.json(
        {
          success: false,
          code: "chain_confirmation_required",
          error:
            "This asset is a parent in a version chain. Confirm deletion to relink child versions.",
          descendants: children.length,
        },
        { status: 409 }
      );
    }

    if (children.length > 0) {
      const fallbackPrevious = normalizeRelationshipId(authorized.asset?.previousAsset);
      await Promise.all(
        children.map((child) =>
          payload.update({
            collection: "ai_assets",
            id: child.id,
            overrideAccess: true,
            data: {
              previousAsset: fallbackPrevious !== null ? (fallbackPrevious as any) : null,
            },
          })
        )
      );
    }

    await payload.delete({
      collection: "ai_assets",
      id: authorized.asset.id,
      overrideAccess: true,
    });

    return NextResponse.json(
      {
        success: true,
        id: String(authorized.asset.id),
        chainRelinked: children.length,
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authorized = await findAuthorizedAsset(payload, request, params);
    if (!authorized.ok) return authorized.response;

    const body = await request.json().catch(() => null);
    const name = normalizeAssetName(body?.name);
    if (!name) {
      return NextResponse.json(
        { success: false, error: "Введите название." },
        { status: 400 }
      );
    }
    if (name.length < 2) {
      return NextResponse.json(
        { success: false, error: "Название должно быть не короче 2 символов." },
        { status: 400 }
      );
    }
    if (name.length > 40) {
      return NextResponse.json(
        { success: false, error: "Название должно быть не длиннее 40 символов." },
        { status: 400 }
      );
    }

    const updated = await payload.update({
      collection: "ai_assets",
      id: authorized.asset.id,
      overrideAccess: true,
      data: {
        title: name,
      },
    });

    return NextResponse.json(
      {
        success: true,
        asset: {
          id: String(updated?.id ?? authorized.asset.id),
          title: typeof updated?.title === "string" ? updated.title : name,
          updatedAt: updated?.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/assets:id:patch] failed", error);
    return NextResponse.json(
      { success: false, error: toPublicError(error, "Failed to rename AI asset.") },
      { status: 500 }
    );
  }
}
