import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import {
  normalizeTrimmedText,
  validateAccountName,
  validateDefaultShippingAddress,
} from "@/lib/accountValidation";

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

const mapProfile = (user: any) => ({
  name: typeof user?.name === "string" ? user.name : "",
  email: typeof user?.email === "string" ? user.email : "",
  emailVerified: typeof user?._verified === "boolean" ? user._verified : null,
  defaultShippingAddress: normalizeTrimmedText(
    user?.defaultShippingAddress ?? user?.shippingAddress
  ),
});

const getAuthenticatedUser = async (request: NextRequest) => {
  const payload = await getPayloadClient();
  const auth = await payload.auth({ headers: request.headers }).catch(() => null);
  const userId = normalizeRelationshipId(auth?.user?.id);
  if (!userId) {
    return { payload, user: null as any };
  }
  const user = await payload
    .findByID({
      collection: "users",
      id: userId as any,
      depth: 0,
      overrideAccess: true,
    })
    .catch(() => null);
  return { payload, user };
};

export async function GET(request: NextRequest) {
  try {
    const { user } = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    return NextResponse.json({ success: true, profile: mapProfile(user) }, { status: 200 });
  } catch {
    return NextResponse.json(
      { success: false, error: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { payload, user } = await getAuthenticatedUser(request);
    if (!user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 payload." }, { status: 400 });
    }

    const fieldErrors: Record<string, string> = {};
    const data: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(body, "email")) {
      fieldErrors.email = "\u0418\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0435 email \u0431\u0443\u0434\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e \u043f\u043e\u0437\u0436\u0435";
    }

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      const nameError = validateAccountName((body as Record<string, unknown>).name);
      if (nameError) {
        fieldErrors.name = nameError;
      } else {
        data.name = normalizeTrimmedText((body as Record<string, unknown>).name);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "defaultShippingAddress")) {
      const addressValue = (body as Record<string, unknown>).defaultShippingAddress;
      const addressError = validateDefaultShippingAddress(addressValue);
      if (addressError) {
        fieldErrors.defaultShippingAddress = addressError;
      } else {
        data.shippingAddress = normalizeTrimmedText(addressValue);
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json(
        { success: false, error: "validation_error", fieldErrors },
        { status: 400 }
      );
    }

    const shouldUpdate = Object.keys(data).length > 0;
    const updatedUser = shouldUpdate
      ? await payload.update({
          collection: "users",
          id: user.id as any,
          data,
          overrideAccess: true,
          depth: 0,
        })
      : user;

    return NextResponse.json({ success: true, profile: mapProfile(updatedUser) }, { status: 200 });
  } catch {
    return NextResponse.json(
      { success: false, error: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443." },
      { status: 500 }
    );
  }
}
