import { NextResponse, type NextRequest } from "next/server";
import { sendTestNotificationEmail } from "@/lib/orderNotifications";

export const dynamic = "force-dynamic";

const resolveToken = (request: NextRequest) =>
  request.headers.get("x-admin-token") ||
  request.nextUrl.searchParams.get("token") ||
  "";

const isAuthorized = (request: NextRequest) => {
  const required =
    (process.env.EMAIL_DEBUG_TOKEN || "").trim() ||
    (process.env.BACKFILL_TOKEN || "").trim();

  if (!required) {
    return process.env.NODE_ENV !== "production";
  }

  const provided = resolveToken(request);
  return Boolean(provided && provided === required);
};

const resolveRecipient = async (request: NextRequest) => {
  const fromQuery = (request.nextUrl.searchParams.get("to") || "").trim().toLowerCase();
  if (fromQuery) return fromQuery;

  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    const fromBody = (body?.to || "").toString().trim().toLowerCase();
    if (fromBody) return fromBody;
  }

  return "";
};

const handle = async (request: NextRequest) => {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unauthorized. Set EMAIL_DEBUG_TOKEN and pass it via x-admin-token header or ?token=...",
      },
      { status: 401 }
    );
  }

  const to = await resolveRecipient(request);
  const result = await sendTestNotificationEmail({ to });

  if (!result.ok) {
    return NextResponse.json(
      {
        success: false,
        ...result,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    ...result,
  });
};

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

