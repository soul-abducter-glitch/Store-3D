import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../payload.config";

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
  return trimmed || null;
};

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInt(searchParams.get("limit"), 20);
    const depth = parsePositiveInt(searchParams.get("depth"), 0);

    const userId =
      normalizeId(searchParams.get("where[or][0][user][equals]")) ??
      normalizeId(searchParams.get("where[user][equals]"));
    const email =
      searchParams.get("where[or][1][customer.email][equals]") ??
      searchParams.get("where[customer.email][equals]");

    const where: any = {};
    const or: Array<Record<string, unknown>> = [];
    if (userId !== null) {
      or.push({ user: { equals: userId } });
    }
    if (email && email.trim()) {
      or.push({ "customer.email": { equals: email.trim() } });
    }
    if (or.length) {
      where.or = or;
    }

    if (!where.or?.length) {
      return NextResponse.json(
        {
          docs: [],
          totalDocs: 0,
          limit,
          page: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
        { status: 200 }
      );
    }

    const result = await payload.find({
      collection: "orders",
      depth,
      limit,
      overrideAccess: true,
      where,
      sort: "-createdAt",
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[orders] fetch failed", error);
    return NextResponse.json(
      { error: "Failed to fetch orders." },
      { status: 500 }
    );
  }
}

