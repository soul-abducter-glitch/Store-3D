import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error: "Upload back from Blender is planned for phase 2 (label=blender_edit).",
    },
    { status: 501 }
  );
}
