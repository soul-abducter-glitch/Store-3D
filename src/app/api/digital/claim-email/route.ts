import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "@payload-config";
import { claimEmailEntitlementsForUser, normalizeEmail, normalizeRelationshipId } from "@/lib/digitalEntitlements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

export async function POST(request: NextRequest) {
  const payload = await getPayloadClient();
  try {
    const auth = await payload.auth({ headers: request.headers });
    const userId = normalizeRelationshipId(auth?.user?.id);
    const email = normalizeEmail(auth?.user?.email);
    if (userId === null || !email) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const result = await claimEmailEntitlementsForUser({
      payload,
      userId,
      email,
    });

    return NextResponse.json({ success: true, claimed: result.claimed }, { status: 200 });
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }
}
