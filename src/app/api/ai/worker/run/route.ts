import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { runAiWorkerTick } from "@/lib/aiWorker";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";

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

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
};

const resolveWorkerToken = (request: NextRequest) =>
  request.headers.get("x-ai-worker-token") ||
  request.headers.get("x-worker-token") ||
  request.nextUrl.searchParams.get("token") ||
  "";

const toLimitString = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value;
  return undefined;
};

const isAllowedByToken = (request: NextRequest) => {
  const expected = (process.env.AI_WORKER_TOKEN || "").trim();
  if (!expected) return null;
  const received = resolveWorkerToken(request).trim();
  return received === expected;
};

const isAdminUser = (user: any) => {
  const email = normalizeEmail(user?.email);
  if (!email) return false;
  return parseAdminEmails().includes(email);
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const tokenAllowed = isAllowedByToken(request);
    if (tokenAllowed === false) {
      return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
    }

    if (tokenAllowed === null) {
      const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
      if (!authResult?.user || !isAdminUser(authResult.user)) {
        return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
      }
    }

    const requestBody = await request.json().catch(() => ({}));
    const limit = parsePositiveInteger(
      toLimitString(requestBody?.limit),
      parsePositiveInteger(request.nextUrl.searchParams.get("limit") || undefined, 10)
    );

    const result = await runAiWorkerTick(payload as any, { limit });

    return NextResponse.json(
      {
        success: true,
        worker: result,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/worker:run] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to run AI worker tick.",
      },
      { status: 500 }
    );
  }
}
