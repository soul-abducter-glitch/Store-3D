import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { checkRateLimit, resolveClientIp } from "@/lib/rateLimit";
import { normalizeTrimmedText, validateNewAccountPassword } from "@/lib/accountValidation";

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
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return raw;
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    const auth = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(auth?.user?.id);
    const authEmail = normalizeTrimmedText(auth?.user?.email).toLowerCase();

    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    let userEmail = authEmail;
    if (!userEmail) {
      const userDoc = await payload
        .findByID({
          collection: "users",
          id: userId as any,
          depth: 0,
          overrideAccess: true,
        })
        .catch(() => null);
      userEmail = normalizeTrimmedText(userDoc?.email).toLowerCase();
    }
    if (!userEmail) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const rateLimit = checkRateLimit({
      scope: "account:change-password",
      key: `${String(userId)}:${resolveClientIp(request.headers)}`,
      max: 8,
      windowMs: 15 * 60 * 1000,
    });
    if (!rateLimit.ok) {
      return NextResponse.json(
        { success: false, error: "\u0421\u043b\u0438\u0448\u043a\u043e\u043c \u043c\u043d\u043e\u0433\u043e \u043f\u043e\u043f\u044b\u0442\u043e\u043a. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))),
          },
        }
      );
    }

    const body = await request.json().catch(() => null);
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    const confirmNewPassword =
      typeof body?.confirmNewPassword === "string" ? body.confirmNewPassword : "";

    const fieldErrors: Record<string, string> = {};
    if (!currentPassword) {
      fieldErrors.currentPassword = "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c";
    }

    const passwordError = validateNewAccountPassword(newPassword);
    if (passwordError) {
      fieldErrors.newPassword = passwordError;
    }

    if (confirmNewPassword !== newPassword) {
      fieldErrors.confirmNewPassword = "\u041f\u0430\u0440\u043e\u043b\u0438 \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u044e\u0442";
    }

    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json(
        { success: false, error: "validation_error", fieldErrors },
        { status: 400 }
      );
    }

    const verifyResponse = await fetch(`${request.nextUrl.origin}/api/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ email: userEmail, password: currentPassword }),
    });

    if (!verifyResponse.ok) {
      if (verifyResponse.status >= 500) {
        return NextResponse.json(
          { success: false, error: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443." },
          { status: 500 }
        );
      }
      return NextResponse.json(
        {
          success: false,
          error: "\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c",
          fieldErrors: { currentPassword: "\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c" },
        },
        { status: 401 }
      );
    }

    await payload.update({
      collection: "users",
      id: userId as any,
      data: { password: newPassword },
      overrideAccess: true,
      depth: 0,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json(
      { success: false, error: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443." },
      { status: 500 }
    );
  }
}
