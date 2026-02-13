import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "store-3d-front",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
