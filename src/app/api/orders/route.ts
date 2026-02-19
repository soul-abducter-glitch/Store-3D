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

const normalizeId = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  return trimmed;
};

const emptyOrdersResult = (limit: number) => ({
  docs: [],
  totalDocs: 0,
  limit,
  page: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
});

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureOrdersSchema(payload as any);
    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInt(searchParams.get("limit"), 20);
    const depth = parsePositiveInt(searchParams.get("depth"), 0);

    const userId =
      normalizeId(searchParams.get("where[or][0][user][equals]")) ??
      normalizeId(searchParams.get("where[user][equals]"));
    const email =
      searchParams.get("where[or][1][customer.email][equals]") ??
      searchParams.get("where[customer.email][equals]");

    const emailTrimmed = typeof email === "string" ? email.trim() : "";
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
    console.error("[orders] fetch failed", error);
    return NextResponse.json(
      { error: "Failed to fetch orders." },
      { status: 500 }
    );
  }
}

