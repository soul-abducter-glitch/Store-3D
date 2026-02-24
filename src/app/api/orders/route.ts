import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../payload.config";
import { ensureOrdersSchema } from "@/lib/ensureOrdersSchema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const parsePositiveInt = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

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

const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const emptyOrdersResult = (limit: number) => ({
  docs: [],
  totalDocs: 0,
  limit,
  page: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
});

const isMissingOrderItemColorColumnError = (error: unknown) => {
  const directMessage = error instanceof Error ? error.message : "";
  const causeMessage =
    error && typeof error === "object" && "cause" in error
      ? String((error as { cause?: { message?: unknown } }).cause?.message ?? "")
      : "";
  const combined = `${directMessage}\n${causeMessage}`.toLowerCase();
  if (!combined.includes("does not exist")) {
    return false;
  }
  return (
    combined.includes("orders_items.print_specs_") ||
    combined.includes("orders.technical_specs_") ||
    (combined.includes("relation \"orders\"") && combined.includes("technical_specs_")) ||
    (combined.includes("column") &&
      (combined.includes("print_specs_") || combined.includes("technical_specs_")))
  );
};

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    try {
      await ensureOrdersSchema(payload as any);
    } catch (error) {
      console.warn("[orders] ensureOrdersSchema failed, continue without schema patch", error);
    }
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, parsePositiveInt(searchParams.get("limit"), 20));
    const depth = Math.max(0, Math.min(2, parsePositiveInt(searchParams.get("depth"), 0)));
    const auth = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(auth?.user?.id);
    const emailTrimmed = normalizeEmail(auth?.user?.email);
    if (userId === null && !emailTrimmed) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const where: any = {};
    const or: Array<Record<string, unknown>> = [];
    if (userId !== null) {
      or.push({ user: { equals: userId } });
    }
    if (emailTrimmed) {
      or.push({ "customer.email": { equals: emailTrimmed } });
    }
    if (or.length) {
      where.or = or;
    }

    if (!where.or?.length) {
      return NextResponse.json(emptyOrdersResult(limit), { status: 200 });
    }

    const findOrders = async (nextWhere: any) => {
      try {
        return await payload.find({
          collection: "orders",
          depth,
          limit,
          overrideAccess: true,
          where: nextWhere,
          sort: "-createdAt",
        });
      } catch (error) {
        console.warn("[orders] find fallback triggered", { nextWhere, error });
        return null;
      }
    };

    const primary = await findOrders(where);
    if (primary) {
      return NextResponse.json(primary, { status: 200 });
    }

    const mergedDocs: any[] = [];
    if (userId !== null) {
      const byUser = await findOrders({ user: { equals: userId } });
      if (byUser?.docs?.length) {
        mergedDocs.push(...byUser.docs);
      }
    }
    if (emailTrimmed) {
      const byEmail = await findOrders({ "customer.email": { equals: emailTrimmed } });
      if (byEmail?.docs?.length) {
        mergedDocs.push(...byEmail.docs);
      }
    }

    if (mergedDocs.length === 0) {
      return NextResponse.json(emptyOrdersResult(limit), { status: 200 });
    }

    const deduped = Array.from(
      new Map(
        mergedDocs.map((doc) => [String(doc?.id ?? `${doc?.createdAt}-${Math.random()}`), doc])
      ).values()
    )
      .sort((a: any, b: any) => {
        const aTs = new Date(a?.createdAt || 0).getTime();
        const bTs = new Date(b?.createdAt || 0).getTime();
        return bTs - aTs;
      })
      .slice(0, limit);

    const result = {
      docs: deduped,
      totalDocs: deduped.length,
      limit,
      page: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
    };

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (isMissingOrderItemColorColumnError(error)) {
      const fallbackLimit = parsePositiveInt(new URL(request.url).searchParams.get("limit"), 20);
      console.warn("[orders] legacy schema mismatch detected, return empty list fallback");
      return NextResponse.json(emptyOrdersResult(fallbackLimit), { status: 200 });
    }
    console.error("[orders] fetch failed", error);
    return NextResponse.json(
      { error: "Failed to fetch orders." },
      { status: 500 }
    );
  }
}

