"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Grid, OrbitControls, Sparkles } from "@react-three/drei";
import { motion } from "framer-motion";
import { Cpu, ShieldCheck, UploadCloud } from "lucide-react";
import {
  AdditiveBlending,
  Color,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
} from "three";

import ModelView from "@/components/ModelView";
import { ToastContainer, useToast } from "@/components/Toast";

type SynthesisMode = "image" | "text";
type AiReferenceItem = {
  id: string;
  url: string;
  name: string;
  type: string;
  previewUrl: string | null;
  originalUrl?: string | null;
};

type GeneratedAsset = {
  id: string;
  name: string;
  createdAt: number;
  previewImage?: string | null;
  modelUrl?: string | null;
  format: "glb" | "gltf" | "image";
  localOnly?: boolean;
};

type AiGenerationJob = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  stage?: string;
  mode: "image" | "text";
  provider: string;
  progress: number;
  prompt: string;
  sourceType: "none" | "url" | "image";
  sourceUrl: string;
  inputRefs?: Array<{ url: string; name?: string; type?: string }>;
  parentJobId?: string | null;
  parentAssetId?: string | null;
  errorMessage: string;
  result: {
    modelUrl: string;
    previewUrl: string;
    format: string;
  };
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  queuePosition?: number | null;
  queueDepth?: number;
  activeQueueJobs?: number;
  etaSeconds?: number | null;
  etaStartAt?: string | null;
  etaCompleteAt?: string | null;
};

type AiAssetRecord = {
  id: string;
  jobId: string | null;
  previousAssetId?: string | null;
  familyId?: string;
  version?: number;
  title: string;
  modelUrl: string;
  previewUrl: string;
  format: string;
  status: string;
  fixAvailable?: boolean;
  checks?: {
    topology?: {
      fixAvailable?: boolean;
      riskScore?: number;
      watertight?: "yes" | "no" | "unknown";
      issues?: Array<{ message?: string }>;
    };
  } | null;
};

type JobHistoryFilter = "all" | AiGenerationJob["status"];
type LabPanelTab = "compose" | "history" | "assets" | "billing";

type AiTokenEvent = {
  id: string;
  reason: "spend" | "refund" | "topup" | "adjust";
  delta: number;
  balanceAfter: number;
  source: string;
  createdAt: string;
};

type AiSubscriptionPlan = {
  code: "s" | "m" | "l";
  label: string;
  monthlyTokens: number;
  monthlyAmountCents: number;
  proAccess: boolean;
  configured: boolean;
};

type AiSubscriptionState = {
  id: string;
  stripeCustomerId: string;
  planCode: "s" | "m" | "l" | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  nextBillingAt: string | null;
  monthlyTokens: number;
  monthlyAmountCents: number;
  planLabel: string;
  proAccess: boolean;
  isActive: boolean;
};

const logLines = [
  "[OK] NEURAL_LINK_ESTABLISHED",
  "[OK] DOWNLOAD_WEIGHTS_V3...",
  "[..] MAPPING_TOPOLOGY_0x88F",
  "[..] COMPUTING_GEOMETRY_NODES",
  "[..] RECONSTRUCT_VOLUME",
  "[..] CALIBRATING_LATENT_GRID",
];

const DEFAULT_TOKEN_COST = 10;
const GALLERY_LIMIT = 12;
const GALLERY_STORAGE_KEY = "aiLabGallery";
const AI_LAB_BG = "/backgrounds/pedestal.png";
const MODEL_STAGE_OFFSET = -0.95;
const MODEL_STAGE_TARGET_SIZE = 2.2;
const AI_GENERATE_API_URL = "/api/ai/generate";
const AI_ASSETS_API_URL = "/api/ai/assets";
const AI_BACKGROUND_REMOVE_API_URL = "/api/ai/background-remove";
const AI_ASSET_REPAIR_API = (assetId: string) =>
  `/api/ai/assets/${encodeURIComponent(assetId)}/repair`;
const AI_TOKENS_API_URL = "/api/ai/tokens";
const AI_TOKENS_HISTORY_API_URL = "/api/ai/tokens/history";
const AI_TOKENS_TOPUP_API_URL = "/api/ai/tokens/topup";
const AI_SUBSCRIPTION_ME_API_URL = "/api/ai/subscriptions/me";
const AI_SUBSCRIPTION_CHECKOUT_API_URL = "/api/ai/subscriptions/checkout";
const AI_SUBSCRIPTION_PORTAL_API_URL = "/api/ai/subscriptions/portal";
const MAX_INPUT_REFERENCES = 4;
const AI_BG_REMOVE_MODE = (process.env.NEXT_PUBLIC_AI_BG_REMOVE_MODE || "client")
  .trim()
  .toLowerCase();
const AI_BG_REMOVE_SERVER_ENABLED = AI_BG_REMOVE_MODE === "rembg";
const TOPUP_PACKS: Array<{ id: string; title: string; credits: number; note: string }> = [
  { id: "starter", title: "STARTER", credits: 50, note: "STRIPE TEST" },
  { id: "pro", title: "PRO", credits: 200, note: "STRIPE TEST" },
  { id: "max", title: "MAX", credits: 500, note: "STRIPE TEST" },
];
const SERVER_STAGE_BY_STATUS: Record<AiGenerationJob["status"], string> = {
  queued: "SERVER_QUEUE",
  processing: "GENETIC_MAPPING",
  completed: "SYNTHESIS_DONE",
  failed: "SYNTHESIS_FAILED",
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const isAiReferenceItem = (value: unknown): value is AiReferenceItem => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AiReferenceItem>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.url === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.type === "string"
  );
};

const isAiGenerationJobLike = (value: unknown): value is AiGenerationJob => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AiGenerationJob>;
  return typeof candidate.id === "string" && candidate.id.trim().length > 0;
};

const normalizePreview = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/\.(glb|gltf)(\?.*)?$/i.test(trimmed)) return null;
  return trimmed;
};

const toUiErrorMessage = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "Не удалось выполнить запрос к AI сервису.";
  if (/unauthorized/i.test(raw)) return "Войдите в аккаунт, чтобы использовать AI лабораторию.";
  if (/forbidden/i.test(raw)) return "Недостаточно прав для доступа к AI задаче.";
  if (/not initialized/i.test(raw) || /relation\\s+\"?.+\"?\\s+does not exist/i.test(raw)) {
    return "AI сервис еще инициализируется. Попробуйте чуть позже.";
  }
  if (/schema is out of date/i.test(raw) || /column\\s+\"?.+\"?\\s+does not exist/i.test(raw)) {
    return "Схема AI сервиса обновляется. Попробуйте позже.";
  }
  if (/payload_locked_documents/i.test(raw)) {
    return "Сервис временно занят. Повторите попытку через минуту.";
  }
  if (raw.length > 220) {
    return "Внутренняя ошибка AI сервиса. Попробуйте позже.";
  }
  return raw;
};

const formatJobDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatEta = (seconds?: number | null) => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
      secs
    ).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const formatMoneyFromCents = (cents?: number) => {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "0";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(cents / 100);
};

const sanitizeFilenameBase = (raw: string, fallback = "reference") => {
  const normalized = String(raw || "")
    .trim()
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
};

const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const featherAlphaMask = (alpha: Uint8Array, width: number, height: number, radius: number) => {
  const r = Math.max(0, Math.min(6, Math.trunc(radius)));
  if (r === 0 || width <= 0 || height <= 0 || alpha.length !== width * height) {
    return alpha.slice();
  }

  const source = new Float32Array(alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    source[i] = alpha[i];
  }
  const horizontal = new Float32Array(alpha.length);
  const output = new Uint8Array(alpha.length);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -r; k <= r; k += 1) {
        const nx = x + k;
        if (nx < 0 || nx >= width) continue;
        sum += source[rowOffset + nx];
        count += 1;
      }
      horizontal[rowOffset + x] = count > 0 ? sum / count : source[rowOffset + x];
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -r; k <= r; k += 1) {
        const ny = y + k;
        if (ny < 0 || ny >= height) continue;
        sum += horizontal[ny * width + x];
        count += 1;
      }
      output[y * width + x] = Math.round(clampNumber(count > 0 ? sum / count : horizontal[y * width + x], 0, 255));
    }
  }

  return output;
};

const createWandCursor = (symbol: "+" | "-", accentHex: string) => {
  const vertical =
    symbol === "+"
      ? "<line x1='12' y1='7.5' x2='12' y2='16.5' stroke='white' stroke-width='1.9' stroke-linecap='round'/>"
      : "";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>
<circle cx='12' cy='12' r='8.7' fill='rgba(5,8,12,0.9)' stroke='${accentHex}' stroke-width='1.5'/>
<line x1='7.5' y1='12' x2='16.5' y2='12' stroke='white' stroke-width='1.9' stroke-linecap='round'/>
${vertical}
</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
};

const WAND_CURSOR_ERASE = createWandCursor("-", "#ef4444");
const WAND_CURSOR_RESTORE = createWandCursor("+", "#22c55e");

const loadImageFromDataUrl = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image."));
    image.src = dataUrl;
  });

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        reject(new Error("Failed to convert blob to data URL."));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Failed to read blob."));
    reader.readAsDataURL(blob);
  });

const dataUrlToBlob = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error("Failed to read input image.");
  }
  return response.blob();
};

type ImglyRemoveBackground = (
  image: ImageData | ArrayBuffer | Uint8Array | Blob | URL | string,
  config?: Record<string, unknown>
) => Promise<Blob>;

let imglyRemoveBackgroundPromise: Promise<ImglyRemoveBackground> | null = null;

const loadImglyRemoveBackground = () => {
  if (!imglyRemoveBackgroundPromise) {
    imglyRemoveBackgroundPromise = import("@imgly/background-removal").then((module) => {
      const fn = module.default as unknown;
      if (typeof fn !== "function") {
        throw new Error("Background removal module is unavailable.");
      }
      return fn as ImglyRemoveBackground;
    });
  }
  return imglyRemoveBackgroundPromise;
};

const findForegroundSeedIndex = (alpha: Uint8Array, width: number, height: number) => {
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const centerIndex = centerY * width + centerX;
  if (alpha[centerIndex] >= 20) return centerIndex;

  let bestIndex = -1;
  let bestScore = -Infinity;
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 180));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const idx = y * width + x;
      const a = alpha[idx];
      if (a < 10) continue;
      const dx = x - centerX;
      const dy = y - centerY;
      const distancePenalty = Math.sqrt(dx * dx + dy * dy) * 0.18;
      const score = a - distancePenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = idx;
      }
    }
  }
  return bestIndex >= 0 ? bestIndex : centerIndex;
};

const extractConnectedComponent = (binary: Uint8Array, width: number, height: number, seedIndex: number) => {
  const pixelCount = width * height;
  if (seedIndex < 0 || seedIndex >= pixelCount || binary[seedIndex] === 0) {
    return new Uint8Array(pixelCount);
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let read = 0;
  let write = 0;

  const component = new Uint8Array(pixelCount);
  visited[seedIndex] = 1;
  queue[write++] = seedIndex;
  component[seedIndex] = 1;

  while (read < write) {
    const current = queue[read++];
    const x = current % width;
    const y = Math.floor(current / width);

    if (x > 0) {
      const left = current - 1;
      if (!visited[left] && binary[left]) {
        visited[left] = 1;
        queue[write++] = left;
        component[left] = 1;
      }
    }
    if (x < width - 1) {
      const right = current + 1;
      if (!visited[right] && binary[right]) {
        visited[right] = 1;
        queue[write++] = right;
        component[right] = 1;
      }
    }
    if (y > 0) {
      const up = current - width;
      if (!visited[up] && binary[up]) {
        visited[up] = 1;
        queue[write++] = up;
        component[up] = 1;
      }
    }
    if (y < height - 1) {
      const down = current + width;
      if (!visited[down] && binary[down]) {
        visited[down] = 1;
        queue[write++] = down;
        component[down] = 1;
      }
    }
  }

  return component;
};

const dilateBinaryMask = (mask: Uint8Array, width: number, height: number, radius = 1) => {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let hit = 0;
      for (let dy = -radius; dy <= radius && !hit; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (mask[ny * width + nx]) {
            hit = 1;
            break;
          }
        }
      }
      result[y * width + x] = hit;
    }
  }
  return result;
};

const erodeBinaryMask = (mask: Uint8Array, width: number, height: number, radius = 1) => {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let keep = 1;
      for (let dy = -radius; dy <= radius && keep; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          keep = 0;
          break;
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || !mask[ny * width + nx]) {
            keep = 0;
            break;
          }
        }
      }
      result[y * width + x] = keep;
    }
  }
  return result;
};

const composeForegroundWithMask = async (sourceDataUrl: string, maskDataUrl: string) => {
  const sourceImage = await loadImageFromDataUrl(sourceDataUrl);
  const maskImage = await loadImageFromDataUrl(maskDataUrl);
  const width = sourceImage.naturalWidth || sourceImage.width;
  const height = sourceImage.naturalHeight || sourceImage.height;
  if (width <= 0 || height <= 0) return sourceDataUrl;

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return sourceDataUrl;
  sourceCtx.drawImage(sourceImage, 0, 0, width, height);
  const sourceImageData = sourceCtx.getImageData(0, 0, width, height);
  const sourcePixels = sourceImageData.data;

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskCtx) return sourceDataUrl;
  maskCtx.drawImage(maskImage, 0, 0, width, height);
  const maskImageData = maskCtx.getImageData(0, 0, width, height);
  const maskPixels = maskImageData.data;

  const pixelCount = width * height;
  const alpha = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const idx = i * 4;
    alpha[i] = Math.max(maskPixels[idx], maskPixels[idx + 1], maskPixels[idx + 2], maskPixels[idx + 3]);
  }

  const seedIndex = findForegroundSeedIndex(alpha, width, height);
  let threshold = 28;
  let binary = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    binary[i] = alpha[i] >= threshold ? 1 : 0;
  }
  let component = extractConnectedComponent(binary, width, height, seedIndex);
  let area = component.reduce((sum, value) => sum + (value ? 1 : 0), 0);
  if (area < pixelCount * 0.1) {
    threshold = 16;
    for (let i = 0; i < pixelCount; i += 1) {
      binary[i] = alpha[i] >= threshold ? 1 : 0;
    }
    component = extractConnectedComponent(binary, width, height, seedIndex);
    area = component.reduce((sum, value) => sum + (value ? 1 : 0), 0);
  }
  if (area < pixelCount * 0.03) return sourceDataUrl;

  const closed = erodeBinaryMask(dilateBinaryMask(component, width, height, 2), width, height, 1);
  const refined = extractConnectedComponent(closed, width, height, seedIndex);

  for (let i = 0; i < pixelCount; i += 1) {
    const idx = i * 4;
    if (!refined[i]) {
      sourcePixels[idx + 3] = 0;
      continue;
    }
    const rawAlpha = alpha[i];
    let boosted = Math.min(255, Math.round(rawAlpha * 1.35 + 16));
    if (boosted < 90) {
      const x = i % width;
      const y = Math.floor(i / width);
      const left = x > 0 ? refined[i - 1] : 0;
      const right = x < width - 1 ? refined[i + 1] : 0;
      const up = y > 0 ? refined[i - width] : 0;
      const down = y < height - 1 ? refined[i + width] : 0;
      if (left && right && up && down) {
        boosted = 125;
      }
    }
    sourcePixels[idx + 3] = Math.max(0, Math.min(255, boosted));
  }

  sourceCtx.putImageData(sourceImageData, 0, 0);
  return sourceCanvas.toDataURL("image/png");
};

const removeBackgroundByHeuristic = async (dataUrl: string) => {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  const image = await loadImageFromDataUrl(dataUrl);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (naturalWidth <= 0 || naturalHeight <= 0) return dataUrl;

  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas context is unavailable.");
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const pixelCount = width * height;
  const cornerSize = Math.max(2, Math.min(12, Math.floor(Math.min(width, height) / 20)));

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumSqR = 0;
  let sumSqG = 0;
  let sumSqB = 0;
  let sampleCount = 0;

  const sampleCorner = (startX: number, startY: number) => {
    for (let y = startY; y < startY + cornerSize; y += 1) {
      for (let x = startX; x < startX + cornerSize; x += 1) {
        const idx = (y * width + x) * 4;
        const alpha = data[idx + 3];
        if (alpha < 8) continue;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        sumR += r;
        sumG += g;
        sumB += b;
        sumSqR += r * r;
        sumSqG += g * g;
        sumSqB += b * b;
        sampleCount += 1;
      }
    }
  };

  sampleCorner(0, 0);
  sampleCorner(Math.max(0, width - cornerSize), 0);
  sampleCorner(0, Math.max(0, height - cornerSize));
  sampleCorner(Math.max(0, width - cornerSize), Math.max(0, height - cornerSize));
  if (sampleCount <= 0) return dataUrl;

  const bgR = sumR / sampleCount;
  const bgG = sumG / sampleCount;
  const bgB = sumB / sampleCount;
  const variance =
    (sumSqR / sampleCount - bgR * bgR + (sumSqG / sampleCount - bgG * bgG) + (sumSqB / sampleCount - bgB * bgB)) /
    3;
  const std = Math.sqrt(Math.max(0, variance));
  const threshold = Math.max(20, Math.min(68, Math.round(24 + std * 1.8)));

  const isBackgroundCandidate = (pixelIndex: number) => {
    const idx = pixelIndex * 4;
    const alpha = data[idx + 3];
    if (alpha < 8) return true;
    const dr = Math.abs(data[idx] - bgR);
    const dg = Math.abs(data[idx + 1] - bgG);
    const db = Math.abs(data[idx + 2] - bgB);
    return Math.max(dr, dg, db) <= threshold && dr + dg + db <= threshold * 3;
  };

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  const pushCandidate = (pixelIndex: number) => {
    if (pixelIndex < 0 || pixelIndex >= pixelCount) return;
    if (visited[pixelIndex]) return;
    if (!isBackgroundCandidate(pixelIndex)) return;
    visited[pixelIndex] = 1;
    queue[queueEnd] = pixelIndex;
    queueEnd += 1;
  };

  for (let x = 0; x < width; x += 1) {
    pushCandidate(x);
    pushCandidate((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    pushCandidate(y * width);
    pushCandidate(y * width + (width - 1));
  }

  while (queueStart < queueEnd) {
    const current = queue[queueStart];
    queueStart += 1;
    const x = current % width;
    const y = Math.floor(current / width);
    if (x > 0) pushCandidate(current - 1);
    if (x < width - 1) pushCandidate(current + 1);
    if (y > 0) pushCandidate(current - width);
    if (y < height - 1) pushCandidate(current + width);
  }

  let removedPixels = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    if (!visited[i]) continue;
    const idx = i * 4;
    data[idx + 3] = 0;
    removedPixels += 1;
  }

  const removedRatio = removedPixels / pixelCount;
  if (removedRatio < 0.02 || removedRatio > 0.98) {
    return dataUrl;
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixelIndex = y * width + x;
      if (visited[pixelIndex]) continue;
      const idx = pixelIndex * 4;
      const alpha = data[idx + 3];
      if (alpha <= 0) continue;
      const nearRemoved =
        visited[pixelIndex - 1] ||
        visited[pixelIndex + 1] ||
        visited[pixelIndex - width] ||
        visited[pixelIndex + width];
      if (nearRemoved) {
        data[idx + 3] = Math.min(alpha, 110);
      }
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
};

type TrimResidualOptions = {
  aggressive?: boolean;
  allowSmallChange?: boolean;
  alphaOnly?: boolean;
};

const imageHasAlphaCutout = async (dataUrl: string) => {
  if (!dataUrl.startsWith("data:image/")) return false;
  const image = await loadImageFromDataUrl(dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width <= 0 || height <= 0) return false;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 250) return true;
  }
  return false;
};

const floodFillBorderByAlpha = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number
) => {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let read = 0;
  let write = 0;

  const push = (pixelIndex: number) => {
    if (pixelIndex < 0 || pixelIndex >= pixelCount) return;
    if (visited[pixelIndex]) return;
    const alpha = data[pixelIndex * 4 + 3];
    if (alpha > alphaThreshold) return;
    visited[pixelIndex] = 1;
    queue[write] = pixelIndex;
    write += 1;
  };

  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    push(y * width);
    push(y * width + (width - 1));
  }

  while (read < write) {
    const current = queue[read];
    read += 1;
    const x = current % width;
    const y = Math.floor(current / width);

    if (x > 0) push(current - 1);
    if (x < width - 1) push(current + 1);
    if (y > 0) push(current - width);
    if (y < height - 1) push(current + width);
  }

  return visited;
};

const expandBackgroundMaskByAlpha = (
  backgroundMask: Uint8Array,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxAlpha: number,
  steps: number
) => {
  let current = backgroundMask.slice();
  const pixelCount = width * height;

  for (let step = 0; step < steps; step += 1) {
    const next = current.slice();
    for (let i = 0; i < pixelCount; i += 1) {
      if (!current[i]) continue;
      const x = i % width;
      const y = Math.floor(i / width);
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ];
      for (const n of neighbors) {
        if (n < 0 || n >= pixelCount || next[n]) continue;
        const alpha = data[n * 4 + 3];
        if (alpha <= maxAlpha) {
          next[n] = 1;
        }
      }
    }
    current = next;
  }

  return current;
};

const trimResidualBackground = async (dataUrl: string, options: TrimResidualOptions = {}) => {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  const aggressive = options.aggressive === true;
  const allowSmallChange = options.allowSmallChange === true;
  const alphaOnly = options.alphaOnly !== false;

  const image = await loadImageFromDataUrl(dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width <= 0 || height <= 0) return dataUrl;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const pixelCount = width * height;
  if (alphaOnly) {
    let hasTransparentPixels = false;
    for (let i = 0; i < pixelCount; i += 1) {
      if (data[i * 4 + 3] < 250) {
        hasTransparentPixels = true;
        break;
      }
    }
    if (!hasTransparentPixels) return dataUrl;
  }

  const baseAlphaThreshold = aggressive ? 244 : 230;
  let backgroundMask = floodFillBorderByAlpha(data, width, height, baseAlphaThreshold);
  backgroundMask = expandBackgroundMaskByAlpha(
    backgroundMask,
    data,
    width,
    height,
    aggressive ? 158 : 126,
    aggressive ? 2 : 1
  );

  let removedPixels = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    if (!backgroundMask[i]) continue;
    const idx = i * 4;
    data[idx + 3] = 0;
    removedPixels += 1;
  }

  const removedRatio = removedPixels / pixelCount;
  if (removedRatio > 0.98) return dataUrl;
  if (!allowSmallChange && removedRatio < (aggressive ? 0.001 : 0.0035)) return dataUrl;

  const edgeAlphaCap = aggressive ? 120 : 148;
  const lowAlphaKillThreshold = aggressive ? 82 : 62;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixelIndex = y * width + x;
      if (backgroundMask[pixelIndex]) continue;
      const idx = pixelIndex * 4;
      const alpha = data[idx + 3];
      if (alpha <= 0) continue;
      const nearRemoved =
        backgroundMask[pixelIndex - 1] ||
        backgroundMask[pixelIndex + 1] ||
        backgroundMask[pixelIndex - width] ||
        backgroundMask[pixelIndex + width];
      if (nearRemoved) {
        if (alpha <= lowAlphaKillThreshold) {
          data[idx + 3] = 0;
        } else if (alpha < 220) {
          data[idx + 3] = Math.min(alpha, edgeAlphaCap);
        }
      }
    }
  }

  let remainingForeground = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    if (backgroundMask[i]) continue;
    const alpha = data[i * 4 + 3];
    if (alpha > 30) remainingForeground += 1;
  }
  if (remainingForeground < pixelCount * 0.01) return dataUrl;

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
};

const removeBackgroundFromImageDataUrl = async (dataUrl: string) => {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;

  if (AI_BG_REMOVE_SERVER_ENABLED) {
    try {
      const inputBlob = await dataUrlToBlob(dataUrl);
      const payload = new FormData();
      payload.append("image", inputBlob, "reference-input.png");
      const response = await fetch(AI_BACKGROUND_REMOVE_API_URL, {
        method: "POST",
        body: payload,
      });
      if (response.ok) {
        const cleanedBlob = await response.blob();
        if (cleanedBlob.size > 0) {
          const cleanedDataUrl = await blobToDataUrl(cleanedBlob);
          if (cleanedDataUrl.startsWith("data:image/")) {
            return trimResidualBackground(cleanedDataUrl);
          }
        }
      }
    } catch {
      // fall back to local remover below
    }
  }

  try {
    const removeBackground = await loadImglyRemoveBackground();
    const inputBlob = await dataUrlToBlob(dataUrl);

    const maskBlob = await removeBackground(inputBlob, {
      model: "isnet",
      output: {
        format: "image/png",
        quality: 1,
        type: "mask",
      },
    });

    const maskDataUrl = await blobToDataUrl(maskBlob);
    const composedDataUrl = await composeForegroundWithMask(dataUrl, maskDataUrl);
    if (composedDataUrl.startsWith("data:image/") && composedDataUrl.length > 64) {
      return trimResidualBackground(composedDataUrl);
    }
  } catch {
    // fall back to heuristic remover below
  }

  const heuristicDataUrl = await removeBackgroundByHeuristic(dataUrl);
  if (heuristicDataUrl !== dataUrl) {
    return trimResidualBackground(heuristicDataUrl);
  }
  return heuristicDataUrl;
};

const tokenReasonLabel: Record<AiTokenEvent["reason"], string> = {
  spend: "Запуск",
  refund: "Возврат",
  topup: "Пополнение",
  adjust: "Коррекция",
};

const subscriptionStatusLabel = (value?: string) => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "active") return "ACTIVE";
  if (raw === "past_due") return "PAST DUE";
  if (raw === "canceled") return "CANCELED";
  if (raw === "incomplete") return "INCOMPLETE";
  return raw ? raw.toUpperCase() : "NO PLAN";
};

function NeuralCore({ active }: { active: boolean }) {
  const groupRef = useRef<Group | null>(null);
  const coreRef = useRef<Mesh | null>(null);
  const coreMaterialRef = useRef<MeshStandardMaterial | null>(null);
  const cageRef = useRef<Mesh | null>(null);
  const cageMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const ringMaterialRef = useRef<MeshStandardMaterial | null>(null);
  const coolEmissive = useRef(new Color("#2ED1FF"));
  const cageBase = useRef(new Color("#7FE7FF"));
  const hotEmissive = useRef(new Color("#F9E7AE"));
  const tempColor = useRef(new Color());

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.35;
      groupRef.current.rotation.x = Math.sin(t * 0.2) * 0.15;
    }
    if (coreRef.current) {
      const pulse = 1 + Math.sin(t * 2.1) * 0.04;
      coreRef.current.scale.setScalar(pulse);
    }
    if (coreMaterialRef.current) {
      if (active) {
        const glow = (Math.sin(t * 4) + 1) / 2;
        tempColor.current.copy(coolEmissive.current).lerp(hotEmissive.current, glow);
        coreMaterialRef.current.emissive.copy(tempColor.current);
        coreMaterialRef.current.emissiveIntensity = 2.1 + glow * 1.4;
      } else {
        coreMaterialRef.current.emissive.copy(coolEmissive.current);
        coreMaterialRef.current.emissiveIntensity = 1.4 + Math.sin(t * 3.1) * 0.35;
      }
    }
    if (cageRef.current) {
      cageRef.current.rotation.z = t * 0.15;
    }
    if (cageMaterialRef.current) {
      const glow = active ? (Math.sin(t * 4) + 1) / 2 : 0;
      tempColor.current.copy(cageBase.current).lerp(hotEmissive.current, glow);
      cageMaterialRef.current.color.copy(tempColor.current);
    }
    if (ringMaterialRef.current) {
      const glow = active ? (Math.sin(t * 4) + 1) / 2 : 0;
      tempColor.current.copy(coolEmissive.current).lerp(hotEmissive.current, glow);
      ringMaterialRef.current.emissive.copy(tempColor.current);
      ringMaterialRef.current.emissiveIntensity = 0.8 + glow * 0.8;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={coreRef}>
        <sphereGeometry args={[1.1, 64, 64]} />
        <meshStandardMaterial
          ref={coreMaterialRef}
          color="#0b1220"
          emissive="#2ED1FF"
          emissiveIntensity={1.5}
          roughness={0.18}
          metalness={0.2}
        />
      </mesh>
      <mesh ref={cageRef} scale={1.75}>
        <boxGeometry args={[2.4, 2.4, 2.4]} />
        <meshBasicMaterial
          ref={cageMaterialRef}
          color="#7FE7FF"
          wireframe
          transparent
          opacity={0.35}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.7, 0.05, 16, 128]} />
        <meshStandardMaterial
          ref={ringMaterialRef}
          color="#7FE7FF"
          emissive="#2ED1FF"
          emissiveIntensity={0.9}
          roughness={0.2}
          metalness={0.4}
        />
      </mesh>
      <Sparkles count={90} scale={3.6} size={1.6} color="#BFF4FF" speed={0.35} opacity={0.45} />
    </group>
  );
}

function ReactorLights({ active }: { active: boolean }) {
  const keyLightRef = useRef<PointLight | null>(null);
  const fillLightRef = useRef<PointLight | null>(null);
  const coolColor = useRef(new Color("#7FE7FF"));
  const hotColor = useRef(new Color("#F9E7AE"));
  const mixColor = useRef(new Color());

  useFrame(({ clock }) => {
    if (!keyLightRef.current) return;
    if (active) {
      const pulse = (Math.sin(clock.getElapsedTime() * 3.4) + 1) / 2;
      mixColor.current.copy(coolColor.current).lerp(hotColor.current, pulse);
      keyLightRef.current.color.copy(mixColor.current);
      keyLightRef.current.intensity = 1.35 + pulse * 1.1;
    } else {
      keyLightRef.current.color.copy(coolColor.current);
      keyLightRef.current.intensity = 1.35;
    }
    if (fillLightRef.current) {
      fillLightRef.current.intensity = active ? 0.7 : 0.5;
    }
  });

  return (
    <>
      <pointLight ref={keyLightRef} position={[6, 6, 6]} intensity={1.35} color="#7FE7FF" />
      <pointLight ref={fillLightRef} position={[-6, -2, -4]} intensity={0.5} color="#0ea5e9" />
    </>
  );
}

function FloorPulse({ active }: { active: boolean }) {
  const ringRef = useRef<Mesh | null>(null);
  const ringMaterialRef = useRef<MeshStandardMaterial | null>(null);
  const glowRef = useRef<Mesh | null>(null);
  const glowMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const cool = useRef(new Color("#2ED1FF"));
  const hot = useRef(new Color("#8CF3FF"));
  const temp = useRef(new Color());

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const basePulse = (Math.sin(t * 1.6) + 1) / 2;
    const charge = active ? (Math.sin(t * 7.5) + 1) / 2 : 0;
    const pulse = active ? 0.6 + basePulse * 0.4 + charge * 0.4 : 0.35 + basePulse * 0.25;

    if (ringRef.current) {
      const scale = 1 + basePulse * 0.04 + (active ? charge * 0.03 : 0);
      ringRef.current.scale.setScalar(scale);
    }
    if (glowRef.current) {
      const scale = 1.02 + basePulse * 0.03 + (active ? charge * 0.04 : 0);
      glowRef.current.scale.setScalar(scale);
    }
    if (ringMaterialRef.current) {
      temp.current.copy(cool.current).lerp(hot.current, active ? charge : 0.15);
      ringMaterialRef.current.emissive.copy(temp.current);
      ringMaterialRef.current.emissiveIntensity = 0.9 + pulse * 1.6;
    }
    if (glowMaterialRef.current) {
      glowMaterialRef.current.opacity = 0.06 + pulse * 0.14;
    }
  });

  return (
    <group position={[0, -1.12, 0]}>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.12, 1.22, 128]} />
        <meshStandardMaterial
          ref={ringMaterialRef}
          color="#0c1f2a"
          emissive="#2ED1FF"
          emissiveIntensity={1.2}
          roughness={0.35}
          metalness={0.6}
        />
      </mesh>
      <mesh ref={glowRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.0, 1.36, 96]} />
        <meshBasicMaterial
          ref={glowMaterialRef}
          color="#2ED1FF"
          transparent
          opacity={0.14}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function AiLabContent() {
  type ManualMaskMode = "erase" | "restore" | "wand";

  const router = useRouter();
  const [previewParam, setPreviewParam] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const readParams = () => {
      const params = new URLSearchParams(window.location.search);
      setPreviewParam(params.get("preview"));
    };
    readParams();
    window.addEventListener("popstate", readParams);
    return () => window.removeEventListener("popstate", readParams);
  }, []);
  const previewModel = useMemo(() => normalizePreview(previewParam), [previewParam]);
  const previewLabel = useMemo(() => {
    if (!previewModel) return null;
    const stripped = previewModel.split("?")[0] ?? previewModel;
    const parts = stripped.split("/");
    return parts[parts.length - 1] ?? previewModel;
  }, [previewModel]);

  const [mode, setMode] = useState<SynthesisMode>("image");
  const [prompt, setPrompt] = useState("");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [inputReferences, setInputReferences] = useState<AiReferenceItem[]>([]);
  const [localPreviewModel, setLocalPreviewModel] = useState<string | null>(null);
  const [localPreviewLabel, setLocalPreviewLabel] = useState<string | null>(null);
  const [uploadedModelName, setUploadedModelName] = useState<string | null>(null);
  const [generatedPreviewModel, setGeneratedPreviewModel] = useState<string | null>(null);
  const [generatedPreviewLabel, setGeneratedPreviewLabel] = useState<string | null>(null);
  const [tokens, setTokens] = useState(0);
  const [tokenCost, setTokenCost] = useState(DEFAULT_TOKEN_COST);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [tokenEvents, setTokenEvents] = useState<AiTokenEvent[]>([]);
  const [tokenEventsLoading, setTokenEventsLoading] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupTab, setTopupTab] = useState<"onetime" | "subscription">("onetime");
  const [topupLoadingPack, setTopupLoadingPack] = useState<string | null>(null);
  const [subscriptionMode, setSubscriptionMode] = useState<"off" | "stripe">("off");
  const [subscription, setSubscription] = useState<AiSubscriptionState | null>(null);
  const [subscriptionPlans, setSubscriptionPlans] = useState<AiSubscriptionPlan[]>([]);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [subscriptionAction, setSubscriptionAction] = useState<"checkout" | "portal" | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [gallery, setGallery] = useState<GeneratedAsset[]>([]);
  const [resultAsset, setResultAsset] = useState<GeneratedAsset | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [removingReferenceBgId, setRemovingReferenceBgId] = useState<string | null>(null);
  const [smartMaskingReferenceId, setSmartMaskingReferenceId] = useState<string | null>(null);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [maskEditorLoading, setMaskEditorLoading] = useState(false);
  const [maskEditorRefId, setMaskEditorRefId] = useState<string | null>(null);
  const [maskBrushSize, setMaskBrushSize] = useState(28);
  const [maskMode, setMaskMode] = useState<ManualMaskMode>("erase");
  const [maskWandTolerance, setMaskWandTolerance] = useState(34);
  const [maskWandAction, setMaskWandAction] = useState<"erase" | "restore">("erase");
  const [maskWandOuterOnly, setMaskWandOuterOnly] = useState(true);
  const [maskFeatherPx, setMaskFeatherPx] = useState(1);
  const [maskWandAltPressed, setMaskWandAltPressed] = useState(false);
  const [maskShowOverlay, setMaskShowOverlay] = useState(true);
  const [maskApplying, setMaskApplying] = useState(false);
  const [maskAntsPhase, setMaskAntsPhase] = useState(0);
  const [, setMaskHistoryRevision] = useState(0);
  const [serverJob, setServerJob] = useState<AiGenerationJob | null>(null);
  const [serverJobLoading, setServerJobLoading] = useState(false);
  const [serverJobError, setServerJobError] = useState<string | null>(null);
  const [jobHistory, setJobHistory] = useState<AiGenerationJob[]>([]);
  const [jobHistoryLoading, setJobHistoryLoading] = useState(false);
  const [jobHistoryFilter, setJobHistoryFilter] = useState<JobHistoryFilter>("all");
  const [historyAction, setHistoryAction] = useState<{
    id: string;
    type: "retry" | "variation" | "delete" | "publish";
  } | null>(null);
  const [labPanelTab, setLabPanelTab] = useState<LabPanelTab>("compose");
  const [assetAction, setAssetAction] = useState<{
    assetId: string;
    type: "analyze" | "repair";
  } | null>(null);
  const [remixJob, setRemixJob] = useState<AiGenerationJob | null>(null);
  const [remixPrompt, setRemixPrompt] = useState("");
  const [remixLocalEdit, setRemixLocalEdit] = useState(false);
  const [remixTargetZone, setRemixTargetZone] = useState("ноги");
  const [remixIssueReference, setRemixIssueReference] = useState<AiReferenceItem | null>(null);
  const [remixIssueLoading, setRemixIssueLoading] = useState(false);
  const [publishedAssetsByJobId, setPublishedAssetsByJobId] = useState<Record<string, string>>({});
  const [publishedAssetsById, setPublishedAssetsById] = useState<Record<string, AiAssetRecord>>({});
  const [latestCompletedJob, setLatestCompletedJob] = useState<AiGenerationJob | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const remixIssueInputRef = useRef<HTMLInputElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskImageNameRef = useRef<string>("reference");
  const maskSourcePixelsRef = useRef<Uint8ClampedArray | null>(null);
  const maskSourceAlphaRef = useRef<Uint8Array | null>(null);
  const maskInitialAlphaRef = useRef<Uint8Array | null>(null);
  const maskAlphaRef = useRef<Uint8Array | null>(null);
  const maskWidthRef = useRef(0);
  const maskHeightRef = useRef(0);
  const maskDrawingRef = useRef(false);
  const maskUndoStackRef = useRef<Uint8Array[]>([]);
  const maskRedoStackRef = useRef<Uint8Array[]>([]);
  const completedServerJobRef = useRef<string | null>(null);
  const lastErrorRef = useRef<{ message: string; at: number } | null>(null);
  const jobHistoryRequestInFlightRef = useRef(false);
  const validInputReferences = useMemo(
    () => inputReferences.filter(isAiReferenceItem),
    [inputReferences]
  );
  const maskEditorReference = useMemo(
    () =>
      maskEditorRefId ? validInputReferences.find((item) => item.id === maskEditorRefId) ?? null : null,
    [maskEditorRefId, validInputReferences]
  );
  const isWandRestorePreview =
    maskMode === "wand" ? (maskWandAction === "restore") !== maskWandAltPressed : false;
  const maskCanvasCursor = maskMode === "wand" ? (isWandRestorePreview ? WAND_CURSOR_RESTORE : WAND_CURSOR_ERASE) : "crosshair";
  const isSynthRunning = serverJob?.status === "queued" || serverJob?.status === "processing";

  const { toasts, showError, showSuccess, removeToast } = useToast();
  const showErrorRef = useRef(showError);

  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  const pushUiError = useCallback(
    (raw: unknown) => {
      const message = toUiErrorMessage(raw);
      const now = Date.now();
      const last = lastErrorRef.current;
      if (last && last.message === message && now - last.at < 1500) return;
      lastErrorRef.current = { message, at: now };
      showErrorRef.current(message);
    },
    []
  );

  const fetchTokens = useCallback(
    async (silent = true) => {
      if (!silent) {
        setTokensLoading(true);
      }
      try {
        const response = await fetch(AI_TOKENS_API_URL, {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 401) {
            setTokens(0);
            setTokenCost(DEFAULT_TOKEN_COST);
            if (!silent) {
              pushUiError("Unauthorized.");
            }
            return;
          }
          throw new Error(typeof data?.error === "string" ? data.error : "Failed to fetch AI tokens.");
        }
        if (typeof data?.tokens === "number" && Number.isFinite(data.tokens)) {
          setTokens(Math.max(0, Math.trunc(data.tokens)));
        }
        if (typeof data?.tokenCost === "number" && Number.isFinite(data.tokenCost) && data.tokenCost > 0) {
          setTokenCost(Math.max(1, Math.trunc(data.tokenCost)));
        }
      } catch (error) {
        if (!silent) {
          pushUiError(error instanceof Error ? error.message : "Failed to fetch AI tokens.");
        }
      } finally {
        if (!silent) {
          setTokensLoading(false);
        }
      }
    },
    [pushUiError]
  );

  const fetchTokenHistory = useCallback(
    async (silent = true) => {
      if (!silent) setTokenEventsLoading(true);
      try {
        const response = await fetch(`${AI_TOKENS_HISTORY_API_URL}?limit=12`, {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 401) {
            setTokenEvents([]);
            return;
          }
          throw new Error(typeof data?.error === "string" ? data.error : "Failed to fetch token history.");
        }
        const events = Array.isArray(data?.events) ? (data.events as AiTokenEvent[]) : [];
        setTokenEvents(
          events
            .filter((event) => event && typeof event.id === "string")
            .map((event) => ({
              id: event.id,
              reason:
                event.reason === "spend" ||
                event.reason === "refund" ||
                event.reason === "topup" ||
                event.reason === "adjust"
                  ? event.reason
                  : "adjust",
              delta: typeof event.delta === "number" ? Math.trunc(event.delta) : 0,
              balanceAfter: typeof event.balanceAfter === "number" ? Math.trunc(event.balanceAfter) : 0,
              source: typeof event.source === "string" ? event.source : "system",
              createdAt: typeof event.createdAt === "string" ? event.createdAt : "",
            }))
        );
      } catch (error) {
        if (!silent) {
          pushUiError(error instanceof Error ? error.message : "Failed to fetch token history.");
        }
      } finally {
        if (!silent) setTokenEventsLoading(false);
      }
    },
    [pushUiError]
  );

  const fetchSubscription = useCallback(
    async (silent = true) => {
      if (!silent) setSubscriptionLoading(true);
      try {
        const response = await fetch(AI_SUBSCRIPTION_ME_API_URL, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 401) {
            setSubscription(null);
            setSubscriptionPlans([]);
            setSubscriptionMode("off");
            return;
          }
          throw new Error(
            typeof data?.error === "string" ? data.error : "Failed to fetch subscription status."
          );
        }

        const mode = data?.mode === "stripe" ? "stripe" : "off";
        setSubscriptionMode(mode);
        const plans = Array.isArray(data?.plans) ? (data.plans as AiSubscriptionPlan[]) : [];
        setSubscriptionPlans(
          plans
            .filter((plan) => plan && typeof plan === "object")
            .map((plan) => ({
              code: plan.code,
              label: String(plan.label || "").trim() || `Plan ${String(plan.code || "").toUpperCase()}`,
              monthlyTokens:
                typeof plan.monthlyTokens === "number" && Number.isFinite(plan.monthlyTokens)
                  ? Math.max(0, Math.trunc(plan.monthlyTokens))
                  : 0,
              monthlyAmountCents:
                typeof plan.monthlyAmountCents === "number" && Number.isFinite(plan.monthlyAmountCents)
                  ? Math.max(0, Math.trunc(plan.monthlyAmountCents))
                  : 0,
              proAccess: Boolean(plan.proAccess),
              configured: Boolean(plan.configured),
            }))
            .filter((plan) => plan.code === "s" || plan.code === "m" || plan.code === "l")
        );
        const rawSubscription =
          data?.subscription && typeof data.subscription === "object" ? data.subscription : null;
        if (!rawSubscription) {
          setSubscription(null);
        } else {
          setSubscription({
            id: String(rawSubscription.id || ""),
            stripeCustomerId: String(rawSubscription.stripeCustomerId || ""),
            planCode:
              rawSubscription.planCode === "s" ||
              rawSubscription.planCode === "m" ||
              rawSubscription.planCode === "l"
                ? rawSubscription.planCode
                : null,
            status: String(rawSubscription.status || ""),
            cancelAtPeriodEnd: Boolean(rawSubscription.cancelAtPeriodEnd),
            nextBillingAt:
              typeof rawSubscription.nextBillingAt === "string"
                ? rawSubscription.nextBillingAt
                : null,
            monthlyTokens:
              typeof rawSubscription.monthlyTokens === "number" &&
              Number.isFinite(rawSubscription.monthlyTokens)
                ? Math.max(0, Math.trunc(rawSubscription.monthlyTokens))
                : 0,
            monthlyAmountCents:
              typeof rawSubscription.monthlyAmountCents === "number" &&
              Number.isFinite(rawSubscription.monthlyAmountCents)
                ? Math.max(0, Math.trunc(rawSubscription.monthlyAmountCents))
                : 0,
            planLabel: String(rawSubscription.planLabel || "No plan"),
            proAccess: Boolean(rawSubscription.proAccess),
            isActive: Boolean(rawSubscription.isActive),
          });
        }
      } catch (error) {
        if (!silent) {
          pushUiError(error instanceof Error ? error.message : "Failed to fetch subscription status.");
        }
      } finally {
        if (!silent) setSubscriptionLoading(false);
      }
    },
    [pushUiError]
  );

  const handleSubscriptionCheckout = useCallback(
    async (planCode: "s" | "m" | "l") => {
      if (subscriptionAction) return;
      setSubscriptionAction("checkout");
      try {
        const response = await fetch(AI_SUBSCRIPTION_CHECKOUT_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ planCode }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "Failed to start subscription checkout."
          );
        }
        if (typeof data?.checkoutUrl === "string" && data.checkoutUrl) {
          showSuccess("Redirecting to Stripe Subscription Checkout (test mode)...");
          if (typeof window !== "undefined") {
            window.location.href = data.checkoutUrl;
          }
          return;
        }
        showSuccess("Subscription checkout session created.");
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Failed to start subscription checkout.");
      } finally {
        setSubscriptionAction(null);
      }
    },
    [pushUiError, showSuccess, subscriptionAction]
  );

  const handleOpenSubscriptionPortal = useCallback(async () => {
    if (subscriptionAction) return;
    setSubscriptionAction("portal");
    try {
      const response = await fetch(AI_SUBSCRIPTION_PORTAL_API_URL, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Failed to open subscription portal."
        );
      }
      if (typeof data?.url === "string" && data.url) {
        if (typeof window !== "undefined") {
          window.location.href = data.url;
        }
        return;
      }
      showSuccess("Subscription portal is ready.");
    } catch (error) {
      pushUiError(error instanceof Error ? error.message : "Failed to open subscription portal.");
    } finally {
      setSubscriptionAction(null);
    }
  }, [pushUiError, showSuccess, subscriptionAction]);

  const handleTopup = useCallback(
    async (packId: string) => {
      if (topupLoadingPack) return;
      setTopupLoadingPack(packId);
      try {
        const response = await fetch(AI_TOKENS_TOPUP_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ packId }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "Failed to top up tokens.");
        }
        if (typeof data?.checkoutUrl === "string" && data.checkoutUrl) {
          showSuccess("Redirecting to Stripe Checkout (test mode)...");
          if (typeof window !== "undefined") {
            window.location.href = data.checkoutUrl;
          }
          return;
        }
        if (typeof data?.tokens === "number" && Number.isFinite(data.tokens)) {
          setTokens(Math.max(0, Math.trunc(data.tokens)));
        } else {
          void fetchTokens(true);
        }
        void fetchTokenHistory(true);
        const added =
          typeof data?.creditsAdded === "number" && Number.isFinite(data.creditsAdded)
            ? Math.max(0, Math.trunc(data.creditsAdded))
            : null;
        showSuccess(added ? `Balance updated: +${added} tokens` : "Balance updated");
        setTopupOpen(false);
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Failed to top up tokens.");
      } finally {
        setTopupLoadingPack(null);
      }
    },
    [fetchTokenHistory, fetchTokens, pushUiError, showSuccess, topupLoadingPack]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const topupStatus = url.searchParams.get("topup");
    const subscriptionStatus = url.searchParams.get("subscription");
    if (!topupStatus && !subscriptionStatus) return;

    if (topupStatus) {
      if (topupStatus === "success") {
        showSuccess("Payment received. Token balance will update after webhook confirmation.");
        void fetchTokens(false);
        void fetchTokenHistory(false);
      } else if (topupStatus === "cancel") {
        pushUiError("Top-up was cancelled.");
      }
    }

    if (subscriptionStatus) {
      if (subscriptionStatus === "success") {
        showSuccess("Subscription checkout completed. Status will refresh after webhook confirmation.");
        void fetchSubscription(false);
      } else if (subscriptionStatus === "cancel") {
        pushUiError("Subscription checkout was cancelled.");
      }
    }

    url.searchParams.delete("topup");
    url.searchParams.delete("subscription");
    url.searchParams.delete("session_id");
    window.history.replaceState({}, "", url.toString());
  }, [fetchSubscription, fetchTokenHistory, fetchTokens, pushUiError, showSuccess]);

  useEffect(() => {
    if (!uploadPreview) return;
    if (!uploadPreview.startsWith("blob:")) return;
    return () => {
      URL.revokeObjectURL(uploadPreview);
    };
  }, [uploadPreview]);

  useEffect(() => {
    if (!localPreviewModel) return;
    return () => {
      URL.revokeObjectURL(localPreviewModel);
    };
  }, [localPreviewModel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedGallery = window.localStorage.getItem(GALLERY_STORAGE_KEY);
    if (storedGallery) {
      try {
        const parsed = JSON.parse(storedGallery) as GeneratedAsset[];
        if (Array.isArray(parsed)) {
          setGallery(parsed);
        }
      } catch {
        // ignore invalid cache
      }
    }
  }, []);

  useEffect(() => {
    void fetchTokens(false);
    void fetchTokenHistory(false);
    void fetchSubscription(false);
  }, [fetchSubscription, fetchTokenHistory, fetchTokens]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const safeGallery = gallery.map((item) => {
      let next = item;
      if (next.modelUrl && next.modelUrl.startsWith("blob:")) {
        next = { ...next, modelUrl: null, localOnly: true };
      }
      if (next.previewImage && next.previewImage.startsWith("data:")) {
        next = { ...next, previewImage: null };
      }
      return next;
    });
    try {
      window.localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(safeGallery));
    } catch {
      const minimalGallery = safeGallery.map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: item.createdAt,
        format: item.format,
        modelUrl: item.modelUrl && item.modelUrl.startsWith("blob:") ? null : item.modelUrl ?? null,
        previewImage: null,
        localOnly: item.localOnly ?? false,
      }));
      try {
        window.localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(minimalGallery));
      } catch {
        // ignore quota errors
      }
    }
  }, [gallery]);

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        if (!result) {
          reject(new Error("Failed to read image file."));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => reject(new Error("Failed to read image file."));
      reader.readAsDataURL(file);
    });

  const handleFiles = useCallback(
    async (files?: FileList | File[] | null) => {
      const incoming = files ? Array.from(files) : [];
      if (incoming.length === 0) return;

      const modelFile = incoming.find((file) => /\.(glb|gltf)$/i.test(file.name));
      const imageFiles = incoming.filter((file) => {
        const lowerName = file.name.toLowerCase();
        return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(lowerName);
      });

      if (modelFile) {
        const nextPreview = URL.createObjectURL(modelFile);
        setLocalPreviewModel(nextPreview);
        setLocalPreviewLabel(modelFile.name);
        setUploadedModelName(modelFile.name);
      }

      if (imageFiles.length > 0) {
        const slotsLeft = Math.max(0, MAX_INPUT_REFERENCES - validInputReferences.length);
        if (slotsLeft <= 0) {
          pushUiError(`Можно добавить максимум ${MAX_INPUT_REFERENCES} референса.`);
          return;
        }
        const acceptedImageFiles = imageFiles.slice(0, slotsLeft);
        const loadedReferences = await Promise.all(
          acceptedImageFiles.map(async (file) => {
            const url = await fileToDataUrl(file);
            return {
              id: createId(),
              url,
              name: file.name.slice(0, 80) || "reference-image",
              type: file.type || "image/*",
              previewUrl: url,
              originalUrl: url,
            } as AiReferenceItem;
          })
        );
        setInputReferences((prev) => {
          const next = [...prev.filter(isAiReferenceItem), ...loadedReferences].slice(
            0,
            MAX_INPUT_REFERENCES
          );
          setUploadPreview(next[0]?.previewUrl ?? null);
          return next;
        });
        setLocalPreviewModel(null);
        setLocalPreviewLabel(null);
        setUploadedModelName(null);
        if (acceptedImageFiles.length < imageFiles.length) {
          pushUiError(`Лишние файлы пропущены. Лимит: ${MAX_INPUT_REFERENCES}.`);
        }
        return;
      }

      if (!modelFile) {
        pushUiError("Неподдерживаемый формат. Разрешены изображения и .glb/.gltf.");
      }
    },
    [pushUiError, validInputReferences.length]
  );

  const handleRemoveInputReference = useCallback((refId: string) => {
    setInputReferences((prev) => {
      const next = prev.filter((item) => isAiReferenceItem(item) && item.id !== refId);
      setUploadPreview(next[0]?.previewUrl ?? null);
      return next;
    });
  }, []);

  const clearInputReferences = useCallback(() => {
    setInputReferences([]);
    setUploadPreview(null);
  }, []);

  const handleRemoveReferenceBackground = useCallback(
    async (refId: string) => {
      if (removingReferenceBgId || smartMaskingReferenceId) return;
      const targetRef = validInputReferences.find((ref) => ref.id === refId);
      if (!targetRef) return;
      const sourceDataUrl = targetRef.previewUrl || targetRef.url;
      if (!sourceDataUrl.startsWith("data:image/")) {
        showError("Удаление фона доступно только для локально загруженных изображений.");
        return;
      }

      setRemovingReferenceBgId(refId);
      try {
        const cleaned = await removeBackgroundFromImageDataUrl(sourceDataUrl);
        if (cleaned === sourceDataUrl) {
          showError("Не удалось надежно выделить фон. Попробуйте другое изображение.");
          return;
        }

        setInputReferences((prev) => {
          const normalized = prev.filter(isAiReferenceItem);
          const next = normalized.map((item) =>
            item.id === refId
              ? {
                  ...item,
                  url: cleaned,
                  previewUrl: cleaned,
                  type: "image/png",
                  originalUrl: item.originalUrl ?? item.url,
                }
              : item
          );
          setUploadPreview(next[0]?.previewUrl ?? null);
          return next;
        });
        showSuccess("Фон удален. Обновленный референс готов.");
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Failed to remove image background.");
      } finally {
        setRemovingReferenceBgId(null);
      }
    },
    [
      pushUiError,
      removingReferenceBgId,
      showError,
      showSuccess,
      smartMaskingReferenceId,
      validInputReferences,
    ]
  );

  const handleSmartMaskReference = useCallback(
    async (refId: string) => {
      if (removingReferenceBgId || smartMaskingReferenceId) return;
      const targetRef = validInputReferences.find((ref) => ref.id === refId);
      if (!targetRef) return;
      const sourceDataUrl = targetRef.previewUrl || targetRef.url;
      if (!sourceDataUrl.startsWith("data:image/")) {
        showError("Умная маска доступна только для локально загруженных изображений.");
        return;
      }
      try {
        const hasAlphaCutout = await imageHasAlphaCutout(sourceDataUrl);
        if (!hasAlphaCutout) {
          showError("MASK+ работает после RM BG. Сначала удалите фон.");
          return;
        }

        setSmartMaskingReferenceId(refId);
        const cleaned = await trimResidualBackground(sourceDataUrl, {
          aggressive: true,
          allowSmallChange: true,
          });
        if (cleaned === sourceDataUrl) {
          showError("Умная маска не нашла, что доработать на этом референсе.");
          return;
        }

        setInputReferences((prev) => {
          const normalized = prev.filter(isAiReferenceItem);
          const next = normalized.map((item) =>
            item.id === refId
              ? {
                  ...item,
                  url: cleaned,
                  previewUrl: cleaned,
                  type: "image/png",
                  originalUrl: item.originalUrl ?? item.url,
                }
              : item
          );
          setUploadPreview(next[0]?.previewUrl ?? null);
          return next;
        });
        showSuccess("Умная маска применена.");
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Failed to apply smart mask.");
      } finally {
        setSmartMaskingReferenceId(null);
      }
    },
    [
      pushUiError,
      removingReferenceBgId,
      showError,
      showSuccess,
      smartMaskingReferenceId,
      validInputReferences,
    ]
  );

  const handleDownloadReference = useCallback(
    (ref: AiReferenceItem) => {
      if (typeof window === "undefined") return;
      const sourceDataUrl = ref.previewUrl || ref.url;
      if (!sourceDataUrl.startsWith("data:image/")) {
        showError("Скачать можно только локальный PNG/JPG/WebP референс.");
        return;
      }
      const link = document.createElement("a");
      link.href = sourceDataUrl;
      const base = sanitizeFilenameBase(ref.name, "reference");
      link.download = `${base}-cutout.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    [showError]
  );

  const renderMaskEditorCanvas = useCallback(
    (overlayEnabled = maskShowOverlay) => {
      const canvas = maskCanvasRef.current;
      const sourcePixels = maskSourcePixelsRef.current;
      const alphaMask = maskAlphaRef.current;
      const width = maskWidthRef.current;
      const height = maskHeightRef.current;
      if (!canvas || !sourcePixels || !alphaMask || width <= 0 || height <= 0) return;

      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;

      const output = new Uint8ClampedArray(sourcePixels.length);
      const pixelCount = width * height;
      for (let i = 0; i < pixelCount; i += 1) {
        const idx = i * 4;
        const alpha = alphaMask[i];
        let r = sourcePixels[idx];
        let g = sourcePixels[idx + 1];
        let b = sourcePixels[idx + 2];

        if (overlayEnabled && alpha < 250) {
          const strength = clampNumber((255 - alpha) / 255, 0, 1);
          const tint = 0.72 * strength;
          r = Math.round(r * (1 - tint) + 255 * tint);
          g = Math.round(g * (1 - tint) + 54 * tint);
          b = Math.round(b * (1 - tint) + 86 * tint);
        }

        output[idx] = r;
        output[idx + 1] = g;
        output[idx + 2] = b;
        output[idx + 3] = overlayEnabled ? 255 : alpha;
      }

      context.putImageData(new ImageData(output, width, height), 0, 0);

      if (overlayEnabled) {
        const antsThreshold = 180;
        const phase = maskAntsPhase % 12;
        for (let y = 0; y < height - 1; y += 1) {
          for (let x = 0; x < width - 1; x += 1) {
            const index = y * width + x;
            const here = alphaMask[index] >= antsThreshold;
            const right = alphaMask[index + 1] >= antsThreshold;
            const down = alphaMask[index + width] >= antsThreshold;
            if (here === right && here === down) continue;
            const tick = (x + y + phase) % 10;
            context.fillStyle = tick < 5 ? "rgba(255,255,255,0.88)" : "rgba(8,12,16,0.9)";
            context.fillRect(x, y, 1, 1);
          }
        }
      }
    },
    [maskAntsPhase, maskShowOverlay]
  );

  useEffect(() => {
    if (!maskEditorOpen) return;
    renderMaskEditorCanvas(maskShowOverlay);
  }, [maskEditorOpen, maskShowOverlay, maskAntsPhase, renderMaskEditorCanvas]);

  useEffect(() => {
    if (!maskEditorOpen || !maskShowOverlay) return;
    const timer = window.setInterval(() => {
      setMaskAntsPhase((value) => (value + 1) % 1200);
    }, 120);
    return () => window.clearInterval(timer);
  }, [maskEditorOpen, maskShowOverlay]);

  useEffect(() => {
    if (!maskEditorOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setMaskWandAltPressed(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setMaskWandAltPressed(false);
      }
    };
    const handleBlur = () => setMaskWandAltPressed(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [maskEditorOpen]);

  const pushMaskUndoSnapshot = useCallback(() => {
    const alphaMask = maskAlphaRef.current;
    if (!alphaMask) return;
    maskUndoStackRef.current.push(alphaMask.slice());
    if (maskUndoStackRef.current.length > 20) {
      maskUndoStackRef.current.splice(0, maskUndoStackRef.current.length - 20);
    }
    maskRedoStackRef.current = [];
    setMaskHistoryRevision((value) => value + 1);
  }, []);

  const paintMaskAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = maskCanvasRef.current;
      const alphaMask = maskAlphaRef.current;
      const sourceAlpha = maskSourceAlphaRef.current;
      if (!canvas || !alphaMask || !sourceAlpha) return;

      const width = maskWidthRef.current;
      const height = maskHeightRef.current;
      if (width <= 0 || height <= 0) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const x = ((clientX - rect.left) * width) / rect.width;
      const y = ((clientY - rect.top) * height) / rect.height;
      const radius = Math.max(1.5, (maskBrushSize * width) / rect.width);
      const radiusSq = radius * radius;
      const minX = clampNumber(Math.floor(x - radius), 0, width - 1);
      const maxX = clampNumber(Math.ceil(x + radius), 0, width - 1);
      const minY = clampNumber(Math.floor(y - radius), 0, height - 1);
      const maxY = clampNumber(Math.ceil(y + radius), 0, height - 1);

      let changed = false;
      for (let py = minY; py <= maxY; py += 1) {
        const dy = py - y;
        for (let px = minX; px <= maxX; px += 1) {
          const dx = px - x;
          if (dx * dx + dy * dy > radiusSq) continue;
          const index = py * width + px;
          const target = maskMode === "erase" ? 0 : sourceAlpha[index];
          if (alphaMask[index] !== target) {
            alphaMask[index] = target;
            changed = true;
          }
        }
      }

      if (changed) {
        renderMaskEditorCanvas(maskShowOverlay);
      }
    },
    [maskBrushSize, maskMode, maskShowOverlay, renderMaskEditorCanvas]
  );

  const applyWandAt = useCallback(
    (clientX: number, clientY: number, restore = false) => {
      const canvas = maskCanvasRef.current;
      const alphaMask = maskAlphaRef.current;
      const sourceAlpha = maskSourceAlphaRef.current;
      const sourcePixels = maskSourcePixelsRef.current;
      if (!canvas || !alphaMask || !sourceAlpha || !sourcePixels) return;

      const width = maskWidthRef.current;
      const height = maskHeightRef.current;
      if (width <= 0 || height <= 0) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const px = clampNumber(Math.floor(((clientX - rect.left) * width) / rect.width), 0, width - 1);
      const py = clampNumber(Math.floor(((clientY - rect.top) * height) / rect.height), 0, height - 1);
      const seedIndex = py * width + px;
      const seedOffset = seedIndex * 4;
      const seedR = sourcePixels[seedOffset];
      const seedG = sourcePixels[seedOffset + 1];
      const seedB = sourcePixels[seedOffset + 2];
      const seedA = sourcePixels[seedOffset + 3];
      const seedLuma = 0.2126 * seedR + 0.7152 * seedG + 0.0722 * seedB;

      const tolerance = clampNumber(maskWandTolerance, 1, 100) / 100;
      const maxDeltaRgbSq = Math.pow(24 + tolerance * 160, 2);
      const maxDeltaAlpha = 10 + tolerance * 120;
      const maxLumaDelta = 12 + tolerance * 100;

      const visited = new Uint8Array(width * height);
      const queue = new Int32Array(width * height);
      let read = 0;
      let write = 0;
      let touchesOuterBoundary = false;
      const matched: number[] = [];

      queue[write++] = seedIndex;
      visited[seedIndex] = 1;

      while (read < write) {
        const index = queue[read++];
        const offset = index * 4;
        const r = sourcePixels[offset];
        const g = sourcePixels[offset + 1];
        const b = sourcePixels[offset + 2];
        const a = sourcePixels[offset + 3];
        const dr = r - seedR;
        const dg = g - seedG;
        const db = b - seedB;
        const rgbSq = dr * dr + dg * dg + db * db;
        if (rgbSq > maxDeltaRgbSq) continue;
        if (Math.abs(a - seedA) > maxDeltaAlpha) continue;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (Math.abs(luma - seedLuma) > maxLumaDelta) continue;

        const x = index % width;
        const y = Math.floor(index / width);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          touchesOuterBoundary = true;
        }
        matched.push(index);
        if (x > 0) {
          const left = index - 1;
          if (!visited[left]) {
            visited[left] = 1;
            queue[write++] = left;
          }
        }
        if (x < width - 1) {
          const right = index + 1;
          if (!visited[right]) {
            visited[right] = 1;
            queue[write++] = right;
          }
        }
        if (y > 0) {
          const up = index - width;
          if (!visited[up]) {
            visited[up] = 1;
            queue[write++] = up;
          }
        }
        if (y < height - 1) {
          const down = index + width;
          if (!visited[down]) {
            visited[down] = 1;
            queue[write++] = down;
          }
        }
      }

      if (!restore && maskWandOuterOnly && !touchesOuterBoundary) {
        return;
      }

      let changed = false;
      const targetAlphaValue = restore ? 255 : 0;
      for (const index of matched) {
        const targetAlpha = restore ? sourceAlpha[index] : targetAlphaValue;
        if (alphaMask[index] !== targetAlpha) {
          alphaMask[index] = targetAlpha;
          changed = true;
        }
      }

      if (changed) {
        renderMaskEditorCanvas(maskShowOverlay);
      }
    },
    [maskShowOverlay, maskWandOuterOnly, maskWandTolerance, renderMaskEditorCanvas]
  );

  const handleMaskCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (maskApplying) return;
      event.preventDefault();
      if (!maskAlphaRef.current) return;
      if (maskMode === "wand") {
        pushMaskUndoSnapshot();
        const baseRestore = maskWandAction === "restore";
        const invert = event.altKey || event.button === 2;
        const restore = invert ? !baseRestore : baseRestore;
        applyWandAt(event.clientX, event.clientY, restore);
        return;
      }
      pushMaskUndoSnapshot();
      maskDrawingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      paintMaskAt(event.clientX, event.clientY);
    },
    [applyWandAt, maskApplying, maskMode, maskWandAction, paintMaskAt, pushMaskUndoSnapshot]
  );

  const handleMaskCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!maskDrawingRef.current) return;
      event.preventDefault();
      paintMaskAt(event.clientX, event.clientY);
    },
    [paintMaskAt]
  );

  const handleMaskCanvasPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!maskDrawingRef.current) return;
    event.preventDefault();
    maskDrawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleMaskUndo = useCallback(() => {
    const alphaMask = maskAlphaRef.current;
    if (!alphaMask || maskUndoStackRef.current.length === 0) return;
    const previous = maskUndoStackRef.current.pop();
    if (!previous) return;
    maskRedoStackRef.current.push(alphaMask.slice());
    maskAlphaRef.current = previous.slice();
    setMaskHistoryRevision((value) => value + 1);
    renderMaskEditorCanvas(maskShowOverlay);
  }, [maskShowOverlay, renderMaskEditorCanvas]);

  const handleMaskRedo = useCallback(() => {
    const alphaMask = maskAlphaRef.current;
    if (!alphaMask || maskRedoStackRef.current.length === 0) return;
    const next = maskRedoStackRef.current.pop();
    if (!next) return;
    maskUndoStackRef.current.push(alphaMask.slice());
    maskAlphaRef.current = next.slice();
    setMaskHistoryRevision((value) => value + 1);
    renderMaskEditorCanvas(maskShowOverlay);
  }, [maskShowOverlay, renderMaskEditorCanvas]);

  const handleMaskReset = useCallback(() => {
    const initialAlpha = maskInitialAlphaRef.current;
    if (!initialAlpha) return;
    maskAlphaRef.current = initialAlpha.slice();
    maskUndoStackRef.current = [];
    maskRedoStackRef.current = [];
    setMaskHistoryRevision((value) => value + 1);
    renderMaskEditorCanvas(maskShowOverlay);
  }, [maskShowOverlay, renderMaskEditorCanvas]);

  const handleMaskInvert = useCallback(() => {
    const sourceAlpha = maskSourceAlphaRef.current;
    const alphaMask = maskAlphaRef.current;
    if (!sourceAlpha || !alphaMask) return;
    pushMaskUndoSnapshot();
    for (let i = 0; i < alphaMask.length; i += 1) {
      alphaMask[i] = clampNumber(sourceAlpha[i] - alphaMask[i], 0, sourceAlpha[i]);
    }
    renderMaskEditorCanvas(maskShowOverlay);
  }, [maskShowOverlay, pushMaskUndoSnapshot, renderMaskEditorCanvas]);

  const closeMaskEditor = useCallback(() => {
    if (maskApplying) return;
    maskDrawingRef.current = false;
    setMaskEditorOpen(false);
    setMaskEditorRefId(null);
    maskSourcePixelsRef.current = null;
    maskSourceAlphaRef.current = null;
    maskInitialAlphaRef.current = null;
    maskAlphaRef.current = null;
    maskWidthRef.current = 0;
    maskHeightRef.current = 0;
    maskUndoStackRef.current = [];
    maskRedoStackRef.current = [];
    setMaskWandAltPressed(false);
    setMaskHistoryRevision((value) => value + 1);
  }, [maskApplying]);

  const handleOpenMaskEditor = useCallback(
    async (refId: string) => {
      if (maskEditorLoading || maskApplying) return;
      const targetRef = validInputReferences.find((ref) => ref.id === refId);
      if (!targetRef) return;
      const sourceDataUrl = targetRef.previewUrl || targetRef.url;
      if (!sourceDataUrl.startsWith("data:image/")) {
        showError("Ручная маска доступна только для локально загруженных изображений.");
        return;
      }

      setMaskEditorLoading(true);
      try {
        const editableImage = await loadImageFromDataUrl(sourceDataUrl);
        const width = editableImage.naturalWidth || editableImage.width;
        const height = editableImage.naturalHeight || editableImage.height;
        if (width <= 0 || height <= 0) {
          throw new Error("Invalid image dimensions.");
        }
        const originalDataUrl =
          typeof targetRef.originalUrl === "string" && targetRef.originalUrl.startsWith("data:image/")
            ? targetRef.originalUrl
            : sourceDataUrl;
        const restoreImage =
          originalDataUrl === sourceDataUrl
            ? editableImage
            : await loadImageFromDataUrl(originalDataUrl);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          throw new Error("Canvas context is unavailable.");
        }

        context.clearRect(0, 0, width, height);
        context.drawImage(restoreImage, 0, 0, width, height);
        const restoreImageData = context.getImageData(0, 0, width, height);
        const restorePixels = restoreImageData.data.slice();
        const restoreAlpha = new Uint8Array(width * height);
        for (let i = 0; i < restoreAlpha.length; i += 1) {
          restoreAlpha[i] = restorePixels[i * 4 + 3];
        }

        context.clearRect(0, 0, width, height);
        context.drawImage(editableImage, 0, 0, width, height);
        const editableImageData = context.getImageData(0, 0, width, height);
        const editablePixels = editableImageData.data;
        const initialAlpha = new Uint8Array(width * height);
        for (let i = 0; i < initialAlpha.length; i += 1) {
          initialAlpha[i] = editablePixels[i * 4 + 3];
        }

        maskSourcePixelsRef.current = restorePixels;
        maskSourceAlphaRef.current = restoreAlpha;
        maskInitialAlphaRef.current = initialAlpha;
        maskAlphaRef.current = initialAlpha.slice();
        maskWidthRef.current = width;
        maskHeightRef.current = height;
        maskUndoStackRef.current = [];
        maskRedoStackRef.current = [];
        maskImageNameRef.current = targetRef.name || "reference";
        setMaskHistoryRevision((value) => value + 1);

        setMaskMode("erase");
        setMaskBrushSize(28);
        setMaskWandAction("erase");
        setMaskWandOuterOnly(true);
        setMaskFeatherPx(1);
        setMaskWandAltPressed(false);
        setMaskShowOverlay(true);
        setMaskEditorRefId(refId);
        setMaskEditorOpen(true);
        requestAnimationFrame(() => {
          renderMaskEditorCanvas(true);
        });
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Failed to open mask editor.");
      } finally {
        setMaskEditorLoading(false);
      }
    },
    [
      maskApplying,
      maskEditorLoading,
      pushUiError,
      renderMaskEditorCanvas,
      showError,
      validInputReferences,
    ]
  );

  const handleApplyMaskEditor = useCallback(() => {
    if (!maskEditorRefId || maskApplying) return;
    const sourcePixels = maskSourcePixelsRef.current;
    const alphaMask = maskAlphaRef.current;
    const width = maskWidthRef.current;
    const height = maskHeightRef.current;
    if (!sourcePixels || !alphaMask || width <= 0 || height <= 0) {
      showError("Mask editor data is unavailable.");
      return;
    }

    setMaskApplying(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas context is unavailable.");

      const output = new Uint8ClampedArray(sourcePixels.length);
      const finalAlpha = maskFeatherPx > 0 ? featherAlphaMask(alphaMask, width, height, maskFeatherPx) : alphaMask;
      for (let i = 0; i < finalAlpha.length; i += 1) {
        const idx = i * 4;
        output[idx] = sourcePixels[idx];
        output[idx + 1] = sourcePixels[idx + 1];
        output[idx + 2] = sourcePixels[idx + 2];
        output[idx + 3] = finalAlpha[i];
      }
      context.putImageData(new ImageData(output, width, height), 0, 0);
      const outputDataUrl = canvas.toDataURL("image/png");

      setInputReferences((prev) => {
        const normalized = prev.filter(isAiReferenceItem);
        const next = normalized.map((item) =>
          item.id === maskEditorRefId
            ? {
                ...item,
                url: outputDataUrl,
                previewUrl: outputDataUrl,
                type: "image/png",
                originalUrl: item.originalUrl ?? item.url,
              }
            : item
        );
        setUploadPreview(next[0]?.previewUrl ?? null);
        return next;
      });
      showSuccess("Ручная маска применена.");
      closeMaskEditor();
    } catch (error) {
      pushUiError(error instanceof Error ? error.message : "Failed to apply mask.");
    } finally {
      setMaskApplying(false);
    }
  }, [closeMaskEditor, maskApplying, maskEditorRefId, maskFeatherPx, pushUiError, showError, showSuccess]);

  const handleRemixIssueFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;

      const isImageType =
        file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name.toLowerCase());
      if (!isImageType) {
        showError("Добавьте изображение (PNG/JPG/WebP).");
        return;
      }

      setRemixIssueLoading(true);
      try {
        const dataUrl = await fileToDataUrl(file);
        setRemixIssueReference({
          id: createId(),
          url: dataUrl,
          name: file.name.slice(0, 80) || "issue-reference",
          type: file.type || "image/*",
          previewUrl: dataUrl,
          originalUrl: dataUrl,
        });
        showSuccess("Скрин проблемы добавлен в remix.");
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Failed to attach issue screenshot.");
      } finally {
        setRemixIssueLoading(false);
      }
    },
    [pushUiError, showError, showSuccess]
  );

  const closeRemixDialog = useCallback(() => {
    setRemixJob(null);
    setRemixPrompt("");
    setRemixLocalEdit(false);
    setRemixTargetZone("ноги");
    setRemixIssueReference(null);
    setRemixIssueLoading(false);
  }, []);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    void handleFiles(event.dataTransfer.files);
  };

  const handleBrowse = () => {
    uploadInputRef.current?.click();
  };

  const registerGeneratedAsset = useCallback(
    (args: {
      name: string;
      modelUrl: string;
      previewImage?: string | null;
      format?: string;
      localOnly?: boolean;
    }) => {
      const normalizedFormat =
        args.format === "gltf" || args.modelUrl.toLowerCase().endsWith(".gltf")
          ? "gltf"
          : "glb";
      const asset: GeneratedAsset = {
        id: createId(),
        name: args.name.trim().slice(0, 48) || "AI Model",
        createdAt: Date.now(),
        previewImage: args.previewImage ?? null,
        modelUrl: args.modelUrl,
        format: normalizedFormat,
        localOnly: args.localOnly ?? false,
      };
      setGallery((prev) => [asset, ...prev].slice(0, GALLERY_LIMIT));
      setResultAsset(asset);
      setShowResult(true);
      setGeneratedPreviewModel(asset.modelUrl ?? null);
      setGeneratedPreviewLabel(asset.name);
    },
    []
  );

  const fetchJobHistory = useCallback(
    async (silent = true) => {
      if (jobHistoryRequestInFlightRef.current) return;
      jobHistoryRequestInFlightRef.current = true;
      if (!silent) setJobHistoryLoading(true);
      try {
        const response = await fetch(`${AI_GENERATE_API_URL}?limit=8`, {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "Failed to fetch AI jobs.");
        }
        const jobs = Array.isArray(data?.jobs) ? (data.jobs as AiGenerationJob[]) : [];
        setJobHistory(jobs.filter(isAiGenerationJobLike));
      } catch (error) {
        if (!silent) {
          pushUiError(error instanceof Error ? error.message : "Failed to fetch AI jobs.");
        }
      } finally {
        jobHistoryRequestInFlightRef.current = false;
        if (!silent) setJobHistoryLoading(false);
      }
    },
    [pushUiError]
  );

  const fetchPublishedAssets = useCallback(
    async (silent = true) => {
      try {
        const response = await fetch(`${AI_ASSETS_API_URL}?limit=60`, {
          method: "GET",
          credentials: "include",
        });
        if (response.status === 401) {
          if (!silent) {
            setPublishedAssetsByJobId({});
            setPublishedAssetsById({});
          }
          return;
        }
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (!silent) {
            throw new Error(typeof data?.error === "string" ? data.error : "Failed to fetch AI assets.");
          }
          return;
        }
        const assets = Array.isArray(data?.assets) ? (data.assets as AiAssetRecord[]) : [];
        const next: Record<string, string> = {};
        const byId: Record<string, AiAssetRecord> = {};
        assets.forEach((asset) => {
          if (asset?.id) {
            byId[String(asset.id)] = asset;
          }
          if (asset?.jobId && !next[String(asset.jobId)]) {
            next[String(asset.jobId)] = String(asset.id);
          }
        });
        setPublishedAssetsByJobId(next);
        setPublishedAssetsById(byId);
      } catch (error) {
        if (!silent) {
          pushUiError(error instanceof Error ? error.message : "Failed to fetch AI assets.");
        }
      }
    },
    [pushUiError]
  );

  useEffect(() => {
    void fetchJobHistory(false);
  }, [fetchJobHistory]);

  useEffect(() => {
    void fetchPublishedAssets(false);
  }, [fetchPublishedAssets]);

  const handleStartServerSynthesis = useCallback(async () => {
    if (serverJobLoading || isSynthRunning) return;
    if (tokensLoading) {
      showError("Tokens are still loading.");
      return;
    }
    if (tokens < tokenCost) {
      showError(`Not enough tokens. Need ${tokenCost}.`);
      return;
    }
    if (!prompt.trim() && validInputReferences.length === 0 && !localPreviewModel && !previewModel) {
      showError("Add a prompt or reference before generation.");
      return;
    }

    setServerJobLoading(true);
    setServerJobError(null);
    setShowResult(false);
    setResultAsset(null);
    setLatestCompletedJob(null);

    try {
      const sourceRefsPayload = validInputReferences
        .map((ref) => ({
          url: ref.url,
          name: ref.name,
          type: ref.type,
        }))
        .slice(0, MAX_INPUT_REFERENCES);
      if (previewModel && !sourceRefsPayload.some((ref) => ref.url === previewModel)) {
        sourceRefsPayload.unshift({
          url: previewModel,
          name: "preview-model",
          type: "model/preview",
        });
      }
      const response = await fetch(AI_GENERATE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode,
          prompt: prompt.trim(),
          sourceUrl: previewModel || "",
          sourceRefs: sourceRefsPayload.slice(0, MAX_INPUT_REFERENCES),
          hasImageReference: Boolean(validInputReferences.length > 0 || localPreviewModel || previewModel),
        }),
      });
      const data = await response.json().catch(() => null);
      if (typeof data?.tokensRemaining === "number" && Number.isFinite(data.tokensRemaining)) {
        setTokens(Math.max(0, Math.trunc(data.tokensRemaining)));
        void fetchTokenHistory(true);
      }
      if (typeof data?.tokenCost === "number" && Number.isFinite(data.tokenCost) && data.tokenCost > 0) {
        setTokenCost(Math.max(1, Math.trunc(data.tokenCost)));
      }
      if (!response.ok) {
        const message =
          typeof data?.error === "string" ? data.error : "Failed to create AI job.";
        throw new Error(message);
      }
      if (typeof data?.tokensRemaining !== "number") {
        void fetchTokens(true);
        void fetchTokenHistory(true);
      }
      const nextJob = data?.job as AiGenerationJob | undefined;
      if (!nextJob?.id) {
        throw new Error("Server returned invalid AI job payload.");
      }
      completedServerJobRef.current = null;
      setServerJob(nextJob);
      void fetchJobHistory(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create AI job.";
      const normalizedMessage = toUiErrorMessage(message);
      setServerJobError(normalizedMessage);
      pushUiError(normalizedMessage);
    } finally {
      setServerJobLoading(false);
    }
  }, [
    fetchJobHistory,
    fetchTokenHistory,
    fetchTokens,
    localPreviewModel,
    mode,
    isSynthRunning,
    previewModel,
    prompt,
    pushUiError,
    serverJobLoading,
    showError,
    tokenCost,
    tokens,
    tokensLoading,
    validInputReferences,
  ]);

  useEffect(() => {
    if (!serverJob?.id) return;
    if (serverJob.status === "completed" || serverJob.status === "failed") return;

    let cancelled = false;
    let timer: number | null = null;
    let pollInFlight = false;
    let failureCount = 0;

    const poll = async () => {
      if (cancelled || pollInFlight) return;
      pollInFlight = true;
      try {
        const response = await fetch(`${AI_GENERATE_API_URL}/${encodeURIComponent(serverJob.id)}`, {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            typeof data?.error === "string"
              ? data.error
              : "Не удалось получить статус AI-задачи.";
          throw new Error(message);
        }

        const nextJob = data?.job as AiGenerationJob | undefined;
        if (!nextJob?.id || cancelled) return;

        setServerJob(nextJob);
        if (nextJob.status === "failed") {
          const message = nextJob.errorMessage || "AI-задача завершилась с ошибкой.";
          const normalizedMessage = toUiErrorMessage(message);
          setServerJobError(normalizedMessage);
          pushUiError(normalizedMessage);
          void fetchJobHistory(true);
        } else if (
          nextJob.status === "completed" &&
          nextJob.result?.modelUrl &&
          completedServerJobRef.current !== nextJob.id
        ) {
          completedServerJobRef.current = nextJob.id;
          setLatestCompletedJob(nextJob);
          registerGeneratedAsset({
            name: nextJob.prompt || "AI Model",
            modelUrl: nextJob.result.modelUrl,
            previewImage: nextJob.result.previewUrl || validInputReferences[0]?.previewUrl || null,
            format: nextJob.result.format,
            localOnly: false,
          });
          clearInputReferences();
          void fetchJobHistory(true);
        }
        failureCount = 0;
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Не удалось обновить статус AI-задачи.";
        setServerJobError(toUiErrorMessage(message));
        failureCount = Math.min(5, failureCount + 1);
      } finally {
        pollInFlight = false;
        if (!cancelled) {
          const hiddenDelay =
            typeof document !== "undefined" && document.visibilityState === "hidden" ? 4200 : 1600;
          const backoffDelay = failureCount * 1100;
          timer = window.setTimeout(() => {
            void poll();
          }, hiddenDelay + backoffDelay);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    clearInputReferences,
    fetchJobHistory,
    pushUiError,
    registerGeneratedAsset,
    serverJob?.id,
    serverJob?.status,
    validInputReferences,
  ]);

  const handleSelectAsset = (asset: GeneratedAsset) => {
    if (!asset.modelUrl) {
      showError("Файл модели недоступен. Загрузите модель заново.");
      return;
    }
    setGeneratedPreviewModel(asset.modelUrl);
    setGeneratedPreviewLabel(asset.name);
  };

  const handleDownload = (asset: GeneratedAsset) => {
    if (typeof window === "undefined") return;
    if (asset.modelUrl) {
      const link = document.createElement("a");
      link.href = asset.modelUrl;
      const extension = asset.format === "gltf" ? "gltf" : "glb";
      link.download = `${asset.name}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    if (asset.previewImage) {
      const link = document.createElement("a");
      link.href = asset.previewImage;
      link.download = `${asset.name}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    showError("Нет файла для скачивания.");
  };

  const handlePickHistoryJob = (job: AiGenerationJob) => {
    if (job.mode === "text" || job.mode === "image") {
      setMode(job.mode);
    }
    if (job.prompt) {
      setPrompt(job.prompt);
    }
    if (job.result?.modelUrl) {
      setGeneratedPreviewModel(job.result.modelUrl);
      setGeneratedPreviewLabel(job.prompt || `Job ${job.id}`);
    }
    const refs = Array.isArray(job.inputRefs)
      ? job.inputRefs
          .map((ref) => {
            const url = typeof ref?.url === "string" ? ref.url.trim() : "";
            if (!url || url.startsWith("inline://")) return null;
            const previewUrl = url.startsWith("data:") ? url : null;
            return {
              id: createId(),
              url,
              name:
                typeof ref?.name === "string" && ref.name.trim()
                  ? ref.name.trim().slice(0, 80)
                  : "history-reference",
              type:
                typeof ref?.type === "string" && ref.type.trim()
                  ? ref.type.trim().slice(0, 80)
                  : "image/*",
              previewUrl,
              originalUrl: previewUrl,
            } as AiReferenceItem;
          })
          .filter(Boolean) as AiReferenceItem[]
      : [];
    setInputReferences(refs.slice(0, MAX_INPUT_REFERENCES));
    setUploadPreview(refs[0]?.previewUrl ?? null);
  };

  const handleRetryHistoryJob = useCallback(
    async (job: AiGenerationJob) => {
      if (serverJobLoading || isSynthRunning) {
        showError("Wait until current generation is finished.");
        return;
      }
      if (tokensLoading) {
        showError("Tokens are still loading.");
        return;
      }
      if (tokens < tokenCost) {
        showError(`Not enough tokens. Need ${tokenCost}.`);
        return;
      }

      setHistoryAction({ id: job.id, type: "retry" });
      setServerJobError(null);
      setShowResult(false);
      setResultAsset(null);
      setLatestCompletedJob(null);

      try {
        const response = await fetch(`${AI_GENERATE_API_URL}/${encodeURIComponent(job.id)}`, {
          method: "POST",
          credentials: "include",
        });
        const data = await response.json().catch(() => null);
        if (typeof data?.tokensRemaining === "number" && Number.isFinite(data.tokensRemaining)) {
          setTokens(Math.max(0, Math.trunc(data.tokensRemaining)));
          void fetchTokenHistory(true);
        }
        if (typeof data?.tokenCost === "number" && Number.isFinite(data.tokenCost) && data.tokenCost > 0) {
          setTokenCost(Math.max(1, Math.trunc(data.tokenCost)));
        }
        if (!response.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "Failed to retry AI job.");
        }
        if (typeof data?.tokensRemaining !== "number") {
          void fetchTokens(true);
          void fetchTokenHistory(true);
        }
        const nextJob = data?.job as AiGenerationJob | undefined;
        if (!nextJob?.id) {
          throw new Error("Server returned invalid retry payload.");
        }
        completedServerJobRef.current = null;
        setServerJob(nextJob);
        void fetchJobHistory(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to retry AI job.";
        const normalizedMessage = toUiErrorMessage(message);
        setServerJobError(normalizedMessage);
        pushUiError(normalizedMessage);
      } finally {
        setHistoryAction((prev) =>
          prev?.id === job.id && prev?.type === "retry" ? null : prev
        );
      }
    },
    [
      fetchJobHistory,
      fetchTokenHistory,
      fetchTokens,
      isSynthRunning,
      pushUiError,
      serverJobLoading,
      showError,
      tokenCost,
      tokens,
      tokensLoading,
    ]
  );

  const handleVariationHistoryJob = useCallback(
    async (
      job: AiGenerationJob,
      customPrompt?: string,
      options?: {
        localEdit?: boolean;
        targetZone?: string;
        issueReference?: AiReferenceItem | null;
      }
    ) => {
      if (job.status !== "completed") {
        showError("Variation is available only for completed jobs.");
        return false;
      }
      if (serverJobLoading || isSynthRunning) {
        showError("Wait until current generation is finished.");
        return false;
      }
      if (tokensLoading) {
        showError("Tokens are still loading.");
        return false;
      }
      if (tokens < tokenCost) {
        showError(`Not enough tokens. Need ${tokenCost}.`);
        return false;
      }

      setHistoryAction({ id: job.id, type: "variation" });
      setServerJobError(null);
      setShowResult(false);
      setResultAsset(null);
      setLatestCompletedJob(null);

      try {
        const basePrompt = typeof customPrompt === "string" ? customPrompt.trim().slice(0, 800) : "";
        const targetZone = typeof options?.targetZone === "string" ? options.targetZone.trim().slice(0, 120) : "";
        const effectivePrompt = options?.localEdit
          ? [
              basePrompt || "Исправь дефект в указанной зоне.",
              `Целевая зона: ${targetZone || "проблемная часть модели"}.`,
              "Измени только эту зону.",
              "Остальную геометрию, позу, пропорции, стиль и материалы не меняй.",
              "Сохрани масштаб и общую композицию модели.",
            ]
              .join(" ")
              .slice(0, 800)
          : basePrompt;

        const issueReference = isAiReferenceItem(options?.issueReference)
          ? {
              url: options.issueReference.url,
              name: options.issueReference.name,
              type: options.issueReference.type,
            }
          : null;

        const response = await fetch(`${AI_GENERATE_API_URL}/${encodeURIComponent(job.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            action: "variation",
            parentAssetId: publishedAssetsByJobId[job.id] || null,
            prompt: effectivePrompt,
            ...(issueReference ? { sourceRefs: [issueReference] } : {}),
          }),
        });
        const data = await response.json().catch(() => null);
        if (typeof data?.tokensRemaining === "number" && Number.isFinite(data.tokensRemaining)) {
          setTokens(Math.max(0, Math.trunc(data.tokensRemaining)));
          void fetchTokenHistory(true);
        }
        if (typeof data?.tokenCost === "number" && Number.isFinite(data.tokenCost) && data.tokenCost > 0) {
          setTokenCost(Math.max(1, Math.trunc(data.tokenCost)));
        }
        if (!response.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "Failed to create variation.");
        }
        if (typeof data?.tokensRemaining !== "number") {
          void fetchTokens(true);
          void fetchTokenHistory(true);
        }
        const nextJob = data?.job as AiGenerationJob | undefined;
        if (!nextJob?.id) {
          throw new Error("Server returned invalid variation payload.");
        }
        completedServerJobRef.current = null;
        setServerJob(nextJob);
        void fetchJobHistory(true);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create variation.";
        const normalizedMessage = toUiErrorMessage(message);
        setServerJobError(normalizedMessage);
        pushUiError(normalizedMessage);
        return false;
      } finally {
        setHistoryAction((prev) =>
          prev?.id === job.id && prev?.type === "variation" ? null : prev
        );
      }
    },
    [
      fetchJobHistory,
      fetchTokenHistory,
      fetchTokens,
      isSynthRunning,
      publishedAssetsByJobId,
      pushUiError,
      serverJobLoading,
      showError,
      tokenCost,
      tokens,
      tokensLoading,
    ]
  );

  const handleDeleteHistoryJob = useCallback(
    async (job: AiGenerationJob) => {
      setHistoryAction({ id: job.id, type: "delete" });
      try {
        const response = await fetch(`${AI_GENERATE_API_URL}/${encodeURIComponent(job.id)}`, {
          method: "DELETE",
          credentials: "include",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "Не удалось удалить AI-задачу.");
        }
        setJobHistory((prev) => prev.filter((item) => item.id !== job.id));
        if (serverJob?.id === job.id) {
          setServerJob(null);
          setServerJobError(null);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось удалить AI-задачу.";
        pushUiError(message);
      } finally {
        setHistoryAction((prev) =>
          prev?.id === job.id && prev?.type === "delete" ? null : prev
        );
      }
    },
    [pushUiError, serverJob?.id]
  );

  const handlePublishJob = useCallback(
    async (job: AiGenerationJob) => {
      if (!job?.id) {
        showError("Job id is missing.");
        return;
      }
      if (job.status !== "completed" || !job.result?.modelUrl) {
        showError("Only completed jobs can be published.");
        return;
      }
      if (publishedAssetsByJobId[job.id]) {
        showSuccess("Already saved in profile library.");
        return;
      }

      setHistoryAction({ id: job.id, type: "publish" });
      try {
        const response = await fetch(AI_ASSETS_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            jobId: job.id,
            title: (job.prompt || "AI Model").trim().slice(0, 90),
            previousAssetId: job.parentAssetId || undefined,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success || !data?.asset?.id) {
          throw new Error(typeof data?.error === "string" ? data.error : "Failed to save asset.");
        }

        setPublishedAssetsByJobId((prev) => ({
          ...prev,
          [job.id]: String(data.asset.id),
        }));
        showSuccess("Saved to profile AI library.");
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("ai-assets-updated"));
        }
        void fetchPublishedAssets(true);
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Failed to save asset.");
      } finally {
        setHistoryAction((prev) =>
          prev?.id === job.id && prev?.type === "publish" ? null : prev
        );
      }
    },
    [fetchPublishedAssets, publishedAssetsByJobId, pushUiError, showError, showSuccess]
  );

  const handleAnalyzePublishedAsset = useCallback(
    async (job: AiGenerationJob) => {
      const assetId = publishedAssetsByJobId[job.id];
      if (!assetId) {
        showError("Сначала сохраните результат в библиотеку профиля.");
        return;
      }
      if (assetAction) return;
      setAssetAction({ assetId, type: "analyze" });
      try {
        const response = await fetch(AI_ASSET_REPAIR_API(assetId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ mode: "analyze" }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          throw new Error(typeof data?.error === "string" ? data.error : "Analyze failed.");
        }
        const analysis = data?.analysis as
          | {
              riskScore?: number;
              fixAvailable?: boolean;
              issues?: Array<{ message?: string }>;
            }
          | undefined;
        const issue =
          Array.isArray(analysis?.issues) && analysis.issues[0]?.message
            ? String(analysis.issues[0].message)
            : "";
        showSuccess(
          analysis?.fixAvailable
            ? `Analyze: найден риск (Q:${analysis?.riskScore ?? "?"}). ${issue}`.trim()
            : `Analyze: критичных дефектов не найдено (Q:${analysis?.riskScore ?? "?"}).`
        );
        void fetchPublishedAssets(true);
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Analyze failed.");
      } finally {
        setAssetAction((prev) => (prev?.assetId === assetId ? null : prev));
      }
    },
    [assetAction, fetchPublishedAssets, publishedAssetsByJobId, pushUiError, showError, showSuccess]
  );

  const handleRepairPublishedAsset = useCallback(
    async (job: AiGenerationJob) => {
      const assetId = publishedAssetsByJobId[job.id];
      if (!assetId) {
        showError("Сначала сохраните результат в библиотеку профиля.");
        return;
      }
      if (assetAction) return;
      setAssetAction({ assetId, type: "repair" });
      try {
        const response = await fetch(AI_ASSET_REPAIR_API(assetId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ mode: "repair" }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          throw new Error(typeof data?.error === "string" ? data.error : "Auto-Fix failed.");
        }
        showSuccess(
          `Auto-Fix: создана версия ${
            typeof data?.repairedAsset?.version === "number"
              ? `v${data.repairedAsset.version}`
              : "v+1"
          }.`
        );
        void fetchPublishedAssets(true);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("ai-assets-updated"));
        }
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Auto-Fix failed.");
      } finally {
        setAssetAction((prev) => (prev?.assetId === assetId ? null : prev));
      }
    },
    [assetAction, fetchPublishedAssets, publishedAssetsByJobId, pushUiError, showError, showSuccess]
  );

  const filteredJobHistory = useMemo(() => {
    if (jobHistoryFilter === "all") return jobHistory;
    return jobHistory.filter((job) => job.status === jobHistoryFilter);
  }, [jobHistory, jobHistoryFilter]);

  const renderJobStatusTone = (status?: AiGenerationJob["status"]) => {
    if (status === "completed") return "text-emerald-300";
    if (status === "failed") return "text-rose-300";
    if (status === "processing") return "text-cyan-300";
    return "text-white/60";
  };

  const currentStatus = serverJob?.status?.toUpperCase() ?? "STANDBY";
  const displayProgress = Math.max(0, Math.min(100, serverJob?.progress ?? 0));
  const displayStage = serverJob?.stage?.trim() || (serverJob ? SERVER_STAGE_BY_STATUS[serverJob.status] : "STANDBY");
  const displayEta = formatEta(serverJob?.etaSeconds ?? null);
  const displayQueuePosition =
    typeof serverJob?.queuePosition === "number" && serverJob.queuePosition > 0
      ? `#${serverJob.queuePosition}`
      : "RUN";
  const displayQueueDepth =
    typeof serverJob?.queueDepth === "number" && Number.isFinite(serverJob.queueDepth)
      ? Math.max(0, Math.trunc(serverJob.queueDepth))
      : 0;
  const resultJob = latestCompletedJob ?? (serverJob?.status === "completed" ? serverJob : null);
  const isResultPublished = Boolean(resultJob?.id && publishedAssetsByJobId[resultJob.id]);
  const handlePrintResult = useCallback(() => {
    const modelUrl = resultAsset?.modelUrl || resultJob?.result?.modelUrl || "";
    if (!modelUrl) {
      showError("Model URL is missing.");
      return;
    }

    const params = new URLSearchParams();
    params.set("model", modelUrl);
    params.set("name", (resultAsset?.name || resultJob?.prompt || "AI Model").trim());
    const thumb = resultAsset?.previewImage || resultJob?.result?.previewUrl || "";
    if (thumb) params.set("thumb", thumb);
    params.set("tech", "sla");
    router.push(`/services/print?${params.toString()}`);
    setShowResult(false);
  }, [resultAsset, resultJob, router, showError]);
  const activePreviewModel = generatedPreviewModel ?? localPreviewModel ?? previewModel;
  const activePreviewLabel = generatedPreviewLabel ?? localPreviewLabel ?? previewLabel;
  const [modelScale, setModelScale] = useState(1);

  useEffect(() => {
    setModelScale(1);
  }, [activePreviewModel]);

  const handleBounds = useCallback((bounds: { size: number }) => {
    if (!bounds?.size || !Number.isFinite(bounds.size)) return;
    const nextScale = Math.min(1.25, Math.max(0.6, MODEL_STAGE_TARGET_SIZE / bounds.size));
    setModelScale(nextScale);
  }, []);
  const isDesktopPanelHidden = focusMode || panelCollapsed;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#030304] text-white">
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center page-bg-fade"
        style={{ backgroundImage: `url(${AI_LAB_BG})`, backgroundPosition: "center 70%", filter: "brightness(0.75)" }}
      />
      <div className="pointer-events-none fixed inset-0 z-10 bg-black/35" />
      <div className="pointer-events-none fixed inset-0 z-20 cad-grid-pattern opacity-[0.22]" />
      <div className="pointer-events-none fixed inset-0 z-20 bg-[radial-gradient(circle_at_top,_rgba(46,209,255,0.08),_transparent_50%),radial-gradient(circle_at_20%_20%,_rgba(148,163,184,0.07),_transparent_45%)]" />

      <header className="relative z-30 border-b border-white/10 bg-obsidian/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <a href="/store" className="text-xl font-bold tracking-[0.25em] text-white">
              3D-STORE
            </a>
            <div className="hidden items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/50 md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_12px_rgba(16,185,129,0.6)]" />
              LAB_STATUS: READY
            </div>
          </div>
          <nav className="flex items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/70 sm:gap-3">
            <a
              href="/store"
              className="hidden rounded-full border border-white/15 bg-white/5 px-3 py-2 transition hover:border-white/40 hover:text-white sm:inline-flex"
            >
              МАГАЗИН
            </a>
            <a
              href="/ai-lab"
              className="rounded-full border border-[#2ED1FF]/60 bg-[#0b1014] px-4 py-2 text-[#BFF4FF] shadow-[0_0_18px_rgba(46,209,255,0.4)] transition hover:border-[#7FE7FF] hover:text-white"
            >
              AI ЛАБОРАТОРИЯ
            </a>
          </nav>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className={`relative z-30 mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 pb-20 pt-10 sm:px-6 lg:grid ${
          isDesktopPanelHidden ? "lg:grid-cols-1" : "lg:grid-cols-[1.6fr_0.9fr]"
        }`}
      >
        <section
          className={`relative flex min-h-[520px] flex-col overflow-hidden rounded-[32px] bg-transparent ${
            focusMode ? "lg:min-h-[680px]" : ""
          }`}
        >
          {!focusMode && (
            <div className="absolute left-6 top-6 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/70">
              <Cpu className="h-3.5 w-3.5 text-[#2ED1FF]" />
              REACTOR_VIEW
            </div>
          )}
          <div className="absolute right-6 top-6 z-20 flex flex-wrap items-center justify-end gap-2">
            {!focusMode && (
              <div className="rounded-full border border-white/10 bg-black/50 px-3 py-2 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
                STAGE: EXPERIMENTAL // API INTEGRATION IN PROGRESS
              </div>
            )}
            <button
              type="button"
              onClick={() => setFocusMode((prev) => !prev)}
              className={`rounded-full border px-3 py-2 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] transition ${
                focusMode
                  ? "border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_14px_rgba(46,209,255,0.3)]"
                  : "border-white/20 bg-black/50 text-white/70 hover:border-white/40 hover:text-white"
              }`}
            >
              {focusMode ? "FOCUS ON" : "FOCUS"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (focusMode) setFocusMode(false);
                setPanelCollapsed((prev) => !prev);
              }}
              className={`rounded-full border px-3 py-2 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] transition ${
                isDesktopPanelHidden
                  ? "border-emerald-400/55 bg-emerald-500/10 text-emerald-200"
                  : "border-white/20 bg-black/50 text-white/70 hover:border-white/40 hover:text-white"
              }`}
            >
              {isDesktopPanelHidden ? "PANEL OFF" : "PANEL ON"}
            </button>
          </div>

          <div className="relative h-[520px] w-full sm:h-[600px] lg:h-full">
            <Canvas
              gl={{ alpha: true, antialias: true }}
              onCreated={({ gl }) => {
                gl.setClearColor(0x000000, 0);
              }}
              dpr={[1, 1.6]}
              camera={{ position: [3.6, 2.6, 4.6], fov: 40 }}
              className="h-full w-full"
            >
              <ambientLight intensity={0.65} />
              <ReactorLights active={isSynthRunning} />
              <FloorPulse active={isSynthRunning} />
              <Grid
                infiniteGrid
                sectionColor="#152b36"
                cellColor="#0b2230"
                fadeDistance={16}
                fadeStrength={4}
                position={[0, -1.2, 0]}
              />
              <Suspense fallback={null}>
                {activePreviewModel ? (
                  <group position={[0, MODEL_STAGE_OFFSET, 0]} scale={modelScale}>
                    <ModelView
                      rawModelUrl={activePreviewModel}
                      paintedModelUrl={null}
                      finish="Raw"
                      renderMode="final"
                      accentColor="#2ED1FF"
                      onBounds={handleBounds}
                    />
                  </group>
                ) : isSynthRunning ? (
                  <NeuralCore active />
                ) : null}
              </Suspense>
              <OrbitControls
                enablePan={false}
                enableZoom
                enableDamping
                autoRotate={false}
              />
              <Environment preset="city" />
            </Canvas>
            <div className="laser-scan pointer-events-none absolute inset-x-6 z-10 h-0.5 rounded-full bg-gradient-to-r from-transparent via-[#2ED1FF] to-transparent opacity-70 shadow-[0_0_18px_rgba(46,209,255,0.65)]" />
          </div>

          <div className="pointer-events-none absolute inset-0 z-10">
            <div className="absolute left-6 top-24 flex items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/60">
              <span className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_12px_rgba(16,185,129,0.6)]" />
              NEURAL_LINK: READY
            </div>
            {isSynthRunning && (
              <div className="absolute left-6 top-32 h-24 w-64 overflow-hidden rounded-xl border border-emerald-500/30 bg-black/60 p-3 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-emerald-200/80 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
                <div className="log-scroll space-y-2">
                  {logLines.concat(logLines).map((line, index) => (
                    <p key={`${line}-${index}`} className="whitespace-nowrap">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <div className="absolute right-6 top-24 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/60">
              SYNTHESIS_ENGINE: V3.0_BETA
            </div>
            <div className="absolute left-6 bottom-6 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/60">
              RESOURCES: RESTRICTED
            </div>
            <div className="absolute right-6 bottom-6 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/60">
              {activePreviewLabel ? `PREVIEW: ${activePreviewLabel}` : "NEURAL_CORE: ACTIVE"}
            </div>
          </div>
        </section>

        <aside
          className={`relative flex h-fit flex-col gap-5 rounded-[32px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl lg:sticky lg:top-24 ${
            isDesktopPanelHidden ? "lg:hidden" : "lg:flex"
          }`}
        >
          <div className="space-y-2">
            <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-white/50">
              AI 3D GENERATION SUITE
            </p>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-2xl font-semibold text-white">Лаборатория синтеза</h2>
              <div className="flex flex-col items-end gap-2">
                <div className="rounded-full border border-[#2ED1FF]/30 bg-[#0b1014] px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-[#BFF4FF] shadow-[0_0_16px_rgba(46,209,255,0.25)]">
                  TOKENS: {tokensLoading ? "..." : tokens}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTopupTab("onetime");
                    setTopupOpen(true);
                  }}
                  className="rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-emerald-200 transition hover:border-emerald-300 hover:text-white"
                >
                  TOP UP
                </button>
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-amber-200">
              В разработке
            </div>
            <p className="text-sm text-white/55">
              Высокоточный протокол сборки цифровых материалов. Используйте тестовый
              `.glb` через параметр `preview`.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/30 p-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em]">
            {([
              ["compose", "Compose"],
              ["history", "History"],
              ["assets", "Assets"],
              ["billing", "Tokens"],
            ] as Array<[LabPanelTab, string]>).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setLabPanelTab(tab)}
                className={`min-h-[38px] rounded-xl border px-3 py-2 transition ${
                  labPanelTab === tab
                    ? "border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_14px_rgba(46,209,255,0.3)]"
                    : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/30 hover:text-white/85"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-[#2ED1FF]/20 bg-[#091018]/85 p-3 shadow-[0_0_22px_rgba(46,209,255,0.12)]">
            <div className="flex flex-wrap items-center gap-2">
              <div className="grid min-w-[220px] grid-cols-2 gap-2 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em]">
                <button
                  type="button"
                  onClick={() => setMode("image")}
                  className={`rounded-lg border px-2.5 py-1.5 transition ${
                    mode === "image"
                      ? "border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF]"
                      : "border-white/15 bg-white/[0.02] text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                >
                  Image to 3D
                </button>
                <button
                  type="button"
                  onClick={() => setMode("text")}
                  className={`rounded-lg border px-2.5 py-1.5 transition ${
                    mode === "text"
                      ? "border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF]"
                      : "border-white/15 bg-white/[0.02] text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                >
                  Text to 3D
                </button>
              </div>
              <div className="rounded-full border border-[#2ED1FF]/35 bg-[#0b1014] px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-[#BFF4FF]">
                TOKENS: {tokensLoading ? "..." : tokens}
              </div>
              <div className="rounded-full border border-white/15 bg-white/[0.03] px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/65">
                COST: {tokenCost}
              </div>
              <button
                type="button"
                onClick={() => {
                  setTopupTab("onetime");
                  setTopupOpen(true);
                }}
                className="rounded-full border border-emerald-400/45 bg-emerald-500/10 px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-emerald-100 transition hover:border-emerald-300 hover:text-white"
              >
                TOP UP
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleStartServerSynthesis();
                }}
                disabled={serverJobLoading || isSynthRunning || tokensLoading}
                className="ml-auto rounded-full border border-emerald-400/60 bg-emerald-500/12 px-4 py-1.5 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-emerald-100 transition hover:border-emerald-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {serverJobLoading
                  ? "CREATING..."
                  : isSynthRunning
                    ? "IN PROGRESS"
                    : tokensLoading
                      ? "LOADING..."
                      : "START"}
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-white/50">
              <span>{currentStatus}</span>
              <span>
                {displayStage} • {Math.round(displayProgress)}%
                {(serverJob?.status === "queued" || serverJob?.status === "processing") ? ` • ETA ${displayEta}` : ""}
              </span>
            </div>
          </div>

          {labPanelTab === "compose" && (
            <>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
              <span>Subscription</span>
              <span>{subscriptionLoading ? "..." : subscriptionStatusLabel(subscription?.status)}</span>
            </div>
            <p className="mt-2 text-sm text-white/75">
              {subscription?.planCode
                ? `${subscription.planLabel} • ${subscription.monthlyTokens} токенов/мес`
                : "Подписка не активна"}
            </p>
            {subscription?.nextBillingAt && (
              <p className="mt-1 text-[11px] text-white/45">
                Следующее списание: {formatJobDate(subscription.nextBillingAt)}
                {subscription.cancelAtPeriodEnd ? " • отмена в конце периода" : ""}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setTopupTab("subscription");
                  setTopupOpen(true);
                }}
                className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-cyan-100 transition hover:border-cyan-300 hover:text-white"
              >
                Сменить план
              </button>
              <button
                type="button"
                onClick={() => void handleOpenSubscriptionPortal()}
                disabled={subscriptionAction === "portal" || !subscription?.stripeCustomerId}
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/75 transition hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                {subscriptionAction === "portal" ? "..." : "Управлять"}
              </button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.18fr_0.82fr]">
            <div className="space-y-4">
          <div
            className={`relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-4 text-center transition ${
              dragActive
                ? "border-[#2ED1FF]/70 bg-[#0b1014]/70 shadow-[0_0_24px_rgba(46,209,255,0.35)]"
                : "border-white/20 bg-[radial-gradient(circle_at_center,rgba(46,209,255,0.06),transparent_60%)] shadow-[inset_0_0_40px_rgba(46,209,255,0.08)] hover:border-white/40"
            }`}
            onClick={handleBrowse}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleBrowse();
              }
            }}
          >
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*,.glb,.gltf"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            {uploadPreview ? (
              <div className="relative h-full w-full overflow-hidden rounded-xl border border-white/10">
                <img src={uploadPreview} alt="Preview" className="h-full w-full object-cover" />
                <div className="scanline absolute inset-x-0 top-0 h-1 bg-emerald-400/70 shadow-[0_0_12px_rgba(16,185,129,0.7)]" />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
                <div className="absolute bottom-3 left-3 flex items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_10px_rgba(16,185,129,0.7)]" />
                  {`REFS: ${validInputReferences.length} / ${MAX_INPUT_REFERENCES}`}
                </div>
                <div className="absolute bottom-3 right-3 rounded-full border border-white/20 bg-black/50 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/75">
                  Add more
                </div>
              </div>
            ) : uploadedModelName ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-6 text-center">
                <div className="rounded-full border border-[#2ED1FF]/40 bg-[#0b1014] px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-[#BFF4FF]">
                  MODEL LOADED
                </div>
                <p className="text-sm font-semibold text-white">{uploadedModelName}</p>
                <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/40">
                  ready for synthesis
                </p>
              </div>
            ) : (
              <>
                <UploadCloud className="h-8 w-8 text-[#2ED1FF]" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-white">Перетащите изображение</p>
                  <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/50">
                    DROP 2-4 IMAGES OR CLICK TO UPLOAD
                  </p>
                </div>
              </>
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/55">
              <span>References</span>
              <div className="flex items-center gap-2">
                <span>
                  {validInputReferences.length} / {MAX_INPUT_REFERENCES}
                </span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    clearInputReferences();
                  }}
                  disabled={validInputReferences.length === 0}
                  className="rounded-full border border-white/15 px-2 py-0.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/65 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>
            {validInputReferences.length === 0 ? (
              <p className="mt-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/35">
                Нет загруженных референсов
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-2">
                {validInputReferences.map((ref) => (
                  <div
                    key={ref.id}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-2"
                    title={ref.name}
                  >
                    <div className="h-9 w-9 overflow-hidden rounded-md border border-white/10 bg-black/40">
                      {ref.previewUrl ? (
                        <img src={ref.previewUrl} alt={ref.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[8px] uppercase text-white/35">
                          REF
                        </div>
                      )}
                    </div>
                    <p className="min-w-0 flex-1 truncate text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/65">
                      {ref.name}
                    </p>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleOpenMaskEditor(ref.id);
                      }}
                      disabled={
                        maskEditorLoading ||
                        maskApplying ||
                        removingReferenceBgId === ref.id ||
                        smartMaskingReferenceId === ref.id
                      }
                      className="rounded-full border border-white/25 px-2 py-0.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.14em] text-white/80 transition hover:border-white/45 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Ручная маска кистью"
                    >
                      EDIT
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleRemoveReferenceBackground(ref.id);
                      }}
                      disabled={
                        removingReferenceBgId === ref.id || smartMaskingReferenceId === ref.id
                      }
                      className="rounded-full border border-cyan-400/40 px-2 py-0.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-cyan-100 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Удалить фон у референса"
                    >
                      {removingReferenceBgId === ref.id ? "..." : "RM BG"}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleSmartMaskReference(ref.id);
                      }}
                      disabled={
                        smartMaskingReferenceId === ref.id || removingReferenceBgId === ref.id
                      }
                      className="rounded-full border border-amber-300/40 px-2 py-0.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.14em] text-amber-100 transition hover:border-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Умная доочистка маски и ореолов"
                    >
                      {smartMaskingReferenceId === ref.id ? "..." : "MASK+"}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDownloadReference(ref);
                      }}
                      className="rounded-full border border-emerald-300/40 px-2 py-0.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.14em] text-emerald-100 transition hover:border-emerald-200"
                      title="Скачать текущий референс как PNG"
                    >
                      SAVE
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRemoveInputReference(ref.id);
                      }}
                      className="rounded-full border border-rose-400/40 px-2 py-0.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-rose-200 transition hover:border-rose-300"
                    >
                      X
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
              <span>AI PROMPT</span>
              <span className="text-white/30">LEN: {prompt.length}</span>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Опишите желаемый результат: форма, стиль, назначение."
              className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80 placeholder:text-white/40 focus:border-[#2ED1FF]/60 focus:outline-none"
            />
          </div>

          </div>
          <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
            <div className="flex items-center justify-between">
              <span>TERMINAL STREAM</span>
              <span className="flex items-center gap-2 text-white/40">
                <ShieldCheck className="h-3.5 w-3.5 text-[#2ED1FF]" />
                {currentStatus}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-white/70">
              <span>{displayStage}</span>
              <span>{Math.round(displayProgress)}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-[#2ED1FF] via-[#7FE7FF] to-white transition-all"
                style={{ width: `${displayProgress}%` }}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.26em] text-emerald-100/80">
            <div className="flex items-center justify-between gap-3">
              <span>SERVER JOB</span>
              <span>{serverJob?.status || "idle"}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 via-emerald-300 to-white transition-all"
                style={{ width: `${displayProgress}%` }}
              />
            </div>
            {serverJob?.id && (
              <p className="mt-2 break-all text-[9px] tracking-[0.2em] text-emerald-100/70">
                ID: {serverJob.id}
              </p>
            )}
            {serverJob?.provider && (
              <p className="mt-1 text-[9px] tracking-[0.2em] text-emerald-100/70">
                Provider: {serverJob.provider}
              </p>
            )}
            {serverJob?.stage && (
              <p className="mt-1 text-[9px] tracking-[0.2em] text-emerald-100/70">
                Stage: {serverJob.stage}
              </p>
            )}
            {serverJob && serverJob.status === "queued" && (
              <p className="mt-1 text-[9px] tracking-[0.2em] text-emerald-100/70">
                Queue: {displayQueuePosition} / {displayQueueDepth}
              </p>
            )}
            {serverJob && (serverJob.status === "queued" || serverJob.status === "processing") && (
              <p className="mt-1 text-[9px] tracking-[0.2em] text-emerald-100/70">ETA: {displayEta}</p>
            )}
            {serverJobError && (
              <p className="mt-2 text-[9px] tracking-[0.18em] text-rose-300">{serverJobError}</p>
            )}
          </div>
          </div>
          </div>
            </>
          )}
          {labPanelTab === "billing" && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
              <span>TOKEN LOG</span>
              <span className="text-white/30">{tokenEvents.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {tokenEventsLoading ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/40">
                  LOADING...
                </div>
              ) : tokenEvents.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/40">
                  NO TOKEN EVENTS
                </div>
              ) : (
                tokenEvents.slice(0, 6).map((event) => {
                  const delta = Number.isFinite(event.delta) ? Math.trunc(event.delta) : 0;
                  const deltaSign = delta >= 0 ? "+" : "";
                  const deltaTone =
                    delta > 0 ? "text-emerald-300" : delta < 0 ? "text-rose-300" : "text-white/60";
                  const eventDate = formatJobDate(event.createdAt);
                  return (
                    <div
                      key={event.id}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/80">
                          {tokenReasonLabel[event.reason] || event.reason}
                        </p>
                        <p
                          className={`text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] ${deltaTone}`}
                        >
                          {deltaSign}
                          {delta}
                        </p>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/45">
                        <span className="truncate">{eventDate || "--:--"}</span>
                        <span>Balance {Math.max(0, Math.trunc(event.balanceAfter || 0))}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          )}
          {labPanelTab === "history" && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
              <span>AI HISTORY</span>
              <span className="text-white/30">{filteredJobHistory.length}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["all", "completed", "failed", "queued", "processing"] as JobHistoryFilter[]).map(
                (filterValue) => {
                  const isActive = jobHistoryFilter === filterValue;
                  return (
                    <button
                      key={filterValue}
                      type="button"
                      onClick={() => setJobHistoryFilter(filterValue)}
                      className={`rounded-full border px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] transition ${
                        isActive
                          ? "border-[#2ED1FF]/60 text-[#BFF4FF] shadow-[0_0_12px_rgba(46,209,255,0.25)]"
                          : "border-white/10 text-white/45 hover:border-white/30 hover:text-white/75"
                      }`}
                    >
                      {filterValue}
                    </button>
                  );
                }
              )}
            </div>
            <div className="mt-3 space-y-2">
              {jobHistoryLoading ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/40">
                  LOADING...
                </div>
              ) : filteredJobHistory.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/40">
                  NO JOBS FOR FILTER
                </div>
              ) : (
                filteredJobHistory.map((job) => {
                  const linkedAssetId = publishedAssetsByJobId[job.id];
                  const linkedAsset = linkedAssetId ? publishedAssetsById[linkedAssetId] : null;
                  const fixAvailable = Boolean(
                    linkedAsset?.fixAvailable || linkedAsset?.checks?.topology?.fixAvailable
                  );
                  return (
                  <div
                    key={job.id}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold text-white/90">
                          {job.prompt || `Job ${job.id}`}
                        </p>
                        <p className="mt-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/45">
                          {formatJobDate(job.createdAt)} • {job.mode}
                          {Array.isArray(job.inputRefs) && job.inputRefs.length > 0
                            ? ` • refs:${Math.min(MAX_INPUT_REFERENCES, job.inputRefs.length)}`
                            : ""}
                          {job.parentJobId ? " • remix" : ""}
                        </p>
                      </div>
                      <p className={`text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] ${renderJobStatusTone(job.status)}`}>
                        {job.status}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <p className="truncate text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/45">
                        {job.stage || SERVER_STAGE_BY_STATUS[job.status]} • {Math.max(0, Math.min(100, job.progress || 0))}%
                        {(job.status === "queued" || job.status === "processing") &&
                          ` • ETA ${formatEta(job.etaSeconds ?? null)}`}
                        {job.status === "queued" &&
                          typeof job.queuePosition === "number" &&
                          job.queuePosition > 0 &&
                          ` • Q#${job.queuePosition}`}
                        {fixAvailable ? " • fix available" : ""}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handlePickHistoryJob(job)}
                          className="rounded-full border border-[#2ED1FF]/40 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-[#BFF4FF] transition hover:border-[#7FE7FF]"
                        >
                          USE
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRemixJob(job);
                            setRemixPrompt(job.prompt || "");
                            setRemixLocalEdit(false);
                            setRemixTargetZone("ноги");
                            setRemixIssueReference(null);
                          }}
                          disabled={historyAction?.id === job.id || job.status !== "completed"}
                          className="rounded-full border border-cyan-400/40 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-cyan-200 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Создать ремикс (альтернативный вариант)"
                        >
                          {historyAction?.id === job.id && historyAction?.type === "variation" ? "..." : "REMIX"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handlePublishJob(job)}
                          disabled={
                            historyAction?.id === job.id ||
                            job.status !== "completed" ||
                            Boolean(publishedAssetsByJobId[job.id])
                          }
                          className="rounded-full border border-amber-400/40 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-amber-200 transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {publishedAssetsByJobId[job.id]
                            ? "SAVED"
                            : historyAction?.id === job.id && historyAction?.type === "publish"
                              ? "..."
                              : "PUBLISH"}
                        </button>
                        <details className="group relative">
                          <summary className="list-none cursor-pointer rounded-full border border-white/20 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white [&::-webkit-details-marker]:hidden">
                            MORE
                          </summary>
                          <div className="absolute right-0 top-8 z-20 min-w-[172px] space-y-1 rounded-xl border border-white/10 bg-[#06090d]/95 p-2 shadow-[0_12px_24px_rgba(0,0,0,0.45)]">
                            <button
                              type="button"
                              onClick={() => void handleRetryHistoryJob(job)}
                              disabled={
                                historyAction?.id === job.id ||
                                (job.status !== "failed" && job.status !== "queued")
                              }
                              className="w-full rounded-lg border border-emerald-400/40 px-2 py-1 text-left text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-emerald-200 transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {historyAction?.id === job.id && historyAction?.type === "retry" ? "..." : "RETRY"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAnalyzePublishedAsset(job)}
                              disabled={!linkedAssetId || Boolean(assetAction)}
                              className="w-full rounded-lg border border-emerald-400/40 px-2 py-1 text-left text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-emerald-200 transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                              title={linkedAssetId ? "Проверить топологию ассета" : "Сначала сохраните ассет"}
                            >
                              {assetAction?.assetId === linkedAssetId && assetAction?.type === "analyze"
                                ? "..."
                                : "ANALYZE"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRepairPublishedAsset(job)}
                              disabled={!linkedAssetId || Boolean(assetAction)}
                              className="w-full rounded-lg border border-amber-400/40 px-2 py-1 text-left text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-amber-200 transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                              title={linkedAssetId ? "Создать исправленную версию" : "Сначала сохраните ассет"}
                            >
                              {assetAction?.assetId === linkedAssetId && assetAction?.type === "repair"
                                ? "..."
                                : "AUTO-FIX"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteHistoryJob(job)}
                              disabled={historyAction?.id === job.id}
                              className="w-full rounded-lg border border-rose-400/40 px-2 py-1 text-left text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-rose-200 transition hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {historyAction?.id === job.id && historyAction?.type === "delete" ? "..." : "DELETE"}
                            </button>
                          </div>
                        </details>
                      </div>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>
          )}
          {labPanelTab === "assets" && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
              <span>AI ВИТРИНА</span>
              <span className="text-white/30">{gallery.length} / {GALLERY_LIMIT}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {gallery.length === 0 ? (
                <div className="col-span-2 rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-center text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/40">
                  ПОКА НЕТ РЕЗУЛЬТАТОВ
                </div>
              ) : (
                gallery.map((asset) => (
                  <div
                    key={asset.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectAsset(asset)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelectAsset(asset);
                      }
                    }}
                    className="group flex flex-col items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-2 text-left transition hover:border-[#2ED1FF]/60"
                  >
                  <div className="relative h-20 w-full overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-[#0b1014] via-[#090c0f] to-black">
                    <span className="absolute left-2 top-2 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-amber-200">
                      DEMO
                    </span>
                    {asset.previewImage ? (
                        <img
                          src={asset.previewImage}
                          alt={asset.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/30">
                          MODEL
                        </div>
                      )}
                    </div>
                    <div className="flex w-full items-center justify-between gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/60">
                      <span className="truncate">{asset.name}</span>
                      <span className="text-white/30">{asset.format.toUpperCase()}</span>
                    </div>
                    <div className="flex w-full items-center gap-2">
                      <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/40">
                        {asset.localOnly ? "LOCAL" : "CLOUD"}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDownload(asset);
                        }}
                        className="rounded-full border border-[#2ED1FF]/40 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-[#BFF4FF] transition hover:border-[#7FE7FF]"
                      >
                        SAVE
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          )}
        </aside>
      </motion.main>

      {topupOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-[680px] rounded-[28px] border border-emerald-400/35 bg-[#05070a]/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
            <div className="flex items-center gap-3 text-[12px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.7)]" />
              [ TOKEN TOP UP ]
            </div>
            <p className="mt-4 text-sm text-white/75">One-time пакеты или ежемесячная подписка.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/30 p-2">
              <button
                type="button"
                onClick={() => setTopupTab("onetime")}
                className={`rounded-xl px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.25em] transition ${
                  topupTab === "onetime"
                    ? "border border-emerald-400/60 bg-emerald-500/10 text-emerald-100"
                    : "border border-white/10 text-white/55 hover:text-white"
                }`}
              >
                One-time
              </button>
              <button
                type="button"
                onClick={() => setTopupTab("subscription")}
                className={`rounded-xl px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.25em] transition ${
                  topupTab === "subscription"
                    ? "border border-cyan-400/60 bg-cyan-500/10 text-cyan-100"
                    : "border border-white/10 text-white/55 hover:text-white"
                }`}
              >
                Subscription
              </button>
            </div>

            {topupTab === "onetime" ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {TOPUP_PACKS.map((pack) => {
                  const isLoading = topupLoadingPack === pack.id;
                  const disabled = Boolean(topupLoadingPack) || Boolean(subscriptionAction);
                  return (
                    <button
                      key={pack.id}
                      type="button"
                      onClick={() => {
                        void handleTopup(pack.id);
                      }}
                      disabled={disabled}
                      className="rounded-2xl border border-emerald-400/40 bg-emerald-500/5 px-4 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <p className="text-[11px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.25em] text-emerald-100">
                        {pack.title}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-white">+{pack.credits}</p>
                      <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/45">
                        {isLoading ? "processing..." : pack.note}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {subscriptionMode !== "stripe" ? (
                  <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    Режим подписки отключен. Для включения установите AI_SUBSCRIPTIONS_MODE=stripe.
                  </div>
                ) : subscriptionLoading ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
                    Loading subscription plans...
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {subscriptionPlans.map((plan) => {
                        const selected = subscription?.planCode === plan.code;
                        const disabled = !plan.configured || Boolean(subscriptionAction);
                        return (
                          <button
                            key={plan.code}
                            type="button"
                            disabled={disabled}
                            onClick={() => void handleSubscriptionCheckout(plan.code)}
                            className={`rounded-2xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                              selected
                                ? "border-cyan-300/60 bg-cyan-500/15"
                                : "border-cyan-400/35 bg-cyan-500/5 hover:border-cyan-300/60"
                            }`}
                          >
                            <p className="text-[11px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.25em] text-cyan-100">
                              {plan.label}
                            </p>
                            <p className="mt-2 text-lg font-semibold text-white">
                              {plan.monthlyTokens} / мес
                            </p>
                            <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/50">
                              {formatMoneyFromCents(plan.monthlyAmountCents)} •{" "}
                              {plan.proAccess ? "pro+standard" : "standard"}
                            </p>
                            <p className="mt-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/45">
                              {subscriptionAction === "checkout" ? "processing..." : selected ? "current" : "switch"}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                      <p className="text-xs text-white/70">
                        {subscription?.planCode
                          ? `${subscription.planLabel} • ${subscriptionStatusLabel(subscription.status)}`
                          : "No active subscription"}
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleOpenSubscriptionPortal()}
                        disabled={subscriptionAction === "portal" || !subscription?.stripeCustomerId}
                        className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/75 transition hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {subscriptionAction === "portal" ? "..." : "Customer portal"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setTopupOpen(false)}
                disabled={Boolean(topupLoadingPack) || Boolean(subscriptionAction)}
                className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.35em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {maskEditorOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-[980px] rounded-[26px] border border-white/15 bg-[#05070a]/95 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.65)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-cyan-100">
                  [ MASK EDITOR ]
                </p>
                <p className="mt-1 text-sm text-white/75">
                  {maskEditorReference?.name || maskImageNameRef.current || "reference"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMaskMode("erase")}
                  className={`rounded-full border px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] transition ${
                    maskMode === "erase"
                      ? "border-rose-300/65 bg-rose-500/15 text-rose-100"
                      : "border-white/20 bg-white/5 text-white/70 hover:border-white/35"
                  }`}
                >
                  Стереть
                </button>
                <button
                  type="button"
                  onClick={() => setMaskMode("restore")}
                  className={`rounded-full border px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] transition ${
                    maskMode === "restore"
                      ? "border-emerald-300/65 bg-emerald-500/15 text-emerald-100"
                      : "border-white/20 bg-white/5 text-white/70 hover:border-white/35"
                  }`}
                >
                  Вернуть
                </button>
                <button
                  type="button"
                  onClick={() => setMaskMode("wand")}
                  className={`rounded-full border px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] transition ${
                    maskMode === "wand"
                      ? "border-cyan-300/70 bg-cyan-500/18 text-cyan-100"
                      : "border-white/20 bg-white/5 text-white/70 hover:border-white/35"
                  }`}
                  title="Интеллектуальная палочка: клик по похожим пикселям. Alt временно инвертирует действие."
                >
                  Wand
                </button>
                <button
                  type="button"
                  onClick={() => setMaskShowOverlay((value) => !value)}
                  className={`rounded-full border px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] transition ${
                    maskShowOverlay
                      ? "border-amber-300/60 bg-amber-500/15 text-amber-100"
                      : "border-white/20 bg-white/5 text-white/70 hover:border-white/35"
                  }`}
                >
                  Overlay
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/35 px-3 py-2">
              <label className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/55">
                {maskMode === "wand" ? "Tolerance" : "Brush"}
              </label>
              <input
                type="range"
                min={maskMode === "wand" ? 1 : 6}
                max={maskMode === "wand" ? 100 : 120}
                value={maskMode === "wand" ? maskWandTolerance : maskBrushSize}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  if (maskMode === "wand") {
                    setMaskWandTolerance(nextValue);
                  } else {
                    setMaskBrushSize(nextValue);
                  }
                }}
                className="w-44 accent-cyan-300"
              />
              <span className="min-w-[44px] text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/65">
                {maskMode === "wand" ? `${maskWandTolerance}%` : `${maskBrushSize}px`}
              </span>
              {maskMode === "wand" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setMaskWandAction("erase")}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] transition ${
                      maskWandAction === "erase"
                        ? "border-rose-300/60 bg-rose-500/15 text-rose-100"
                        : "border-white/20 bg-white/5 text-white/60 hover:border-white/35"
                    }`}
                  >
                    Erase
                  </button>
                  <button
                    type="button"
                    onClick={() => setMaskWandAction("restore")}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] transition ${
                      maskWandAction === "restore"
                        ? "border-emerald-300/60 bg-emerald-500/15 text-emerald-100"
                        : "border-white/20 bg-white/5 text-white/60 hover:border-white/35"
                    }`}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setMaskWandOuterOnly((value) => !value)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] transition ${
                      maskWandOuterOnly
                        ? "border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                        : "border-white/20 bg-white/5 text-white/60 hover:border-white/35"
                    }`}
                    title="Когда включено, палочка режет только внешний фон (не трогает внутренние зоны объекта)."
                  >
                    Outer BG
                  </button>
                  <label className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/45">
                    Feather
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={3}
                    step={1}
                    value={maskFeatherPx}
                    onChange={(event) => setMaskFeatherPx(Number(event.target.value))}
                    className="w-20 accent-cyan-300"
                    title="Мягкость края при применении маски."
                  />
                  <span className="min-w-[22px] text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/50">
                    {maskFeatherPx}px
                  </span>
                  <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/45">
                    click = {maskWandAction}
                    {` , alt+click = ${maskWandAction === "erase" ? "restore" : "erase"}`}
                  </span>
                </>
              ) : null}
              <button
                type="button"
                onClick={handleMaskUndo}
                disabled={maskUndoStackRef.current.length === 0}
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/75 transition hover:border-white/35 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={handleMaskRedo}
                disabled={maskRedoStackRef.current.length === 0}
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/75 transition hover:border-white/35 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Redo
              </button>
              <button
                type="button"
                onClick={handleMaskInvert}
                className="rounded-full border border-amber-300/45 bg-amber-500/10 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-amber-100 transition hover:border-amber-200"
              >
                Invert
              </button>
              <button
                type="button"
                onClick={handleMaskReset}
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/75 transition hover:border-white/35"
              >
                Reset
              </button>
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-black/45 p-2">
              <canvas
                ref={maskCanvasRef}
                onPointerDown={handleMaskCanvasPointerDown}
                onPointerMove={handleMaskCanvasPointerMove}
                onPointerUp={handleMaskCanvasPointerUp}
                onPointerLeave={handleMaskCanvasPointerUp}
                onContextMenu={(event) => event.preventDefault()}
                className="mx-auto max-h-[62vh] w-auto max-w-full touch-none rounded-xl border border-white/10 bg-black/60"
                style={{ cursor: maskCanvasCursor }}
              />
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeMaskEditor}
                disabled={maskApplying}
                className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.26em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                Закрыть
              </button>
              <button
                type="button"
                onClick={handleApplyMaskEditor}
                disabled={maskApplying}
                className="rounded-2xl border border-cyan-300/55 bg-cyan-500/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.26em] text-cyan-100 transition hover:border-cyan-200 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                {maskApplying ? "Applying..." : "Применить маску"}
              </button>
            </div>
          </div>
        </div>
      )}

      {remixJob && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-[620px] rounded-[28px] border border-cyan-400/35 bg-[#05070a]/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
            <div className="flex items-center gap-3 text-[12px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-cyan-100">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.7)]" />
              [ REMIX ]
            </div>
            <p className="mt-4 text-sm text-white/75">
              Уточните, что нужно изменить в новой версии. Пустое поле = ремикс без изменений.
            </p>
            <div className="mt-4 space-y-2">
              <label className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/55">
                Prompt
              </label>
              <textarea
                value={remixPrompt}
                onChange={(event) => setRemixPrompt(event.target.value)}
                maxLength={800}
                placeholder="Например: сделать позу динамичнее, убрать лишние детали, усилить контур."
                className="min-h-[120px] w-full resize-y rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
              />
              <div className="text-right text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/40">
                {remixPrompt.trim().length} / 800
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.04] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-cyan-100">
                    Локальная правка
                  </p>
                  <p className="mt-1 text-xs text-white/60">
                    Правим только выбранную зону, остальное стараемся не менять.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRemixLocalEdit((prev) => !prev)}
                  className={`rounded-full border px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] transition ${
                    remixLocalEdit
                      ? "border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                      : "border-white/15 bg-white/5 text-white/60 hover:border-white/35"
                  }`}
                >
                  {remixLocalEdit ? "ON" : "OFF"}
                </button>
              </div>

              {remixLocalEdit && (
                <div className="mt-3 space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/55">
                      Зона правки
                    </label>
                    <input
                      value={remixTargetZone}
                      onChange={(event) => setRemixTargetZone(event.target.value.slice(0, 120))}
                      placeholder="Например: ноги, кисти, лицо"
                      className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/60"
                    />
                  </div>

                  <input
                    ref={remixIssueInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleRemixIssueFileChange}
                    className="hidden"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => remixIssueInputRef.current?.click()}
                      disabled={remixIssueLoading}
                      className="rounded-full border border-cyan-300/50 bg-cyan-500/10 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {remixIssueLoading ? "Загрузка..." : "Добавить скрин проблемы"}
                    </button>
                    {remixIssueReference && (
                      <button
                        type="button"
                        onClick={() => setRemixIssueReference(null)}
                        className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/35 hover:text-white"
                      >
                        Убрать скрин
                      </button>
                    )}
                  </div>

                  {remixIssueReference?.previewUrl && (
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-2">
                      <img
                        src={remixIssueReference.previewUrl}
                        alt={remixIssueReference.name}
                        className="h-12 w-12 rounded-md border border-white/10 object-cover"
                      />
                      <p className="min-w-0 truncate text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/60">
                        {remixIssueReference.name}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeRemixDialog}
                disabled={historyAction?.id === remixJob.id && historyAction?.type === "variation"}
                className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!remixJob) return;
                  void (async () => {
                    const ok = await handleVariationHistoryJob(remixJob, remixPrompt, {
                      localEdit: remixLocalEdit,
                      targetZone: remixTargetZone,
                      issueReference: remixIssueReference,
                    });
                    if (ok) {
                      closeRemixDialog();
                    }
                  })();
                }}
                disabled={historyAction?.id === remixJob.id && historyAction?.type === "variation"}
                className="rounded-2xl border border-cyan-300/55 bg-cyan-500/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-100 transition hover:border-cyan-200 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {historyAction?.id === remixJob.id && historyAction?.type === "variation"
                  ? "Создаем..."
                  : "Запустить remix"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResult && resultAsset && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-[560px] rounded-[28px] border border-[#2ED1FF]/40 bg-[#05070a]/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
            <div className="flex items-center gap-3 text-[12px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-[#BFF4FF]">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.7)]" />
              [ GENERATION COMPLETE ]
            </div>
            <p className="mt-4 text-sm text-white/75">
              Модель готова к просмотру и сохранению. Файлы сохраняются в стандартных
              форматах (.glb/.gltf) или как превью.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  if (resultJob) {
                    void handlePublishJob(resultJob);
                  }
                }}
                disabled={!resultJob || isResultPublished || historyAction?.type === "publish"}
                className="flex-1 rounded-2xl border border-amber-400/55 bg-amber-400/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.18)] transition hover:border-amber-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isResultPublished
                  ? "Saved to profile"
                  : historyAction?.type === "publish"
                    ? "Saving..."
                    : "Save to profile"}
              </button>
              <button
                type="button"
                onClick={() => handleDownload(resultAsset)}
                className="flex-1 rounded-2xl border border-[#2ED1FF]/60 bg-[#0b1014] px-4 py-3 text-xs font-semibold uppercase tracking-[0.35em] text-[#BFF4FF] shadow-[0_0_18px_rgba(46,209,255,0.35)] transition hover:border-[#7FE7FF] hover:text-white"
              >
                Download
              </button>
              <button
                type="button"
                onClick={handlePrintResult}
                className="flex-1 rounded-2xl border border-emerald-400/50 bg-emerald-500/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.2)] transition hover:border-emerald-300 hover:text-white"
              >
                В печать
              </button>
              <button
                type="button"
                onClick={() => setShowResult(false)}
                className="flex-1 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.35em] text-white/70 transition hover:border-white/40 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} position="top-right" />
    </div>
  );
}

export default function AiLabPage() {
  return <AiLabContent />;
}

