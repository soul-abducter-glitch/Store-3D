import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";
import { applySegmentationMask, segmentForeground } from "@imgly/background-removal-node";

import payloadConfig from "../../../../../payload.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SOURCE_SIZE_BYTES = 12 * 1024 * 1024;

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const resolveSegmentationModel = (): "small" | "medium" | "large" => {
  const normalized = String(process.env.AI_BG_REMOVAL_MODEL || "large")
    .trim()
    .toLowerCase();
  if (normalized === "small" || normalized === "medium" || normalized === "large") {
    return normalized;
  }
  return "large";
};

const parseAlpha8Meta = (mimeType: string) => {
  const params = mimeType
    .split(";")
    .slice(1)
    .map((entry) => entry.trim())
    .filter(Boolean);

  let width = 0;
  let height = 0;
  for (const param of params) {
    const separator = param.indexOf("=");
    if (separator <= 0) continue;
    const key = param.slice(0, separator).trim().toLowerCase();
    const value = Number.parseInt(param.slice(separator + 1).trim(), 10);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (key === "width") width = value;
    if (key === "height") height = value;
  }
  return { width, height };
};

const computeOtsuThreshold = (alpha: Uint8Array) => {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < alpha.length; i += 1) {
    histogram[alpha[i]] += 1;
  }

  const total = alpha.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) {
    sum += i * histogram[i];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 0;

  for (let i = 0; i < 256; i += 1) {
    weightBackground += histogram[i];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += i * histogram[i];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const betweenClassVariance =
      weightBackground * weightForeground * (meanBackground - meanForeground) * (meanBackground - meanForeground);
    if (betweenClassVariance > maxVariance) {
      maxVariance = betweenClassVariance;
      threshold = i;
    }
  }

  return threshold;
};

const thresholdToBinary = (alpha: Uint8Array, threshold: number) => {
  const binary = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    binary[i] = alpha[i] >= threshold ? 1 : 0;
  }
  return binary;
};

const countMaskPixels = (mask: Uint8Array) => {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) count += 1;
  }
  return count;
};

const pickPrimaryComponent = (binary: Uint8Array, width: number, height: number) => {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const centerRadius = Math.max(1, Math.sqrt(centerX * centerX + centerY * centerY));

  let bestScore = -Infinity;
  let bestPixels: number[] = [];

  for (let index = 0; index < pixelCount; index += 1) {
    if (!binary[index] || visited[index]) continue;

    let read = 0;
    let write = 0;
    queue[write] = index;
    write += 1;
    visited[index] = 1;

    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let touchesBorder = false;
    const componentPixels: number[] = [];

    while (read < write) {
      const current = queue[read];
      read += 1;
      componentPixels.push(current);
      area += 1;

      const x = current % width;
      const y = Math.floor(current / width);
      sumX += x;
      sumY += y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;

      if (x > 0) {
        const left = current - 1;
        if (!visited[left] && binary[left]) {
          visited[left] = 1;
          queue[write] = left;
          write += 1;
        }
      }
      if (x < width - 1) {
        const right = current + 1;
        if (!visited[right] && binary[right]) {
          visited[right] = 1;
          queue[write] = right;
          write += 1;
        }
      }
      if (y > 0) {
        const up = current - width;
        if (!visited[up] && binary[up]) {
          visited[up] = 1;
          queue[write] = up;
          write += 1;
        }
      }
      if (y < height - 1) {
        const down = current + width;
        if (!visited[down] && binary[down]) {
          visited[down] = 1;
          queue[write] = down;
          write += 1;
        }
      }
    }

    if (area <= 0) continue;
    const centroidX = sumX / area;
    const centroidY = sumY / area;
    const normalizedDistance =
      Math.sqrt((centroidX - centerX) * (centroidX - centerX) + (centroidY - centerY) * (centroidY - centerY)) /
      centerRadius;
    const borderPenalty = touchesBorder ? 0.17 : 0;
    const score = area / (1 + normalizedDistance * 1.8 + borderPenalty);

    if (score > bestScore) {
      bestScore = score;
      bestPixels = componentPixels;
    }
  }

  const primary = new Uint8Array(pixelCount);
  for (let i = 0; i < bestPixels.length; i += 1) {
    primary[bestPixels[i]] = 1;
  }
  return primary;
};

const dilateBinaryMask = (mask: Uint8Array, width: number, height: number, steps: number) => {
  let current = mask.slice();
  const pixelCount = width * height;
  for (let step = 0; step < steps; step += 1) {
    const next = current.slice();
    for (let index = 0; index < pixelCount; index += 1) {
      if (!current[index]) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) next[index - 1] = 1;
      if (x < width - 1) next[index + 1] = 1;
      if (y > 0) next[index - width] = 1;
      if (y < height - 1) next[index + width] = 1;
    }
    current = next;
  }
  return current;
};

const keepConnectedToSeed = (binary: Uint8Array, seed: Uint8Array, width: number, height: number) => {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let read = 0;
  let write = 0;

  for (let i = 0; i < pixelCount; i += 1) {
    if (!seed[i] || !binary[i]) continue;
    visited[i] = 1;
    queue[write] = i;
    write += 1;
  }

  while (read < write) {
    const current = queue[read];
    read += 1;
    const x = current % width;
    const y = Math.floor(current / width);

    if (x > 0) {
      const left = current - 1;
      if (!visited[left] && binary[left]) {
        visited[left] = 1;
        queue[write] = left;
        write += 1;
      }
    }
    if (x < width - 1) {
      const right = current + 1;
      if (!visited[right] && binary[right]) {
        visited[right] = 1;
        queue[write] = right;
        write += 1;
      }
    }
    if (y > 0) {
      const up = current - width;
      if (!visited[up] && binary[up]) {
        visited[up] = 1;
        queue[write] = up;
        write += 1;
      }
    }
    if (y < height - 1) {
      const down = current + width;
      if (!visited[down] && binary[down]) {
        visited[down] = 1;
        queue[write] = down;
        write += 1;
      }
    }
  }

  return visited;
};

const refineAlphaMask = (rawAlpha: Uint8Array, width: number, height: number) => {
  const pixelCount = width * height;
  if (rawAlpha.length !== pixelCount) return rawAlpha;

  const otsu = computeOtsuThreshold(rawAlpha);
  let coreThreshold = clamp(otsu + 24, 82, 220);
  let coreMask = pickPrimaryComponent(thresholdToBinary(rawAlpha, coreThreshold), width, height);

  if (countMaskPixels(coreMask) < pixelCount * 0.01) {
    coreThreshold = clamp(otsu + 10, 64, 200);
    coreMask = pickPrimaryComponent(thresholdToBinary(rawAlpha, coreThreshold), width, height);
  }
  if (countMaskPixels(coreMask) < pixelCount * 0.006) {
    coreThreshold = clamp(otsu, 52, 185);
    coreMask = pickPrimaryComponent(thresholdToBinary(rawAlpha, coreThreshold), width, height);
  }

  const growSteps = clamp(Math.round(Math.min(width, height) / 170), 4, 14);
  const expandedMask = dilateBinaryMask(coreMask, width, height, growSteps);
  const softThreshold = clamp(coreThreshold - 64, 14, 160);

  const candidateMask = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    candidateMask[i] = expandedMask[i] && rawAlpha[i] >= softThreshold ? 1 : 0;
  }

  const connectedMask = keepConnectedToSeed(candidateMask, coreMask, width, height);
  const connectedArea = countMaskPixels(connectedMask);
  const resultMask = connectedArea > 0 ? connectedMask : candidateMask;

  const refinedAlpha = new Uint8Array(pixelCount);
  const denominator = Math.max(1, 255 - softThreshold);
  for (let i = 0; i < pixelCount; i += 1) {
    if (!resultMask[i]) {
      refinedAlpha[i] = 0;
      continue;
    }

    const alpha = rawAlpha[i];
    if (coreMask[i]) {
      refinedAlpha[i] = alpha > 232 ? 255 : clamp(alpha + 20, 0, 255);
      continue;
    }

    const normalized = clamp((alpha - softThreshold) / denominator, 0, 1);
    const curved = Math.pow(normalized, 0.72);
    const outputAlpha = Math.round(curved * 255);
    refinedAlpha[i] = outputAlpha < 14 ? 0 : outputAlpha > 248 ? 255 : outputAlpha;
  }

  return refinedAlpha;
};

const isAllowedImageType = (mimeType: string) =>
  /^image\/(png|jpeg|jpg|webp|bmp)$/i.test(mimeType.trim()) || mimeType.trim() === "image/gif";

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    const userId = String((authResult as { user?: { id?: unknown } } | null)?.user?.id ?? "").trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
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

    const model = resolveSegmentationModel();
    const sourceBlob = imageEntry;
    const rawMaskBlob = await segmentForeground(sourceBlob, {
      model,
      output: {
        format: "image/x-alpha8",
        quality: 1,
      },
    });

    const { width, height } = parseAlpha8Meta(rawMaskBlob.type || "");
    if (width <= 0 || height <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Background mask metadata is invalid.",
        },
        { status: 500 }
      );
    }

    const rawAlpha = new Uint8Array(await rawMaskBlob.arrayBuffer());
    const refinedAlpha = refineAlphaMask(rawAlpha, width, height);
    const refinedMaskBuffer = Buffer.from(refinedAlpha);
    const refinedMaskBlob = new Blob([refinedMaskBuffer], {
      type: `image/x-alpha8;width=${width};height=${height}`,
    });

    const outputBlob = await applySegmentationMask(sourceBlob, refinedMaskBlob, {
      output: {
        format: "image/png",
        quality: 1,
      },
    });

    return new NextResponse(outputBlob, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
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
