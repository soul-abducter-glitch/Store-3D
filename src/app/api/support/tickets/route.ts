import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

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
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
};

const normalizeCategory = (value: unknown) => {
  const raw = normalizeString(value).toLowerCase();
  const allowed = new Set([
    "ai_generation",
    "ai_tokens",
    "print",
    "payment",
    "downloads",
    "other",
  ]);
  return allowed.has(raw) ? raw : "other";
};

const normalizePriority = (value: unknown) => {
  const raw = normalizeString(value).toLowerCase();
  const allowed = new Set(["low", "normal", "high"]);
  return allowed.has(raw) ? raw : "normal";
};

const mapTicket = (ticket: any) => ({
  id: String(ticket?.id || ""),
  title: normalizeString(ticket?.title),
  category: normalizeString(ticket?.category || "other"),
  priority: normalizeString(ticket?.priority || "normal"),
  status: normalizeString(ticket?.status || "open"),
  message: normalizeString(ticket?.message),
  adminReply: normalizeString(ticket?.adminReply),
  createdAt: ticket?.createdAt,
  updatedAt: ticket?.updatedAt,
  lastUserMessageAt: ticket?.lastUserMessageAt || ticket?.createdAt,
  lastAdminReplyAt: ticket?.lastAdminReplyAt,
});

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const auth = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(auth?.user?.id);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const found = await payload.find({
      collection: "support_tickets",
      depth: 0,
      limit: 50,
      sort: "-updatedAt",
      overrideAccess: true,
      where: {
        user: {
          equals: userId as any,
        },
      },
    });

    const docs = Array.isArray(found?.docs) ? found.docs : [];
    return NextResponse.json(
      {
        success: true,
        tickets: docs.map(mapTicket),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[support/tickets:list] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load tickets.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);

    const auth = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = normalizeRelationshipId(auth?.user?.id);
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const title = normalizeString(body?.title).slice(0, 120);
    const message = normalizeString(body?.message).slice(0, 4000);
    const category = normalizeCategory(body?.category);
    const priority = normalizePriority(body?.priority);

    if (!title) {
      return NextResponse.json(
        { success: false, error: "Title is required." },
        { status: 400 }
      );
    }
    if (!message || message.length < 10) {
      return NextResponse.json(
        { success: false, error: "Message must be at least 10 characters." },
        { status: 400 }
      );
    }

    const email = normalizeString(auth?.user?.email).toLowerCase();
    const name = normalizeString(auth?.user?.name);
    const nowIso = new Date().toISOString();

    const created = await payload.create({
      collection: "support_tickets",
      overrideAccess: true,
      data: {
        user: userId as any,
        status: "open",
        priority,
        category,
        email,
        name,
        title,
        message,
        lastUserMessageAt: nowIso,
      },
    });

    return NextResponse.json(
      {
        success: true,
        ticket: mapTicket(created),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[support/tickets:create] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to create ticket.",
      },
      { status: 500 }
    );
  }
}

