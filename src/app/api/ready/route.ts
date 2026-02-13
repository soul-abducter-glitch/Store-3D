import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../payload.config";
import { runServiceReadinessChecks } from "@/lib/serviceReadiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const readBearerToken = (value: string | null) => {
  const raw = toNonEmptyString(value);
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("bearer ")) {
    return raw.slice(7).trim();
  }
  return "";
};

const isAuthorized = (request: NextRequest) => {
  const expectedToken = toNonEmptyString(process.env.READY_ENDPOINT_TOKEN);
  if (!expectedToken) return true;

  const providedToken =
    toNonEmptyString(request.headers.get("x-admin-token")) ||
    toNonEmptyString(request.headers.get("x-ready-token")) ||
    readBearerToken(request.headers.get("authorization")) ||
    toNonEmptyString(request.nextUrl.searchParams.get("token"));

  return Boolean(providedToken && providedToken === expectedToken);
};

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized.",
      },
      { status: 401 }
    );
  }

  try {
    const payload = await getPayloadClient();
    const readiness = await runServiceReadinessChecks(payload as any);
    return NextResponse.json(readiness, { status: readiness.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        generatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Failed to run readiness checks.",
      },
      { status: 503 }
    );
  }
}
