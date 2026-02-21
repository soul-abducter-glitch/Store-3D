import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "@payload-config";
import {
  normalizeEmail,
  normalizeRelationshipId,
  resolveEntitlementForAccess,
  toEntitlementPublic,
} from "@/lib/digitalEntitlements";
import { issueDownloadLinkForEntitlement } from "@/lib/digitalDownloads";
import { verifyDigitalGuestToken } from "@/lib/digitalGuestTokens";
import { expirePendingGiftTransfers } from "@/lib/giftTransfers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const resolveAuthUser = async (payload: any, request: NextRequest) => {
  try {
    const auth = await payload.auth({ headers: request.headers });
    const userId = normalizeRelationshipId(auth?.user?.id);
    if (userId === null) return null;
    return {
      id: userId,
      email: normalizeEmail(auth?.user?.email),
    };
  } catch {
    return null;
  }
};

const parseBody = async (request: NextRequest) => {
  try {
    const data = await request.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
};

export async function POST(request: NextRequest) {
  const payload = await getPayloadClient();
  const user = await resolveAuthUser(payload, request);
  const body = await parseBody(request);

  const rawGuestToken =
    typeof body?.guestToken === "string"
      ? body.guestToken.trim()
      : typeof body?.token === "string"
        ? body.token.trim()
        : "";
  let guestEmail = "";
  if (rawGuestToken) {
    const verifiedGuest = verifyDigitalGuestToken(rawGuestToken);
    if (!verifiedGuest.valid) {
      return NextResponse.json(
        { success: false, error: verifiedGuest.error || "Недействительная гостевая ссылка." },
        { status: 401 }
      );
    }
    guestEmail = normalizeEmail(verifiedGuest.payload.email);
  }

  if (!user?.id && !guestEmail) {
    return NextResponse.json(
      { success: false, error: "Требуется авторизация или гостевая ссылка." },
      { status: 401 }
    );
  }

  if (user?.id) {
    await expirePendingGiftTransfers({
      payload,
      scopeWhere: { senderUser: { equals: user.id as any } },
      limit: 100,
    }).catch(() => null);
  }

  const entitlement = await resolveEntitlementForAccess({
    payload,
    entitlementId: body?.entitlementId,
    productId: body?.productId,
    variantId: typeof body?.variantId === "string" ? body.variantId : "",
    userId: user?.id ?? null,
    userEmail: user?.email ?? "",
    guestEmail,
  });

  if (!entitlement) {
    return NextResponse.json(
      { success: false, error: "Нет прав на скачивание этого файла." },
      { status: 403 }
    );
  }

  const issued = await issueDownloadLinkForEntitlement({
    payload,
    entitlement,
    request,
  });
  if (!issued.ok) {
    return NextResponse.json({ success: false, error: issued.error }, { status: issued.status });
  }

  return NextResponse.json(
    {
      success: true,
      downloadUrl: issued.downloadUrl,
      expiresAt: issued.expiresAt,
      entitlement: toEntitlementPublic(entitlement),
    },
    { status: 200 }
  );
}
