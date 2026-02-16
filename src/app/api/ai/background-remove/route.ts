import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SOURCE_SIZE_BYTES = 12 * 1024 * 1024;

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeServiceUrl = () => {
  const raw = String(process.env.AI_BG_REMOVE_REMBG_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
};

const isAllowedImageType = (mimeType: string) =>
  /^image\/(png|jpeg|jpg|webp|bmp|gif)$/i.test(mimeType.trim());

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = String((authResult as { user?: { id?: unknown } } | null)?.user?.id ?? "").trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const rembgUrl = normalizeServiceUrl();
    if (!rembgUrl) {
      return NextResponse.json(
        {
          success: false,
          error: "Background remover is not configured. Set AI_BG_REMOVE_REMBG_URL.",
        },
        { status: 503 }
      );
    }

    const formData = await request.formData();
    const imageEntry = formData.get("image");
    if (!(imageEntry instanceof Blob)) {
      return NextResponse.json(
        { success: false, error: "Image file is required in form field `image`." },
        { status: 400 }
      );
    }

    if (imageEntry.size <= 0 || imageEntry.size > MAX_SOURCE_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Image size must be between 1 byte and ${Math.round(MAX_SOURCE_SIZE_BYTES / (1024 * 1024))}MB.`,
        },
        { status: 400 }
      );
    }

    const mimeType = (imageEntry.type || "image/png").trim().toLowerCase();
    if (!isAllowedImageType(mimeType)) {
      return NextResponse.json(
        {
          success: false,
          error: "Unsupported image format. Allowed: PNG, JPG, WEBP, BMP, GIF.",
        },
        { status: 400 }
      );
    }

    const upstreamForm = new FormData();
    upstreamForm.append("file", imageEntry, "reference-input.png");

    const upstreamResponse = await fetch(rembgUrl, {
      method: "POST",
      body: upstreamForm,
      cache: "no-store",
    });

    if (!upstreamResponse.ok) {
      const upstreamText = (await upstreamResponse.text()).slice(0, 220);
      return NextResponse.json(
        {
          success: false,
          error: upstreamText || "Background removal upstream returned an error.",
        },
        { status: 502 }
      );
    }

    const outputBlob = await upstreamResponse.blob();
    if (outputBlob.size <= 0) {
      return NextResponse.json(
        { success: false, error: "Background removal upstream returned empty output." },
        { status: 502 }
      );
    }

    return new NextResponse(outputBlob, {
      status: 200,
      headers: {
        "Content-Type": outputBlob.type || "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[ai/background-remove] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to remove background.",
      },
      { status: 500 }
    );
  }
}
