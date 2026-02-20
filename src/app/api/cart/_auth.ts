import type { NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "@payload-config";

const normalizeRelationshipId = (value: unknown): string | null => {
  let current: unknown = value;
  while (typeof current === "object" && current !== null) {
    current =
      (current as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (current as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (current as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
  }
  if (current === null || current === undefined) return null;
  const raw = String(current).trim();
  return raw || null;
};

export const resolveCartUserId = async (request: NextRequest) => {
  try {
    const payload = await getPayload({ config: payloadConfig });
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    return normalizeRelationshipId(authResult?.user?.id);
  } catch {
    return null;
  }
};
