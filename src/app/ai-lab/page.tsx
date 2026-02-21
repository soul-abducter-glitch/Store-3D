"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Grid, OrbitControls, Sparkles } from "@react-three/drei";
import { motion } from "framer-motion";
import {
  Box,
  ChevronDown,
  Coins,
  Cpu,
  ExternalLink,
  FlaskConical,
  LogOut,
  Rocket,
  Scissors,
  Settings2,
  UserCog,
  UploadCloud,
  UserRound,
  Wand2,
} from "lucide-react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  MOUSE,
  PointsMaterial,
  type Group,
  type LineBasicMaterial,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
} from "three";

import ModelView, {
  type ModelIssueMarker,
  type ModelMaterialOverride,
} from "@/components/ModelView";
import { ToastContainer, useToast } from "@/components/Toast";
import { resolveGenerationEtaMinutes, resolveGenerationTokenCost } from "@/lib/aiGenerationProfile";
import {
  BILLING_MODE,
  billingProvider,
  mockBillingEnabled,
  realBillingEnabled,
  type BillingUIState,
} from "@/lib/aiBilling";

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
  versionLabel?:
    | "original"
    | "fixed_safe"
    | "fixed_strong"
    | "split_set"
    | "blender_edit"
    | "textured_v1"
    | string;
  createdAt?: string;
  updatedAt?: string;
  title: string;
  modelUrl: string;
  previewUrl: string;
  sourceUrl?: string;
  format: string;
  status: string;
  splitPartSet?: {
    id?: string;
    mode?: "auto" | "plane" | string;
    parts?: Array<{
      partId?: string;
      name?: string;
      fileUrl?: string;
    }>;
  } | null;
  pipelineJobs?: Array<{
    id?: string;
    type?: string;
    status?: string;
    progress?: number;
    message?: string;
  }>;
  fixAvailable?: boolean;
  checks?: {
    topology?: {
      fixAvailable?: boolean;
      riskScore?: number;
      watertight?: "yes" | "no" | "unknown";
      issues?: Array<{ message?: string }>;
    };
    diagnostics?: {
      status?: "ok" | "warning" | "critical";
      issues?: Array<{ message?: string }>;
      riskScore?: number | null;
      manifold?: "yes" | "no" | "unknown";
      openEdgesCount?: number | null;
      componentsCount?: number | null;
      polycount?: number | null;
      scaleSanity?: "ok" | "warning" | "critical" | "unknown";
      analyzedAt?: string;
    };
    texture?: {
      mode?: "image" | "flat" | string;
      sourceImageUrl?: string | null;
      baseColorMapUrl?: string | null;
      mapApplied?: boolean;
      tintHex?: string;
      roughness?: number | null;
      metalness?: number | null;
      autoUv?: boolean;
      generatedAt?: string;
      notes?: string;
    };
  } | null;
};

type JobHistoryFilter = "all" | AiGenerationJob["status"];
type QueueFilter = "all" | "running" | "queued" | "done" | "error";
type LabPanelTab = "assets" | "history" | "queue";
type RightPanelMainBlock = "create" | "check" | "repair" | "appearance" | "export";

type QueueJobItem = {
  id: string;
  queueJobId: string;
  type: string;
  label: string;
  status: "queued" | "running" | "done" | "error" | "canceled";
  progress: number;
  etaSeconds?: number | null;
  message?: string;
  source: "generation" | "pipeline";
  historyJobId?: string;
  versionId?: string | null;
};

type AiTokenEvent = {
  id: string;
  reason: "spend" | "refund" | "topup" | "adjust";
  delta: number;
  balanceAfter: number;
  source: string;
  createdAt: string;
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
const LAB_PANEL_TAB_STORAGE_KEY = "aiLabPanelTab";
const AI_LAB_BG = "/backgrounds/pedestal.png";
const MODEL_STAGE_OFFSET = -0.95;
const MODEL_STAGE_TARGET_SIZE = 2.2;
const AI_GENERATE_API_URL = "/api/ai/generate";
const AI_ASSETS_API_URL = "/api/ai/assets";
const AI_BACKGROUND_REMOVE_API_URL = "/api/ai/background-remove";
const ASSET_ANALYZE_API = (assetId: string) =>
  `/api/assets/${encodeURIComponent(assetId)}/analyze`;
const ASSET_FIX_API = (assetId: string) =>
  `/api/assets/${encodeURIComponent(assetId)}/fix`;
const ASSET_SPLIT_API = (assetId: string) =>
  `/api/assets/${encodeURIComponent(assetId)}/split`;
const ASSET_TEXTURE_API = (assetId: string) =>
  `/api/assets/${encodeURIComponent(assetId)}/texture`;
const ASSET_EXPORT_API = (assetId: string, versionId: string, format: "glb" | "zip", parts = false) =>
  `/api/assets/${encodeURIComponent(assetId)}/export?versionId=${encodeURIComponent(versionId)}&format=${encodeURIComponent(
    format
  )}${parts ? "&parts=1" : ""}`;
const DCC_BLENDER_JOBS_API = "/api/dcc/blender/jobs";
const BLENDER_BRIDGE_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.NEXT_PUBLIC_BLENDER_BRIDGE_ENABLED || "").trim().toLowerCase()
);
const AI_TOKENS_API_URL = "/api/ai/tokens";
const AI_TOKENS_HISTORY_API_URL = "/api/ai/tokens/history";
const AI_SUBSCRIPTION_ME_API_URL = "/api/ai/subscriptions/me";
const MAX_INPUT_REFERENCES = 4;
const AI_BG_REMOVE_MODE = (process.env.NEXT_PUBLIC_AI_BG_REMOVE_MODE || "client")
  .trim()
  .toLowerCase();
const AI_BG_REMOVE_SERVER_ENABLED = AI_BG_REMOVE_MODE === "rembg";
const APPEARANCE_PRESET_TINT: Record<"clay" | "resin" | "plastic" | "hologram", string> = {
  clay: "#b9b0a1",
  resin: "#e6dccd",
  plastic: "#c4d4ff",
  hologram: "#78ecff",
};
const APPEARANCE_PRESET_SWATCH: Record<
  "clay" | "original" | "resin" | "plastic" | "hologram",
  string
> = {
  clay: "radial-gradient(circle at 34% 30%, #f5f5f5 0%, #c8c8c8 42%, #8d8d8d 100%)",
  original: "radial-gradient(circle at 34% 30%, #f0f9ff 0%, #7dd3fc 48%, #2563eb 100%)",
  resin: "radial-gradient(circle at 34% 30%, #fff7e8 0%, #f5d0a2 45%, #b45309 100%)",
  plastic: "radial-gradient(circle at 34% 30%, #f8fafc 0%, #cbd5e1 44%, #475569 100%)",
  hologram: "radial-gradient(circle at 34% 30%, #dcfce7 0%, #67e8f9 44%, #14b8a6 100%)",
};
const APPEARANCE_PRESET_PBR: Record<
  "clay" | "resin" | "plastic" | "hologram",
  { roughness: number; metalness: number }
> = {
  clay: { roughness: 0.92, metalness: 0.02 },
  resin: { roughness: 0.36, metalness: 0.04 },
  plastic: { roughness: 0.52, metalness: 0.08 },
  hologram: { roughness: 0.18, metalness: 0.64 },
};
const MOCK_TOPUP_MIN = 1;
const MOCK_TOPUP_MAX = 100000;
const MOCK_TOPUP_PACKS: Array<{ id: string; title: string; amount: number; note: string }> = [
  { id: "starter", title: "+50", amount: 50, note: "Быстрый тест" },
  { id: "pro", title: "+200", amount: 200, note: "Расширенный тест" },
  { id: "max", title: "+500", amount: 500, note: "Нагрузочный тест" },
];
const SERVER_STAGE_BY_STATUS: Record<AiGenerationJob["status"], string> = {
  queued: "SERVER_QUEUE",
  processing: "GENETIC_MAPPING",
  completed: "SYNTHESIS_DONE",
  failed: "SYNTHESIS_FAILED",
};
const JOB_STATUS_LABEL_RU: Record<AiGenerationJob["status"], string> = {
  queued: "В ОЧЕРЕДИ",
  processing: "В РАБОТЕ",
  completed: "ГОТОВО",
  failed: "ОШИБКА",
};
const QUALITY_PRESET_LABEL: Record<"draft" | "standard" | "pro", string> = {
  draft: "Черновик",
  standard: "Стандарт",
  pro: "Про",
};
const IMAGE_SOURCE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i;

const normalizeTextureSourceUrl = (value: unknown) => {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  if (raw.startsWith("data:image/")) return raw.length <= 260_000 ? raw : "";
  if (!(raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/"))) {
    return "";
  }
  const withoutHash = raw.split("#")[0] || raw;
  const withoutQuery = withoutHash.split("?")[0] || withoutHash;
  if (IMAGE_SOURCE_EXT_RE.test(withoutQuery)) return raw;
  if (/\/api\/media\/file\//i.test(withoutQuery)) return raw;
  return "";
};
const normalizeHexColorClient = (value: unknown, fallback = "#aab0ba") => {
  if (typeof value !== "string") return fallback;
  const raw = value.trim();
  if (!raw) return fallback;
  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) return fallback;
  return normalized.toLowerCase();
};
const STYLE_PRESET_LABEL: Record<"realistic" | "stylized" | "anime", string> = {
  realistic: "Реалистичный",
  stylized: "Стилизованный",
  anime: "Аниме",
};
const ADVANCED_PRESET_LABEL: Record<"balanced" | "detail" | "speed", string> = {
  balanced: "Баланс",
  detail: "Детализация",
  speed: "Скорость",
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

function BlenderBadgeIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M4 12a8 8 0 0 1 8-8h5l2 2-2 2h-5a4 4 0 1 0 4 4h4a8 8 0 1 1-16 0z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  );
}

const parseMockTopupAmount = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const validateMockTopupAmount = (value: unknown) => {
  const amount = parseMockTopupAmount(value);
  if (amount === null) {
    return { ok: false as const, error: "Введите целое число токенов." };
  }
  if (amount < MOCK_TOPUP_MIN) {
    return { ok: false as const, error: `Минимум ${MOCK_TOPUP_MIN} токен.` };
  }
  if (amount > MOCK_TOPUP_MAX) {
    return { ok: false as const, error: `Максимум ${MOCK_TOPUP_MAX} токенов.` };
  }
  return { ok: true as const, amount };
};

const realBillingReasonLabel = (reason?: string) => {
  if (reason === "api_not_connected") return "Недоступно до подключения API.";
  return "Пока недоступно.";
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

const smoothAlphaMask = (alpha: Uint8Array, width: number, height: number, amount: number) => {
  const normalized = clampNumber(amount, 0, 100);
  if (normalized <= 0 || width <= 0 || height <= 0 || alpha.length !== width * height) {
    return alpha.slice();
  }
  const radius = Math.max(1, Math.min(3, Math.round(normalized / 35)));
  const blur = featherAlphaMask(alpha, width, height, radius);
  const mix = clampNumber(normalized / 100, 0, 1) * 0.85;
  const output = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    output[i] = Math.round(clampNumber(alpha[i] * (1 - mix) + blur[i] * mix, 0, 255));
  }
  return output;
};

const shiftAlphaMask = (alpha: Uint8Array, width: number, height: number, shift: number) => {
  const stepCount = Math.max(0, Math.min(10, Math.abs(Math.trunc(shift))));
  if (stepCount === 0 || width <= 0 || height <= 0 || alpha.length !== width * height) {
    return alpha.slice();
  }
  let current = alpha.slice();
  const expand = shift > 0;
  for (let step = 0; step < stepCount; step += 1) {
    const next = current.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = y * width + x;
        let value = current[idx];
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const neighbor = current[(y + dy) * width + (x + dx)];
            value = expand ? Math.max(value, neighbor) : Math.min(value, neighbor);
          }
        }
        next[idx] = value;
      }
    }
    current = next;
  }
  return current;
};

const buildRefinedMaskAlpha = (
  alpha: Uint8Array,
  width: number,
  height: number,
  options: { featherPx: number; smooth: number; shiftEdge: number; sourceAlpha?: Uint8Array | null }
) => {
  if (width <= 0 || height <= 0 || alpha.length !== width * height) return alpha.slice();
  let next = alpha.slice();
  if (options.smooth > 0) {
    next = smoothAlphaMask(next, width, height, options.smooth);
  }
  if (options.shiftEdge !== 0) {
    next = shiftAlphaMask(next, width, height, options.shiftEdge);
  }
  if (options.featherPx > 0) {
    next = featherAlphaMask(next, width, height, options.featherPx);
  }
  if (options.sourceAlpha && options.sourceAlpha.length === next.length) {
    for (let i = 0; i < next.length; i += 1) {
      next[i] = Math.min(next[i], options.sourceAlpha[i]);
    }
  }
  return next;
};

const computeLumaAt = (pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  const idx = (y * width + x) * 4;
  return 0.2126 * pixels[idx] + 0.7152 * pixels[idx + 1] + 0.0722 * pixels[idx + 2];
};

const findSnappedEdgePoint = (
  x: number,
  y: number,
  brushRadius: number,
  snapStrength: number,
  pixels: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const searchRadius = Math.max(2, Math.min(24, Math.round(2 + brushRadius * 0.45)));
  const minX = clampNumber(Math.floor(x - searchRadius), 1, width - 2);
  const maxX = clampNumber(Math.ceil(x + searchRadius), 1, width - 2);
  const minY = clampNumber(Math.floor(y - searchRadius), 1, height - 2);
  const maxY = clampNumber(Math.ceil(y + searchRadius), 1, height - 2);
  let bestX = x;
  let bestY = y;
  let bestScore = -Infinity;
  let bestGradient = 0;
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx0 = px - x;
      const dy0 = py - y;
      const distance = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      if (distance > searchRadius) continue;
      const gx =
        computeLumaAt(pixels, width, height, px + 1, py) - computeLumaAt(pixels, width, height, px - 1, py);
      const gy =
        computeLumaAt(pixels, width, height, px, py + 1) - computeLumaAt(pixels, width, height, px, py - 1);
      const gradient = Math.sqrt(gx * gx + gy * gy);
      const score = gradient - distance * 4.2;
      if (score > bestScore) {
        bestScore = score;
        bestGradient = gradient;
        bestX = px;
        bestY = py;
      }
    }
  }
  if (bestGradient < 22) {
    return { x, y, confidence: 0 };
  }
  const assist = clampNumber(snapStrength / 100, 0, 1) * 0.72;
  return {
    x: x + (bestX - x) * assist,
    y: y + (bestY - y) * assist,
    confidence: clampNumber(bestGradient / 120, 0, 1),
  };
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

function NeuralCore({ active, progress = 0 }: { active: boolean; progress?: number }) {
  const groupRef = useRef<Group | null>(null);
  const geometryRef = useRef<BufferGeometry | null>(null);
  const frameGeometryRef = useRef<BufferGeometry | null>(null);
  const materialRef = useRef<PointsMaterial | null>(null);
  const frameMaterialRef = useRef<LineBasicMaterial | null>(null);
  const scanRingRef = useRef<Mesh | null>(null);
  const scanRingMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const pointsCount = 4200;
  const [finalPositions, shapeA, shapeB, streamPositions, phases, colors] = useMemo(() => {
    const finalShape = new Float32Array(pointsCount * 3);
    const phaseA = new Float32Array(pointsCount * 3);
    const phaseB = new Float32Array(pointsCount * 3);
    const stream = new Float32Array(pointsCount * 3);
    const phase = new Float32Array(pointsCount);
    const colorArray = new Float32Array(pointsCount * 3);
    const cold = new Color("#9EDBFF");
    const white = new Color("#FFFFFF");
    const warm = new Color("#BFFCFF");
    const tmp = new Color();

    const sampleFigurePoint = () => {
      const area = Math.random();
      if (area < 0.2) {
        const theta = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * 0.33;
        const x = Math.cos(theta) * radius;
        const z = Math.sin(theta) * radius * 0.82;
        const y = 1.18 + (Math.random() - 0.5) * 0.34;
        return [x, y, z] as const;
      }
      if (area < 0.68) {
        const x = (Math.random() - 0.5) * 0.95;
        const z = (Math.random() - 0.5) * 0.5;
        const y = 0.32 + Math.random() * 0.88;
        return [x, y, z] as const;
      }
      const left = Math.random() > 0.5 ? -1 : 1;
      const x = left * (0.15 + Math.random() * 0.24) + (Math.random() - 0.5) * 0.09;
      const z = (Math.random() - 0.5) * 0.42;
      const y = -0.64 + Math.random() * 1.02;
      return [x, y, z] as const;
    };
    const sampleBrandGlyphPoint = () => {
      const branch = Math.random();
      if (branch < 0.34) {
        const t = Math.random();
        const x = -0.95 + t * 0.78;
        const y = 0.86 - t * 1.55;
        const z = (Math.random() - 0.5) * 0.2;
        return [x, y, z] as const;
      }
      if (branch < 0.68) {
        const t = Math.random();
        const x = 0.95 - t * 0.78;
        const y = 0.86 - t * 1.55;
        const z = (Math.random() - 0.5) * 0.2;
        return [x, y, z] as const;
      }
      const t = Math.random();
      const x = -0.15 + t * 0.3;
      const y = -0.58 + t * 1.05;
      const z = (Math.random() - 0.5) * 0.22;
      return [x, y, z] as const;
    };
    const sampleHelixPoint = () => {
      const t = Math.random();
      const turns = 2.8;
      const angle = t * Math.PI * 2 * turns;
      const radius = 0.2 + (1 - t) * 0.23;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = -0.92 + t * 2.02;
      return [x, y, z] as const;
    };

    for (let i = 0; i < pointsCount; i += 1) {
      const [x, y, z] = sampleFigurePoint();
      const [ax, ay, az] = sampleBrandGlyphPoint();
      const [bx, by, bz] = sampleHelixPoint();
      const base = i * 3;
      finalShape[base] = x;
      finalShape[base + 1] = y;
      finalShape[base + 2] = z;
      phaseA[base] = ax;
      phaseA[base + 1] = ay;
      phaseA[base + 2] = az;
      phaseB[base] = bx;
      phaseB[base + 1] = by;
      phaseB[base + 2] = bz;

      const lane = Math.random() > 0.5 ? 1 : -1;
      stream[base] = lane * (0.95 + Math.random() * 0.95);
      stream[base + 1] = -1.15 + Math.random() * 2.45;
      stream[base + 2] = (Math.random() - 0.5) * 0.95;

      phase[i] = Math.random() * Math.PI * 2;

      const yNorm = clampNumber((y + 1.2) / 2.5, 0, 1);
      tmp.copy(cold).lerp(white, yNorm * 0.65).lerp(warm, Math.random() * 0.25);
      colorArray[base] = tmp.r;
      colorArray[base + 1] = tmp.g;
      colorArray[base + 2] = tmp.b;
    }
    return [finalShape, phaseA, phaseB, stream, phase, colorArray] as const;
  }, []);
  const framePositions = useMemo(() => {
    const lines: number[] = [];
    const add = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      lines.push(x1, y1, z1, x2, y2, z2);
    };
    const radius = 1.12;
    const topY = 1.28;
    const bottomY = -0.95;
    const points = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 6 + Math.PI / 6;
      return [Math.cos(a) * radius, Math.sin(a) * radius] as const;
    });
    for (let i = 0; i < points.length; i += 1) {
      const [x1, z1] = points[i];
      const [x2, z2] = points[(i + 1) % points.length];
      add(x1, bottomY, z1, x2, bottomY, z2);
      add(x1 * 0.8, topY, z1 * 0.8, x2 * 0.8, topY, z2 * 0.8);
      add(x1, bottomY, z1, x1 * 0.8, topY, z1 * 0.8);
    }
    add(-0.9, 0.2, 0, 0.9, 0.2, 0);
    add(0, -0.7, -0.65, 0, 1.05, 0.65);
    add(-0.55, -0.6, 0.5, 0.55, 0.95, -0.5);
    return new Float32Array(lines);
  }, []);
  const livePositions = useMemo(() => new Float32Array(streamPositions), [streamPositions]);

  useEffect(() => {
    if (!geometryRef.current) return;
    geometryRef.current.setAttribute("position", new BufferAttribute(livePositions, 3));
    geometryRef.current.setAttribute("color", new BufferAttribute(colors, 3));
    geometryRef.current.computeBoundingSphere();
  }, [colors, livePositions]);

  useEffect(() => {
    if (!frameGeometryRef.current) return;
    frameGeometryRef.current.setAttribute("position", new BufferAttribute(framePositions, 3));
    frameGeometryRef.current.computeBoundingSphere();
  }, [framePositions]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const progress01 = active ? clampNumber(progress / 100, 0, 1) : 0;
    const revealBase = 0.1 + progress01 * 1.2;
    const phaseAB = clampNumber((progress01 - 0.02) / 0.34, 0, 1);
    const phaseBC = clampNumber((progress01 - 0.36) / 0.42, 0, 1);

    for (let i = 0; i < pointsCount; i += 1) {
      const base = i * 3;
      const midX = shapeA[base] * (1 - phaseAB) + shapeB[base] * phaseAB;
      const midY = shapeA[base + 1] * (1 - phaseAB) + shapeB[base + 1] * phaseAB;
      const midZ = shapeA[base + 2] * (1 - phaseAB) + shapeB[base + 2] * phaseAB;
      const targetX = midX * (1 - phaseBC) + finalPositions[base] * phaseBC;
      const targetY = midY * (1 - phaseBC) + finalPositions[base + 1] * phaseBC;
      const targetZ = midZ * (1 - phaseBC) + finalPositions[base + 2] * phaseBC;

      const jitterOrder = ((Math.sin(phases[i] * 1.3) + 1) / 2) * 0.1;
      const yOrder = clampNumber((targetY + 1.2) / 2.5, 0, 1);
      const reveal = clampNumber((revealBase - yOrder - jitterOrder) / 0.36, 0, 1);
      const mix = active ? reveal : 0;
      const flutter = (1 - mix) * 0.14 + 0.012;

      const waveX = Math.sin(t * 3.2 + phases[i] * 1.1) * flutter;
      const waveY = Math.cos(t * 3.6 + phases[i] * 0.8) * flutter;
      const waveZ = Math.sin(t * 2.7 + phases[i] * 1.4) * flutter;

      livePositions[base] = streamPositions[base] * (1 - mix) + targetX * mix + waveX;
      livePositions[base + 1] =
        streamPositions[base + 1] * (1 - mix) + targetY * mix + waveY;
      livePositions[base + 2] =
        streamPositions[base + 2] * (1 - mix) + targetZ * mix + waveZ;
    }

    const attr = geometryRef.current?.getAttribute("position");
    if (attr) attr.needsUpdate = true;
    if (materialRef.current) {
      materialRef.current.opacity = active ? 0.85 : 0.58;
      materialRef.current.size = active ? 0.025 : 0.018;
    }
    if (frameMaterialRef.current) {
      frameMaterialRef.current.opacity = active ? 0.18 + progress01 * 0.42 : 0.12;
    }
    if (scanRingRef.current) {
      const travel = active ? ((t * 0.45) % 1) : 0;
      scanRingRef.current.position.y = -0.9 + travel * 2.15;
      scanRingRef.current.scale.setScalar(1 + Math.sin(t * 4.6) * 0.02);
    }
    if (scanRingMaterialRef.current) {
      scanRingMaterialRef.current.opacity = active ? 0.18 + Math.sin(t * 4) * 0.05 : 0.08;
    }
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(t * 0.35) * 0.09;
    }
  });

  return (
    <group ref={groupRef} position={[0, -0.15, 0]}>
      <lineSegments>
        <bufferGeometry ref={frameGeometryRef} />
        <lineBasicMaterial
          ref={frameMaterialRef}
          color="#8CCBFF"
          transparent
          opacity={0.3}
          blending={AdditiveBlending}
        />
      </lineSegments>
      <mesh ref={scanRingRef} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.9, 0]}>
        <ringGeometry args={[0.22, 0.92, 72]} />
        <meshBasicMaterial
          ref={scanRingMaterialRef}
          color="#BFE9FF"
          transparent
          opacity={0.2}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <points frustumCulled={false}>
        <bufferGeometry ref={geometryRef} />
        <pointsMaterial
          ref={materialRef}
          vertexColors
          size={0.024}
          transparent
          opacity={0.88}
          depthWrite={false}
          blending={AdditiveBlending}
          sizeAttenuation
        />
      </points>
      <Sparkles count={80} scale={2.8} size={1.15} color="#D6ECFF" speed={0.22} opacity={0.22} />
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

function ViewportIssueMarkers({
  markers,
  thinOnly = false,
}: {
  markers: ModelIssueMarker[];
  thinOnly?: boolean;
}) {
  const visibleMarkers = useMemo(
    () =>
      (Array.isArray(markers) ? markers : []).filter((marker) =>
        thinOnly ? marker.id.startsWith("thin") : true
      ),
    [markers, thinOnly]
  );

  if (visibleMarkers.length === 0) return null;

  return (
    <group>
      {visibleMarkers.map((marker) => (
        <group key={marker.id} position={marker.position}>
          <mesh>
            <sphereGeometry args={[0.045, 16, 16]} />
            <meshBasicMaterial color={marker.color} transparent opacity={0.95} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
            <ringGeometry args={[0.07, 0.12, 24]} />
            <meshBasicMaterial
              color={marker.color}
              transparent
              opacity={0.72}
              blending={AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function AiLabContent() {
  type ManualMaskMode = "erase" | "restore" | "wand";
  type MaskPreviewMode = "overlay" | "alpha" | "black" | "white" | "checker";

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
  const [mockCustomAmountInput, setMockCustomAmountInput] = useState("");
  const [subscription, setSubscription] = useState<AiSubscriptionState | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [billingUIState, setBillingUIState] = useState<BillingUIState>({
    tokenBalance: 0,
    billingMode: BILLING_MODE,
    mockTopup: {
      status: "idle",
    },
    realBilling: {
      enabled: realBillingEnabled,
      status: realBillingEnabled ? "idle" : "disabled",
      reason: realBillingEnabled ? undefined : "api_not_connected",
    },
  });
  const [focusMode, setFocusMode] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [tokensPopoverOpen, setTokensPopoverOpen] = useState(false);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [rightPanelQueryInput, setRightPanelQueryInput] = useState("");
  const [rightPanelQuery, setRightPanelQuery] = useState("");
  const currentProjectName = "Личный проект";
  const [uiThemeMode, setUiThemeMode] = useState<"dark" | "auto">("dark");
  const [prefersDarkScheme, setPrefersDarkScheme] = useState(true);
  const [viewerQuality, setViewerQuality] = useState<"performance" | "quality">("quality");
  const [uiLanguage] = useState<"ru" | "en">("ru");
  const [qualityPreset, setQualityPreset] = useState<"draft" | "standard" | "pro">("standard");
  const [stylePreset, setStylePreset] = useState<"realistic" | "stylized" | "anime">("stylized");
  const [advancedPreset, setAdvancedPreset] = useState<"balanced" | "detail" | "speed">("balanced");
  const [viewportShowGrid, setViewportShowGrid] = useState(true);
  const [viewportRenderMode, setViewportRenderMode] = useState<"final" | "wireframe" | "base">("final");
  const [viewportControlMode, setViewportControlMode] = useState<"orbit" | "pan" | "zoom">("orbit");
  const [viewportAutoRotate, setViewportAutoRotate] = useState(false);
  const [viewportViewsOpen, setViewportViewsOpen] = useState(false);
  const [viewportSettingsOpen, setViewportSettingsOpen] = useState(false);
  const [viewportEnvironmentPreset, setViewportEnvironmentPreset] = useState<"city" | "studio" | "night">(
    "city"
  );
  const [viewportBackgroundMode, setViewportBackgroundMode] = useState<"scene" | "transparent">("scene");
  const [viewportViewPreset, setViewportViewPreset] = useState<
    "orbit" | "front" | "back" | "left" | "right" | "top" | "bottom"
  >("orbit");
  const [viewerIssuesOverlay, setViewerIssuesOverlay] = useState(false);
  const [viewerMeasureOverlay, setViewerMeasureOverlay] = useState(false);
  const [viewerThicknessPreview, setViewerThicknessPreview] = useState(false);
  const [viewportIssueMarkers, setViewportIssueMarkers] = useState<ModelIssueMarker[]>([]);
  const [viewportStats, setViewportStats] = useState<{ polyCount: number; meshCount: number } | null>(null);
  const [viewportBounds, setViewportBounds] = useState<{
    size: number;
    boxSize: [number, number, number];
    radius: number;
  } | null>(null);
  const [rightPanelMainBlock, setRightPanelMainBlock] = useState<RightPanelMainBlock>("create");
  const [createRefsOpen, setCreateRefsOpen] = useState(false);
  const [appearancePreset, setAppearancePreset] = useState<
    "clay" | "original" | "resin" | "plastic" | "hologram"
  >("original");
  const [appearanceTuningOpen, setAppearanceTuningOpen] = useState(false);
  const [appearanceRoughness, setAppearanceRoughness] = useState(72);
  const [appearanceMetalness, setAppearanceMetalness] = useState(8);
  const [appearanceFlatColor, setAppearanceFlatColor] = useState("#aab0ba");
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
  const [maskBrushHardness, setMaskBrushHardness] = useState(78);
  const [maskBrushSmoothing, setMaskBrushSmoothing] = useState(24);
  const [maskMagneticEdge, setMaskMagneticEdge] = useState(true);
  const [maskSnapStrength, setMaskSnapStrength] = useState(52);
  const [maskMode, setMaskMode] = useState<ManualMaskMode>("erase");
  const [maskWandTolerance, setMaskWandTolerance] = useState(34);
  const [maskWandAction, setMaskWandAction] = useState<"erase" | "restore">("erase");
  const [maskWandOuterOnly, setMaskWandOuterOnly] = useState(true);
  const [maskFeatherPx, setMaskFeatherPx] = useState(1);
  const [maskSmoothLevel, setMaskSmoothLevel] = useState(18);
  const [maskShiftEdgePx, setMaskShiftEdgePx] = useState(-1);
  const [maskWandAltPressed, setMaskWandAltPressed] = useState(false);
  const [maskPreviewMode, setMaskPreviewMode] = useState<MaskPreviewMode>("overlay");
  const [maskViewZoom, setMaskViewZoom] = useState(1);
  const [maskViewPanX, setMaskViewPanX] = useState(0);
  const [maskViewPanY, setMaskViewPanY] = useState(0);
  const [maskSpacePressed, setMaskSpacePressed] = useState(false);
  const [maskEditorError, setMaskEditorError] = useState<string | null>(null);
  const [maskApplying, setMaskApplying] = useState(false);
  const [maskAntsPhase, setMaskAntsPhase] = useState(0);
  const [, setMaskHistoryRevision] = useState(0);
  const [serverJob, setServerJob] = useState<AiGenerationJob | null>(null);
  const [serverJobLoading, setServerJobLoading] = useState(false);
  const [serverJobError, setServerJobError] = useState<string | null>(null);
  const [jobHistory, setJobHistory] = useState<AiGenerationJob[]>([]);
  const [jobHistoryLoading, setJobHistoryLoading] = useState(false);
  const [jobHistoryFilter, setJobHistoryFilter] = useState<JobHistoryFilter>("all");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [historyAction, setHistoryAction] = useState<{
    id: string;
    type: "retry" | "variation" | "delete" | "publish";
  } | null>(null);
  const [labPanelTab, setLabPanelTab] = useState<LabPanelTab>("history");
  const [assetAction, setAssetAction] = useState<{
    assetId: string;
    type: "analyze" | "fix_safe" | "fix_strong" | "split_auto" | "blender" | "texture";
  } | null>(null);
  const [blenderInstallOpen, setBlenderInstallOpen] = useState(false);
  const [remixJob, setRemixJob] = useState<AiGenerationJob | null>(null);
  const [remixPrompt, setRemixPrompt] = useState("");
  const [remixLocalEdit, setRemixLocalEdit] = useState(false);
  const [remixTargetZone, setRemixTargetZone] = useState("ноги");
  const [remixIssueReference, setRemixIssueReference] = useState<AiReferenceItem | null>(null);
  const [remixIssueLoading, setRemixIssueLoading] = useState(false);
  const [publishedAssetsByJobId, setPublishedAssetsByJobId] = useState<Record<string, string>>({});
  const [publishedAssetsById, setPublishedAssetsById] = useState<Record<string, AiAssetRecord>>({});
  const [latestCompletedJob, setLatestCompletedJob] = useState<AiGenerationJob | null>(null);
  const [activeHistoryJobId, setActiveHistoryJobId] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [freshGenerationMode, setFreshGenerationMode] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const remixIssueInputRef = useRef<HTMLInputElement>(null);
  const maskViewportRef = useRef<HTMLDivElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskImageNameRef = useRef<string>("reference");
  const maskSourcePixelsRef = useRef<Uint8ClampedArray | null>(null);
  const maskSourceAlphaRef = useRef<Uint8Array | null>(null);
  const maskInitialAlphaRef = useRef<Uint8Array | null>(null);
  const maskAlphaRef = useRef<Uint8Array | null>(null);
  const maskWidthRef = useRef(0);
  const maskHeightRef = useRef(0);
  const maskDrawingRef = useRef(false);
  const maskPanActiveRef = useRef(false);
  const maskPanPointerIdRef = useRef<number | null>(null);
  const maskPanStartClientRef = useRef<{ x: number; y: number } | null>(null);
  const maskPanStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const maskStrokeLastClientRef = useRef<{ x: number; y: number } | null>(null);
  const maskUndoStackRef = useRef<Uint8Array[]>([]);
  const maskRedoStackRef = useRef<Uint8Array[]>([]);
  const completedServerJobRef = useRef<string | null>(null);
  const lastErrorRef = useRef<{ message: string; at: number } | null>(null);
  const jobHistoryRequestInFlightRef = useRef(false);
  const mockTopupInFlightRef = useRef(false);
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
  const maskCanvasCursor = maskPanActiveRef.current || maskSpacePressed
    ? "grab"
    : maskMode === "wand"
      ? isWandRestorePreview
        ? WAND_CURSOR_RESTORE
        : WAND_CURSOR_ERASE
      : "crosshair";
  const isSynthRunning = serverJob?.status === "queued" || serverJob?.status === "processing";
  const effectiveThemeMode = uiThemeMode === "auto" ? (prefersDarkScheme ? "dark" : "light") : "dark";

  const { toasts, showError, showSuccess, removeToast } = useToast();
  const showErrorRef = useRef(showError);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setPrefersDarkScheme(media.matches);
    apply();
    const onChange = () => apply();
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(LAB_PANEL_TAB_STORAGE_KEY);
    if (stored === "assets" || stored === "history" || stored === "queue") {
      setLabPanelTab(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAB_PANEL_TAB_STORAGE_KEY, labPanelTab);
  }, [labPanelTab]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRightPanelQuery(rightPanelQueryInput);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [rightPanelQueryInput]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = (target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (key === "1" || key === "g") setRightPanelMainBlock("create");
      if (key === "2" || key === "c") setRightPanelMainBlock("check");
      if (key === "3" || key === "r") setRightPanelMainBlock("repair");
      if (key === "4" || key === "m") setRightPanelMainBlock("appearance");
      if (key === "5" || key === "e") setRightPanelMainBlock("export");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
            return;
          }
          throw new Error(
            typeof data?.error === "string" ? data.error : "Failed to fetch subscription status."
          );
        }
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

  const handleMockTopup = useCallback(
    async (rawAmount: unknown, source: "package" | "manual", packageId?: string) => {
      if (!mockBillingEnabled) {
        const message = "Mock-режим пополнения сейчас отключен.";
        setBillingUIState((prev) => ({
          ...prev,
          mockTopup: {
            ...prev.mockTopup,
            status: "error",
            selectedPackageId: packageId,
            errorMessage: message,
          },
        }));
        pushUiError(message);
        return;
      }
      if (billingUIState.mockTopup.status === "loading" || mockTopupInFlightRef.current) return;
      const validation = validateMockTopupAmount(rawAmount);
      if (!validation.ok) {
        setBillingUIState((prev) => ({
          ...prev,
          mockTopup: {
            ...prev.mockTopup,
            status: "error",
            selectedPackageId: packageId,
            customAmount: source === "manual" ? parseMockTopupAmount(rawAmount) ?? undefined : undefined,
            errorMessage: validation.error,
          },
        }));
        return;
      }

      const amount = validation.amount;
      setBillingUIState((prev) => ({
        ...prev,
        mockTopup: {
          status: "loading",
          selectedPackageId: packageId,
          customAmount: source === "manual" ? amount : undefined,
          errorMessage: undefined,
        },
      }));
      mockTopupInFlightRef.current = true;
      try {
        const result = await billingProvider.mockTopup({
          amount,
          source: source === "package" ? `package:${packageId || "unknown"}` : "manual",
        });
        setTokens(Math.max(0, Math.trunc(result.newBalance)));
        setBillingUIState((prev) => ({
          ...prev,
          tokenBalance: Math.max(0, Math.trunc(result.newBalance)),
          mockTopup: {
            status: "success",
            selectedPackageId: packageId,
            customAmount: source === "manual" ? amount : undefined,
          },
        }));
        showSuccess("Токены начислены (mock).");
        void fetchTokenHistory(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось пополнить токены (mock).";
        setBillingUIState((prev) => ({
          ...prev,
          mockTopup: {
            status: "error",
            selectedPackageId: packageId,
            customAmount: source === "manual" ? amount : undefined,
            errorMessage: message,
          },
        }));
        pushUiError(message);
      } finally {
        mockTopupInFlightRef.current = false;
      }
    },
    [billingUIState.mockTopup.status, fetchTokenHistory, pushUiError, showSuccess]
  );

  const handleMockPackageTopup = useCallback(
    (pack: { id: string; amount: number }) => {
      void handleMockTopup(pack.amount, "package", pack.id);
    },
    [handleMockTopup]
  );

  const handleMockCustomTopupSubmit = useCallback(() => {
    void handleMockTopup(mockCustomAmountInput, "manual");
  }, [handleMockTopup, mockCustomAmountInput]);

  const handleRealBillingPreviewClick = useCallback(() => {
    pushUiError("Пока недоступно. Подключаем реальный API.");
  }, [pushUiError]);

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
    () => {
      const canvas = maskCanvasRef.current;
      const sourcePixels = maskSourcePixelsRef.current;
      const alphaMask = maskAlphaRef.current;
      const sourceAlpha = maskSourceAlphaRef.current;
      const width = maskWidthRef.current;
      const height = maskHeightRef.current;
      if (!canvas || !sourcePixels || !alphaMask || width <= 0 || height <= 0) return;

      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;

      const refinedAlpha = buildRefinedMaskAlpha(alphaMask, width, height, {
        featherPx: maskFeatherPx,
        smooth: maskSmoothLevel,
        shiftEdge: maskShiftEdgePx,
        sourceAlpha,
      });
      const output = new Uint8ClampedArray(sourcePixels.length);
      const pixelCount = width * height;
      for (let i = 0; i < pixelCount; i += 1) {
        const idx = i * 4;
        const alpha = refinedAlpha[i];
        const a = clampNumber(alpha / 255, 0, 1);
        const sr = sourcePixels[idx];
        const sg = sourcePixels[idx + 1];
        const sb = sourcePixels[idx + 2];
        if (maskPreviewMode === "alpha") {
          output[idx] = alpha;
          output[idx + 1] = alpha;
          output[idx + 2] = alpha;
          output[idx + 3] = 255;
          continue;
        }
        if (maskPreviewMode === "overlay") {
          const strength = clampNumber(1 - a, 0, 1);
          const tint = 0.72 * strength;
          output[idx] = Math.round(sr * (1 - tint) + 255 * tint);
          output[idx + 1] = Math.round(sg * (1 - tint) + 54 * tint);
          output[idx + 2] = Math.round(sb * (1 - tint) + 86 * tint);
          output[idx + 3] = 255;
          continue;
        }
        const checker = ((Math.floor((i % width) / 12) + Math.floor(Math.floor(i / width) / 12)) % 2) === 0 ? 224 : 168;
        const bg =
          maskPreviewMode === "black" ? 0 : maskPreviewMode === "white" ? 255 : checker;
        output[idx] = Math.round(sr * a + bg * (1 - a));
        output[idx + 1] = Math.round(sg * a + bg * (1 - a));
        output[idx + 2] = Math.round(sb * a + bg * (1 - a));
        output[idx + 3] = 255;
      }

      context.putImageData(new ImageData(output, width, height), 0, 0);

      if (maskPreviewMode === "overlay") {
        const antsThreshold = 180;
        const phase = maskAntsPhase % 12;
        for (let y = 0; y < height - 1; y += 1) {
          for (let x = 0; x < width - 1; x += 1) {
            const index = y * width + x;
            const here = refinedAlpha[index] >= antsThreshold;
            const right = refinedAlpha[index + 1] >= antsThreshold;
            const down = refinedAlpha[index + width] >= antsThreshold;
            if (here === right && here === down) continue;
            const tick = (x + y + phase) % 10;
            context.fillStyle = tick < 5 ? "rgba(255,255,255,0.88)" : "rgba(8,12,16,0.9)";
            context.fillRect(x, y, 1, 1);
          }
        }
      }
    },
    [maskAntsPhase, maskFeatherPx, maskPreviewMode, maskShiftEdgePx, maskSmoothLevel]
  );

  useEffect(() => {
    if (!maskEditorOpen) return;
    renderMaskEditorCanvas();
  }, [maskEditorOpen, maskPreviewMode, maskAntsPhase, maskFeatherPx, maskSmoothLevel, maskShiftEdgePx, renderMaskEditorCanvas]);

  useEffect(() => {
    if (!maskEditorOpen || maskPreviewMode !== "overlay") return;
    const timer = window.setInterval(() => {
      setMaskAntsPhase((value) => (value + 1) % 1200);
    }, 120);
    return () => window.clearInterval(timer);
  }, [maskEditorOpen, maskPreviewMode]);

  useEffect(() => {
    if (!maskEditorOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setMaskWandAltPressed(true);
      }
      if (event.key === " ") {
        event.preventDefault();
        setMaskSpacePressed(true);
      }
      if (event.key === "[" && maskMode !== "wand") {
        event.preventDefault();
        setMaskBrushSize((value) => clampNumber(value - 4, 1, 300));
      }
      if (event.key === "]" && maskMode !== "wand") {
        event.preventDefault();
        setMaskBrushSize((value) => clampNumber(value + 4, 1, 300));
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setMaskWandAltPressed(false);
      }
      if (event.key === " ") {
        setMaskSpacePressed(false);
      }
    };
    const handleBlur = () => {
      setMaskWandAltPressed(false);
      setMaskSpacePressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [maskEditorOpen, maskMode]);

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
    (clientX: number, clientY: number, options?: { skipRender?: boolean }) => {
      const canvas = maskCanvasRef.current;
      const alphaMask = maskAlphaRef.current;
      const sourceAlpha = maskSourceAlphaRef.current;
      const sourcePixels = maskSourcePixelsRef.current;
      if (!canvas || !alphaMask || !sourceAlpha || !sourcePixels) return false;

      const width = maskWidthRef.current;
      const height = maskHeightRef.current;
      if (width <= 0 || height <= 0) return false;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;

      let x = ((clientX - rect.left) * width) / rect.width;
      let y = ((clientY - rect.top) * height) / rect.height;
      const radius = Math.max(1.5, (maskBrushSize * width) / rect.width);
      if (maskMagneticEdge) {
        const snapped = findSnappedEdgePoint(x, y, radius, maskSnapStrength, sourcePixels, width, height);
        if (snapped.confidence > 0.05) {
          x = snapped.x;
          y = snapped.y;
        }
      }

      const radiusSq = radius * radius;
      const minX = clampNumber(Math.floor(x - radius), 0, width - 1);
      const maxX = clampNumber(Math.ceil(x + radius), 0, width - 1);
      const minY = clampNumber(Math.floor(y - radius), 0, height - 1);
      const maxY = clampNumber(Math.ceil(y + radius), 0, height - 1);
      const hardnessRatio = clampNumber(maskBrushHardness, 0, 100) / 100;
      const hardRadius = radius * clampNumber(hardnessRatio, 0.05, 0.98);

      let changed = false;
      for (let py = minY; py <= maxY; py += 1) {
        const dy = py - y;
        for (let px = minX; px <= maxX; px += 1) {
          const dx = px - x;
          const distSq = dx * dx + dy * dy;
          if (distSq > radiusSq) continue;
          const distance = Math.sqrt(distSq);
          let influence = 1;
          if (distance > hardRadius) {
            const featherSpan = Math.max(0.0001, radius - hardRadius);
            influence = clampNumber(1 - (distance - hardRadius) / featherSpan, 0, 1);
          }
          if (influence <= 0) continue;
          const index = py * width + px;
          const current = alphaMask[index];
          const target = maskMode === "erase" ? 0 : sourceAlpha[index];
          const next = Math.round(clampNumber(current + (target - current) * influence, 0, sourceAlpha[index]));
          if (next !== current) {
            alphaMask[index] = next;
            changed = true;
          }
        }
      }

      if (changed && !options?.skipRender) {
        renderMaskEditorCanvas();
      }
      return changed;
    },
    [maskBrushHardness, maskBrushSize, maskMagneticEdge, maskMode, maskSnapStrength, renderMaskEditorCanvas]
  );

  const paintMaskStrokeTo = useCallback(
    (clientX: number, clientY: number) => {
      const previous = maskStrokeLastClientRef.current;
      if (!previous) {
        const changed = paintMaskAt(clientX, clientY, { skipRender: true });
        maskStrokeLastClientRef.current = { x: clientX, y: clientY };
        if (changed) {
          renderMaskEditorCanvas();
        }
        return;
      }
      const smoothingRatio = clampNumber(maskBrushSmoothing, 0, 100) / 100;
      const response = clampNumber(1 - smoothingRatio * 0.84, 0.12, 1);
      const filteredX = previous.x + (clientX - previous.x) * response;
      const filteredY = previous.y + (clientY - previous.y) * response;
      const dx = filteredX - previous.x;
      const dy = filteredY - previous.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const spacing = Math.max(1, maskBrushSize * 0.22);
      const steps = Math.max(1, Math.ceil(distance / spacing));
      let changed = false;
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const x = previous.x + dx * t;
        const y = previous.y + dy * t;
        changed = paintMaskAt(x, y, { skipRender: true }) || changed;
      }
      maskStrokeLastClientRef.current = { x: filteredX, y: filteredY };
      if (changed) {
        renderMaskEditorCanvas();
      }
    },
    [maskBrushSize, maskBrushSmoothing, paintMaskAt, renderMaskEditorCanvas]
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
        renderMaskEditorCanvas();
      }
    },
    [maskWandOuterOnly, maskWandTolerance, renderMaskEditorCanvas]
  );

  const applyMaskZoom = useCallback(
    (nextZoomRaw: number, anchorClientX?: number, anchorClientY?: number) => {
      const viewport = maskViewportRef.current;
      const nextZoom = clampNumber(nextZoomRaw, 0.25, 16);
      if (!viewport || anchorClientX === undefined || anchorClientY === undefined) {
        setMaskViewZoom(nextZoom);
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const anchorX = anchorClientX - rect.left;
      const anchorY = anchorClientY - rect.top;
      const imageX = (anchorX - maskViewPanX) / maskViewZoom;
      const imageY = (anchorY - maskViewPanY) / maskViewZoom;
      setMaskViewZoom(nextZoom);
      setMaskViewPanX(anchorX - imageX * nextZoom);
      setMaskViewPanY(anchorY - imageY * nextZoom);
    },
    [maskViewPanX, maskViewPanY, maskViewZoom]
  );

  const handleMaskCanvasWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!maskEditorOpen) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.11 : 0.9;
      applyMaskZoom(maskViewZoom * factor, event.clientX, event.clientY);
    },
    [applyMaskZoom, maskEditorOpen, maskViewZoom]
  );

  const handleMaskZoomFit = useCallback(() => {
    const viewport = maskViewportRef.current;
    const width = maskWidthRef.current;
    const height = maskHeightRef.current;
    if (!viewport || width <= 0 || height <= 0) return;
    const availableW = Math.max(10, viewport.clientWidth - 24);
    const availableH = Math.max(10, viewport.clientHeight - 24);
    const nextZoom = clampNumber(Math.min(availableW / width, availableH / height), 0.25, 16);
    setMaskViewZoom(nextZoom);
    setMaskViewPanX((viewport.clientWidth - width * nextZoom) / 2);
    setMaskViewPanY((viewport.clientHeight - height * nextZoom) / 2);
  }, []);

  const handleMaskZoomReset = useCallback(() => {
    const viewport = maskViewportRef.current;
    const width = maskWidthRef.current;
    const height = maskHeightRef.current;
    setMaskViewZoom(1);
    if (!viewport || width <= 0 || height <= 0) {
      setMaskViewPanX(0);
      setMaskViewPanY(0);
      return;
    }
    setMaskViewPanX((viewport.clientWidth - width) / 2);
    setMaskViewPanY((viewport.clientHeight - height) / 2);
  }, []);

  const handleMaskZoomStep = useCallback(
    (direction: 1 | -1) => {
      applyMaskZoom(maskViewZoom * (direction > 0 ? 1.18 : 0.84));
    },
    [applyMaskZoom, maskViewZoom]
  );

  const handleMaskCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (maskApplying) return;
      event.preventDefault();
      const shouldPan = maskSpacePressed || event.button === 1;
      if (shouldPan) {
        maskPanActiveRef.current = true;
        maskPanPointerIdRef.current = event.pointerId;
        maskPanStartClientRef.current = { x: event.clientX, y: event.clientY };
        maskPanStartRef.current = { x: maskViewPanX, y: maskViewPanY };
        event.currentTarget.setPointerCapture(event.pointerId);
        setMaskHistoryRevision((value) => value + 1);
        return;
      }
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
      maskStrokeLastClientRef.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      paintMaskStrokeTo(event.clientX, event.clientY);
    },
    [
      applyWandAt,
      maskApplying,
      maskMode,
      maskSpacePressed,
      maskViewPanX,
      maskViewPanY,
      maskWandAction,
      paintMaskStrokeTo,
      pushMaskUndoSnapshot,
    ]
  );

  const handleMaskCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (maskPanActiveRef.current) {
        if (maskPanPointerIdRef.current !== null && maskPanPointerIdRef.current !== event.pointerId) return;
        const startClient = maskPanStartClientRef.current;
        const panStart = maskPanStartRef.current;
        if (!startClient) return;
        const dx = event.clientX - startClient.x;
        const dy = event.clientY - startClient.y;
        setMaskViewPanX(panStart.x + dx);
        setMaskViewPanY(panStart.y + dy);
        return;
      }
      if (!maskDrawingRef.current) return;
      event.preventDefault();
      paintMaskStrokeTo(event.clientX, event.clientY);
    },
    [paintMaskStrokeTo]
  );

  const handleMaskCanvasPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    let hasCapture = false;
    if (maskPanActiveRef.current) {
      if (maskPanPointerIdRef.current !== null && maskPanPointerIdRef.current !== event.pointerId) return;
      maskPanActiveRef.current = false;
      maskPanPointerIdRef.current = null;
      maskPanStartClientRef.current = null;
      hasCapture = true;
      setMaskHistoryRevision((value) => value + 1);
    }
    if (!maskDrawingRef.current && !hasCapture) return;
    event.preventDefault();
    maskDrawingRef.current = false;
    maskStrokeLastClientRef.current = null;
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
    renderMaskEditorCanvas();
  }, [renderMaskEditorCanvas]);

  const handleMaskRedo = useCallback(() => {
    const alphaMask = maskAlphaRef.current;
    if (!alphaMask || maskRedoStackRef.current.length === 0) return;
    const next = maskRedoStackRef.current.pop();
    if (!next) return;
    maskUndoStackRef.current.push(alphaMask.slice());
    maskAlphaRef.current = next.slice();
    setMaskHistoryRevision((value) => value + 1);
    renderMaskEditorCanvas();
  }, [renderMaskEditorCanvas]);

  const handleMaskReset = useCallback(() => {
    const initialAlpha = maskInitialAlphaRef.current;
    if (!initialAlpha) return;
    maskAlphaRef.current = initialAlpha.slice();
    maskUndoStackRef.current = [];
    maskRedoStackRef.current = [];
    setMaskHistoryRevision((value) => value + 1);
    renderMaskEditorCanvas();
  }, [renderMaskEditorCanvas]);

  const handleMaskInvert = useCallback(() => {
    const sourceAlpha = maskSourceAlphaRef.current;
    const alphaMask = maskAlphaRef.current;
    if (!sourceAlpha || !alphaMask) return;
    pushMaskUndoSnapshot();
    for (let i = 0; i < alphaMask.length; i += 1) {
      alphaMask[i] = clampNumber(sourceAlpha[i] - alphaMask[i], 0, sourceAlpha[i]);
    }
    renderMaskEditorCanvas();
  }, [pushMaskUndoSnapshot, renderMaskEditorCanvas]);

  useEffect(() => {
    if (!maskEditorOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleMaskRedo();
          return;
        }
        handleMaskUndo();
        return;
      }
      if (key === "y") {
        event.preventDefault();
        handleMaskRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleMaskRedo, handleMaskUndo, maskEditorOpen]);

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
    maskPanActiveRef.current = false;
    maskPanPointerIdRef.current = null;
    maskPanStartClientRef.current = null;
    maskStrokeLastClientRef.current = null;
    setMaskWandAltPressed(false);
    setMaskSpacePressed(false);
    setMaskViewZoom(1);
    setMaskViewPanX(0);
    setMaskViewPanY(0);
    setMaskEditorError(null);
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
      setMaskEditorError(null);
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
        setMaskBrushHardness(78);
        setMaskBrushSmoothing(24);
        setMaskMagneticEdge(true);
        setMaskSnapStrength(52);
        setMaskWandAction("erase");
        setMaskWandOuterOnly(true);
        setMaskFeatherPx(1);
        setMaskSmoothLevel(18);
        setMaskShiftEdgePx(-1);
        setMaskWandAltPressed(false);
        setMaskPreviewMode("overlay");
        setMaskViewZoom(1);
        setMaskViewPanX(0);
        setMaskViewPanY(0);
        setMaskEditorError(null);
        setMaskEditorRefId(refId);
        setMaskEditorOpen(true);
        requestAnimationFrame(() => {
          handleMaskZoomFit();
          renderMaskEditorCanvas();
        });
      } catch (error) {
        setMaskEditorError("Не удалось открыть редактор маски.");
        pushUiError(error instanceof Error ? error.message : "Failed to open mask editor.");
      } finally {
        setMaskEditorLoading(false);
      }
    },
    [
      maskApplying,
      maskEditorLoading,
      handleMaskZoomFit,
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
    const sourceAlpha = maskSourceAlphaRef.current;
    const width = maskWidthRef.current;
    const height = maskHeightRef.current;
    if (!sourcePixels || !alphaMask || width <= 0 || height <= 0) {
      showError("Mask editor data is unavailable.");
      setMaskEditorError("Не удалось применить маску: данные редактора недоступны.");
      return;
    }

    setMaskEditorError(null);
    setMaskApplying(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas context is unavailable.");

      const output = new Uint8ClampedArray(sourcePixels.length);
      const finalAlpha = buildRefinedMaskAlpha(alphaMask, width, height, {
        featherPx: maskFeatherPx,
        smooth: maskSmoothLevel,
        shiftEdge: maskShiftEdgePx,
        sourceAlpha,
      });
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
      const message = error instanceof Error ? error.message : "Failed to apply mask.";
      setMaskEditorError("Не удалось применить маску.");
      pushUiError(message);
    } finally {
      setMaskApplying(false);
    }
  }, [
    closeMaskEditor,
    maskApplying,
    maskEditorRefId,
    maskFeatherPx,
    maskShiftEdgePx,
    maskSmoothLevel,
    pushUiError,
    showError,
    showSuccess,
  ]);

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
          return { byId: {}, byJobId: {} } as {
            byId: Record<string, AiAssetRecord>;
            byJobId: Record<string, string>;
          };
        }
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (!silent) {
            throw new Error(typeof data?.error === "string" ? data.error : "Failed to fetch AI assets.");
          }
          return null;
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
        return { byId, byJobId: next };
      } catch (error) {
        if (!silent) {
          pushUiError(error instanceof Error ? error.message : "Failed to fetch AI assets.");
        }
        return null;
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

  useEffect(() => {
    if (freshGenerationMode) return;
    if (activeHistoryJobId) return;
    if (latestCompletedJob?.id) {
      setActiveHistoryJobId(latestCompletedJob.id);
    } else if (jobHistory[0]?.id) {
      setActiveHistoryJobId(jobHistory[0].id);
    }
  }, [activeHistoryJobId, freshGenerationMode, jobHistory, latestCompletedJob?.id]);

  useEffect(() => {
    if (freshGenerationMode) return;
    if (activeVersionId && publishedAssetsById[activeVersionId]) return;
    if (activeHistoryJobId) {
      const linkedAssetId = publishedAssetsByJobId[activeHistoryJobId];
      if (linkedAssetId) {
        setActiveVersionId(linkedAssetId);
      }
      return;
    }
    const fallback = Object.keys(publishedAssetsById)[0];
    if (!activeVersionId && fallback) {
      setActiveVersionId(fallback);
    }
  }, [activeHistoryJobId, activeVersionId, freshGenerationMode, publishedAssetsById, publishedAssetsByJobId]);

  const handleStartServerSynthesis = useCallback(async () => {
    if (serverJobLoading || isSynthRunning) return;
    const requiredTokenCost = resolveGenerationTokenCost(tokenCost, {
      quality: qualityPreset,
      style: stylePreset,
      advanced: advancedPreset,
    });
    if (tokensLoading) {
      showError("Токены еще загружаются.");
      return;
    }
    if (tokens < requiredTokenCost) {
      showError(`Недостаточно токенов. Нужно минимум ${requiredTokenCost}.`);
      return;
    }
    if (!prompt.trim() && validInputReferences.length === 0 && !localPreviewModel && !previewModel) {
      showError("Добавьте промпт или референс перед генерацией.");
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
          generationProfile: {
            quality: qualityPreset,
            style: stylePreset,
            advanced: advancedPreset,
          },
          aiMode: qualityPreset === "pro" ? "pro" : "standard",
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
      if (!response.ok) {
        const message =
          typeof data?.error === "string" ? data.error : "Не удалось создать AI-задачу.";
        throw new Error(message);
      }
      if (typeof data?.tokensRemaining !== "number") {
        void fetchTokens(true);
        void fetchTokenHistory(true);
      }
      const nextJob = data?.job as AiGenerationJob | undefined;
      if (!nextJob?.id) {
        throw new Error("Сервер вернул некорректный payload задачи.");
      }
      completedServerJobRef.current = null;
      setServerJob(nextJob);
      void fetchJobHistory(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось создать AI-задачу.";
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
    qualityPreset,
    stylePreset,
    advancedPreset,
  ]);

  const handleStartNewGeneration = useCallback(() => {
    if (serverJobLoading || isSynthRunning) {
      showError("Сначала дождитесь завершения текущей генерации или остановите мониторинг.");
      return;
    }
    setShowResult(false);
    setResultAsset(null);
    setServerJob(null);
    setServerJobError(null);
    setLatestCompletedJob(null);
    setGeneratedPreviewModel(null);
    setGeneratedPreviewLabel(null);
    setLocalPreviewModel(null);
    setLocalPreviewLabel(null);
    setUploadedModelName(null);
    setPrompt("");
    clearInputReferences();
    setFreshGenerationMode(true);
    setActiveHistoryJobId(null);
    setActiveVersionId(null);
    setPreviewParam(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("preview")) {
        url.searchParams.delete("preview");
        window.history.replaceState({}, "", url.toString());
      }
    }
    showSuccess("Новая генерация: рабочая область очищена.");
  }, [clearInputReferences, isSynthRunning, serverJobLoading, showError, showSuccess]);

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
          setFreshGenerationMode(false);
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

  const activatePublishedAsset = useCallback(
    (asset: AiAssetRecord | null, options?: { jobId?: string | null }) => {
      if (!asset) return;
      setFreshGenerationMode(false);
      setActiveVersionId(asset.id);
      if (typeof options?.jobId === "string" && options.jobId) {
        setActiveHistoryJobId(options.jobId);
      }
      if (asset.modelUrl) {
        setGeneratedPreviewModel(asset.modelUrl);
        setGeneratedPreviewLabel(asset.title || `Asset ${asset.id}`);
      }
    },
    []
  );

  useEffect(() => {
    setBillingUIState((prev) => {
      const normalized = Math.max(0, Math.trunc(tokens));
      if (prev.tokenBalance === normalized) return prev;
      return { ...prev, tokenBalance: normalized };
    });
  }, [tokens]);

  const handleSelectAsset = (asset: GeneratedAsset) => {
    if (!asset.modelUrl) {
      showError("Файл модели недоступен. Загрузите модель заново.");
      return;
    }
    setFreshGenerationMode(false);
    setActiveHistoryJobId(null);
    setActiveVersionId(null);
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

  const handleRemoveGalleryAsset = useCallback(
    (asset: GeneratedAsset) => {
      setGallery((prev) => prev.filter((item) => item.id !== asset.id));
      if (generatedPreviewLabel === asset.name && generatedPreviewModel === asset.modelUrl) {
        setGeneratedPreviewModel(null);
        setGeneratedPreviewLabel(null);
      }
      showSuccess("Модель удалена из витрины.");
    },
    [generatedPreviewLabel, generatedPreviewModel, showSuccess]
  );

  const handlePickHistoryJob = useCallback((job: AiGenerationJob) => {
    setFreshGenerationMode(false);
    setActiveHistoryJobId(job.id);
    const linkedAssetId = publishedAssetsByJobId[job.id] || null;
    if (linkedAssetId) {
      setActiveVersionId(linkedAssetId);
      const linkedAsset = publishedAssetsById[linkedAssetId] || null;
      if (linkedAsset?.modelUrl) {
        setGeneratedPreviewModel(linkedAsset.modelUrl);
        setGeneratedPreviewLabel(linkedAsset.title || job.prompt || `Job ${job.id}`);
      }
    } else {
      setActiveVersionId(null);
    }
    if (job.mode === "text" || job.mode === "image") {
      setMode(job.mode);
    }
    if (job.prompt) {
      setPrompt(job.prompt);
    }
    if (job.result?.modelUrl) {
      if (!linkedAssetId) {
        setGeneratedPreviewModel(job.result.modelUrl);
        setGeneratedPreviewLabel(job.prompt || `Job ${job.id}`);
      }
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
  }, [publishedAssetsById, publishedAssetsByJobId]);

  const handleRetryHistoryJob = useCallback(
    async (job: AiGenerationJob) => {
      const requiredTokenCost = resolveGenerationTokenCost(tokenCost, {
        quality: qualityPreset,
        style: stylePreset,
        advanced: advancedPreset,
      });
      if (serverJobLoading || isSynthRunning) {
        showError("Wait until current generation is finished.");
        return;
      }
      if (tokensLoading) {
        showError("Токены еще загружаются.");
        return;
      }
      if (tokens < requiredTokenCost) {
        showError(`Недостаточно токенов. Нужно минимум ${requiredTokenCost}.`);
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
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            generationProfile: {
              quality: qualityPreset,
              style: stylePreset,
              advanced: advancedPreset,
            },
            aiMode: qualityPreset === "pro" ? "pro" : "standard",
          }),
        });
        const data = await response.json().catch(() => null);
        if (typeof data?.tokensRemaining === "number" && Number.isFinite(data.tokensRemaining)) {
          setTokens(Math.max(0, Math.trunc(data.tokensRemaining)));
          void fetchTokenHistory(true);
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
      qualityPreset,
      serverJobLoading,
      showError,
      stylePreset,
      advancedPreset,
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
      const requiredTokenCost = resolveGenerationTokenCost(tokenCost, {
        quality: qualityPreset,
        style: stylePreset,
        advanced: advancedPreset,
      });
      if (job.status !== "completed") {
        showError("Variation is available only for completed jobs.");
        return false;
      }
      if (serverJobLoading || isSynthRunning) {
        showError("Wait until current generation is finished.");
        return false;
      }
      if (tokensLoading) {
        showError("Токены еще загружаются.");
        return false;
      }
      if (tokens < requiredTokenCost) {
        showError(`Недостаточно токенов. Нужно минимум ${requiredTokenCost}.`);
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
            generationProfile: {
              quality: qualityPreset,
              style: stylePreset,
              advanced: advancedPreset,
            },
            aiMode: qualityPreset === "pro" ? "pro" : "standard",
            ...(issueReference ? { sourceRefs: [issueReference] } : {}),
          }),
        });
        const data = await response.json().catch(() => null);
        if (typeof data?.tokensRemaining === "number" && Number.isFinite(data.tokensRemaining)) {
          setTokens(Math.max(0, Math.trunc(data.tokensRemaining)));
          void fetchTokenHistory(true);
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
      qualityPreset,
      serverJobLoading,
      showError,
      stylePreset,
      advancedPreset,
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
        const existingAssetId = String(publishedAssetsByJobId[job.id] || "").trim();
        toast.success("Сохранено в AI библиотеку", {
          className: "sonner-toast",
          action: existingAssetId
            ? {
                label: "Переименовать",
                onClick: () => {
                  router.push(
                    `/profile?tab=ai-assets&renameAssetId=${encodeURIComponent(existingAssetId)}`
                  );
                },
              }
            : undefined,
        });
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
        setActiveHistoryJobId(job.id);
        setActiveVersionId(String(data.asset.id));
        toast.success("Сохранено в AI библиотеку", {
          className: "sonner-toast",
          action: {
            label: "Переименовать",
            onClick: () => {
              router.push(
                `/profile?tab=ai-assets&renameAssetId=${encodeURIComponent(String(data.asset.id))}`
              );
            },
          },
        });
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
    [fetchPublishedAssets, publishedAssetsByJobId, pushUiError, router, showError]
  );

  const waitForPipelineJob = useCallback(
    async (jobId: string, timeoutMs = 15000) => {
      const startedAt = Date.now();
      let attempts = 0;
      while (Date.now() - startedAt < timeoutMs) {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "Failed to fetch job status.");
        }
        const status = typeof data?.status === "string" ? data.status : "";
        if (status === "done") return data;
        if (status === "error") {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : typeof data?.message === "string"
                ? data.message
                : "Asset operation failed."
          );
        }
        attempts += 1;
        const hiddenBoost =
          typeof document !== "undefined" && document.visibilityState === "hidden" ? 800 : 0;
        const backoff = Math.min(1200, attempts * 180);
        await new Promise((resolve) => setTimeout(resolve, 1000 + backoff + hiddenBoost));
      }
      throw new Error("Job timeout. Please retry.");
    },
    []
  );

  const queueBlenderJobForAsset = useCallback(
    async (asset: AiAssetRecord) => {
      const assetId = asset.id;
      if (!BLENDER_BRIDGE_ENABLED) {
        setBlenderInstallOpen(true);
        return;
      }
      if (assetAction) return;
      const versionId = asset.id;
      setAssetAction({ assetId, type: "blender" });
      try {
        const response = await fetch(DCC_BLENDER_JOBS_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            assetId,
            versionId,
            format: "glb",
            options: {
              scale: "meters",
              importMode: "new_collection",
            },
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success || !data?.jobId) {
          throw new Error(typeof data?.error === "string" ? data.error : "Failed to queue Blender job.");
        }
        showSuccess("Open in Blender: queued. Waiting for Blender Bridge pickup.");
        void fetchPublishedAssets(true);
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Failed to queue Blender job.");
      } finally {
        setAssetAction((prev) => (prev?.assetId === assetId ? null : prev));
      }
    },
    [
      assetAction,
      fetchPublishedAssets,
      pushUiError,
      showSuccess,
    ]
  );

  const handleDownloadAssetGlb = useCallback(
    (asset: AiAssetRecord) => {
      if (typeof window === "undefined") return;
      const href = ASSET_EXPORT_API(asset.id, asset.id, "glb");
      const link = document.createElement("a");
      link.href = href;
      link.download = `${(asset.title || "ai-model").replace(/[^a-zA-Z0-9_-]+/g, "-")}.glb`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    []
  );

  const handleDownloadAssetPack = useCallback(
    (asset: AiAssetRecord) => {
      if (typeof window === "undefined") return;
      const href = ASSET_EXPORT_API(asset.id, asset.id, "zip");
      const link = document.createElement("a");
      link.href = href;
      link.download = `${(asset.title || "ai-model").replace(/[^a-zA-Z0-9_-]+/g, "-")}-pack.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    []
  );

  const handleSendAssetToPrint = useCallback((asset: AiAssetRecord | null) => {
    if (!asset?.modelUrl) {
      showError("Сначала сгенерируйте/выберите модель.");
      return;
    }
    const params = new URLSearchParams();
    params.set("model", asset.modelUrl);
    params.set("name", (asset.title || "AI Model").trim().slice(0, 90));
    if (asset.previewUrl) {
      params.set("thumb", asset.previewUrl);
    }
    params.set("tech", "sla");
    router.push(`/services/print?${params.toString()}`);
  }, [router, showError]);

  const handleShowAssetIssues = useCallback(
    (asset: AiAssetRecord | null) => {
      if (!asset) {
        showError("Нет данных диагностики.");
        return;
      }
      const issues = asset?.checks?.diagnostics?.issues || asset?.checks?.topology?.issues || [];
      if (!Array.isArray(issues) || issues.length === 0) {
        setViewerIssuesOverlay(false);
        showSuccess("Show issues: проблем не обнаружено.");
        return;
      }
      setViewerIssuesOverlay(true);
      const message = issues
        .slice(0, 3)
        .map((issue) => (typeof issue?.message === "string" ? issue.message : "Issue"))
        .join(" | ");
      showSuccess(`Issues: ${message}`);
    },
    [showError, showSuccess]
  );

  const activeHistoryJob = useMemo(
    () => (activeHistoryJobId ? jobHistory.find((job) => job.id === activeHistoryJobId) || null : null),
    [activeHistoryJobId, jobHistory]
  );

  const activeAssetVersion = useMemo(() => {
    if (activeVersionId && publishedAssetsById[activeVersionId]) {
      return publishedAssetsById[activeVersionId];
    }
    if (activeHistoryJob?.id) {
      const linkedAssetId = publishedAssetsByJobId[activeHistoryJob.id];
      if (linkedAssetId && publishedAssetsById[linkedAssetId]) {
        return publishedAssetsById[linkedAssetId];
      }
    }
    return null;
  }, [activeHistoryJob?.id, activeVersionId, publishedAssetsById, publishedAssetsByJobId]);

  useEffect(() => {
    if (!activeAssetVersion?.modelUrl) return;
    setGeneratedPreviewModel(activeAssetVersion.modelUrl);
    setGeneratedPreviewLabel(activeAssetVersion.title || `Asset ${activeAssetVersion.id}`);
  }, [activeAssetVersion?.id, activeAssetVersion?.modelUrl, activeAssetVersion?.title]);

  const isAnalysisFresh = useCallback((asset: AiAssetRecord | null) => {
    const analyzedAtRaw = asset?.checks?.diagnostics?.analyzedAt;
    if (!analyzedAtRaw) return false;
    const analyzedAtMs = new Date(analyzedAtRaw).getTime();
    if (!Number.isFinite(analyzedAtMs)) return false;
    return Date.now() - analyzedAtMs <= 5 * 60 * 1000;
  }, []);

  const handleAnalyzeActiveAsset = useCallback(
    async (asset: AiAssetRecord | null, force = false) => {
      if (!asset) {
        showError("Сначала выберите модель в истории или ассетах.");
        return;
      }
      if (!force && isAnalysisFresh(asset)) {
        showSuccess("Анализ свежий. Можно нажать «Обновить анализ».");
        return;
      }
      if (assetAction) return;
      const assetId = asset.id;
      const versionId = asset.id;
      setAssetAction({ assetId, type: "analyze" });
      try {
        const response = await fetch(ASSET_ANALYZE_API(assetId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ versionId }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success || !data?.jobId) {
          throw new Error(typeof data?.error === "string" ? data.error : "Анализ не выполнен.");
        }
        const settled = await waitForPipelineJob(String(data.jobId));
        const stats = (settled?.result?.stats || data?.result?.stats || {}) as {
          status?: "ok" | "warning" | "critical";
          riskScore?: number;
          issues?: Array<{ message?: string }>;
        };
        const status = stats?.status || "ok";
        const firstIssue =
          Array.isArray(stats?.issues) && stats.issues[0]?.message
            ? String(stats.issues[0].message)
            : "";
        showSuccess(
          status === "critical"
            ? `Диагностика: критично (Q:${stats?.riskScore ?? "?"}). ${firstIssue}`.trim()
            : status === "warning"
              ? `Диагностика: предупреждение (Q:${stats?.riskScore ?? "?"}). ${firstIssue}`.trim()
              : `Диагностика: сетка в норме (Q:${stats?.riskScore ?? "?"}).`
        );
        const snapshot = await fetchPublishedAssets(true);
        const refreshed = snapshot?.byId?.[assetId] || null;
        if (refreshed) {
          activatePublishedAsset(refreshed, { jobId: activeHistoryJob?.id || refreshed.jobId || null });
        }
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Анализ не выполнен.");
      } finally {
        setAssetAction((prev) => (prev?.assetId === assetId ? null : prev));
      }
    },
    [
      activatePublishedAsset,
      activeHistoryJob?.id,
      assetAction,
      fetchPublishedAssets,
      isAnalysisFresh,
      pushUiError,
      showError,
      showSuccess,
      waitForPipelineJob,
    ]
  );

  const handleQuickFixActiveAsset = useCallback(
    async (asset: AiAssetRecord | null, preset: "safe" | "strong" = "safe") => {
      if (!asset) {
        showError("Сначала выберите модель в истории или ассетах.");
        return;
      }
      if (assetAction) return;
      const assetId = asset.id;
      const versionId = asset.id;
      setAssetAction({ assetId, type: preset === "strong" ? "fix_strong" : "fix_safe" });
      try {
        const response = await fetch(ASSET_FIX_API(assetId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ versionId, preset }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success || !data?.jobId) {
          throw new Error(typeof data?.error === "string" ? data.error : "Быстрый фикс не выполнен.");
        }
        const settled = await waitForPipelineJob(String(data.jobId));
        const result = (settled?.result || data?.result || {}) as {
          noChanges?: boolean;
          newVersionId?: string;
        };
        if (result?.noChanges) {
          showSuccess("Быстрый фикс: изменений не найдено.");
        } else {
          showSuccess(
            preset === "strong"
              ? `Исправить для печати: готово (версия ${result?.newVersionId || "new"}).`
              : `Быстрый фикс: готово (версия ${result?.newVersionId || "new"}).`
          );
        }
        const snapshot = await fetchPublishedAssets(true);
        if (result?.newVersionId && snapshot?.byId?.[result.newVersionId]) {
          activatePublishedAsset(snapshot.byId[result.newVersionId], {
            jobId: activeHistoryJob?.id || snapshot.byId[result.newVersionId].jobId || null,
          });
        } else if (!result?.newVersionId && snapshot?.byId?.[assetId]) {
          activatePublishedAsset(snapshot.byId[assetId], {
            jobId: activeHistoryJob?.id || snapshot.byId[assetId].jobId || null,
          });
        }
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("ai-assets-updated"));
        }
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Быстрый фикс не выполнен.");
      } finally {
        setAssetAction((prev) => (prev?.assetId === assetId ? null : prev));
      }
    },
    [
      activatePublishedAsset,
      activeHistoryJob?.id,
      assetAction,
      fetchPublishedAssets,
      pushUiError,
      showError,
      showSuccess,
      waitForPipelineJob,
    ]
  );

  const handleSplitActiveAsset = useCallback(
    async (asset: AiAssetRecord | null) => {
      if (!asset) {
        showError("Сначала выберите модель в истории или ассетах.");
        return;
      }
      if (assetAction) return;
      const assetId = asset.id;
      const versionId = asset.id;
      setAssetAction({ assetId, type: "split_auto" });
      try {
        const response = await fetch(ASSET_SPLIT_API(assetId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ versionId, mode: "auto" }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success || !data?.jobId) {
          throw new Error(typeof data?.error === "string" ? data.error : "Разделение не выполнено.");
        }
        const settled = await waitForPipelineJob(String(data.jobId));
        const result = (settled?.result || data?.result || {}) as {
          noChanges?: boolean;
          newVersionId?: string;
          partSetId?: string;
        };
        if (result?.noChanges) {
          showSuccess("Split: изменений не найдено.");
        } else {
          showSuccess(`Split готов: partSet ${result?.partSetId || "created"}.`);
        }
        const snapshot = await fetchPublishedAssets(true);
        if (result?.newVersionId && snapshot?.byId?.[result.newVersionId]) {
          activatePublishedAsset(snapshot.byId[result.newVersionId], {
            jobId: activeHistoryJob?.id || snapshot.byId[result.newVersionId].jobId || null,
          });
        } else if (snapshot?.byId?.[assetId]) {
          activatePublishedAsset(snapshot.byId[assetId], {
            jobId: activeHistoryJob?.id || snapshot.byId[assetId].jobId || null,
          });
        }
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("ai-assets-updated"));
        }
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Разделение не выполнено.");
      } finally {
        setAssetAction((prev) => (prev?.assetId === assetId ? null : prev));
      }
    },
    [
      activatePublishedAsset,
      activeHistoryJob?.id,
      assetAction,
      fetchPublishedAssets,
      pushUiError,
      showError,
      showSuccess,
      waitForPipelineJob,
    ]
  );

  const handlePrintabilityCheck = useCallback(
    async (asset: AiAssetRecord | null) => {
      if (!asset) {
        showError("Сначала выберите модель в истории или ассетах.");
        return;
      }
      await handleAnalyzeActiveAsset(asset, true);
      setViewerIssuesOverlay(true);
    },
    [handleAnalyzeActiveAsset, showError]
  );

  const handleTextureActiveAsset = useCallback(
    async (
      asset: AiAssetRecord | null,
      mode: "image" | "flat" = "image",
      sourceImageUrl?: string | null,
      flatColor?: string | null
    ) => {
      if (!asset) {
        showError("Сначала выберите модель в истории или ассетах.");
        return;
      }
      if (assetAction) return;
      const assetId = asset.id;
      const versionId = asset.id;
      setAssetAction({ assetId, type: "texture" });
      try {
        const response = await fetch(ASSET_TEXTURE_API(assetId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            versionId,
            mode,
            params:
              mode === "flat"
                ? { color: normalizeHexColorClient(flatColor || "#aab0ba", "#aab0ba") }
                : {
                    sourceImageUrl: normalizeTextureSourceUrl(sourceImageUrl || ""),
                  },
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success || !data?.jobId) {
          throw new Error(typeof data?.error === "string" ? data.error : "Текстуры не применены.");
        }
        const settled = await waitForPipelineJob(String(data.jobId));
        const result = (settled?.result || data?.result || {}) as {
          noChanges?: boolean;
          newVersionId?: string;
          tintHex?: string;
        };
        if (result?.noChanges) {
          showSuccess("Текстуры: изменений не найдено.");
        } else {
          showSuccess(`Текстуры: готово (${mode === "image" ? "из изображения" : "однотонный материал"}). Авто-UV включен.`);
        }
        const snapshot = await fetchPublishedAssets(true);
        if (result?.newVersionId && snapshot?.byId?.[result.newVersionId]) {
          activatePublishedAsset(snapshot.byId[result.newVersionId], {
            jobId: activeHistoryJob?.id || snapshot.byId[result.newVersionId].jobId || null,
          });
          setAppearancePreset("original");
          setViewportRenderMode("final");
        } else if (snapshot?.byId?.[assetId]) {
          activatePublishedAsset(snapshot.byId[assetId], {
            jobId: activeHistoryJob?.id || snapshot.byId[assetId].jobId || null,
          });
        }
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("ai-assets-updated"));
        }
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Текстуры не применены.");
      } finally {
        setAssetAction((prev) => (prev?.assetId === assetId ? null : prev));
      }
    },
    [
      activatePublishedAsset,
      activeHistoryJob?.id,
      assetAction,
      fetchPublishedAssets,
      pushUiError,
      showError,
      showSuccess,
      waitForPipelineJob,
    ]
  );

  const resolveTextureImageSource = useCallback(() => {
    for (const ref of validInputReferences) {
      const candidate = normalizeTextureSourceUrl(ref.previewUrl || ref.url);
      if (candidate) return candidate;
    }
    const historyRefs = Array.isArray(activeHistoryJob?.inputRefs) ? activeHistoryJob.inputRefs : [];
    for (const ref of historyRefs) {
      const candidate = normalizeTextureSourceUrl(ref?.url);
      if (candidate) return candidate;
    }
    const assetCandidate = normalizeTextureSourceUrl(activeAssetVersion?.sourceUrl || "");
    if (assetCandidate) return assetCandidate;
    const previewCandidate = normalizeTextureSourceUrl(activeAssetVersion?.previewUrl || "");
    if (previewCandidate) return previewCandidate;
    return normalizeTextureSourceUrl(uploadPreview || "");
  }, [activeAssetVersion?.previewUrl, activeAssetVersion?.sourceUrl, activeHistoryJob?.inputRefs, uploadPreview, validInputReferences]);

  const handleTextureFromImage = useCallback(() => {
    const sourceImage = resolveTextureImageSource();
    if (!sourceImage) {
      showSuccess("Источник не найден: применяем fallback профиль текстуры.");
    }
    void handleTextureActiveAsset(activeAssetVersion, "image", sourceImage);
  }, [activeAssetVersion, handleTextureActiveAsset, resolveTextureImageSource, showSuccess]);

  const handleTextureFallbackMaterial = useCallback(() => {
    void handleTextureActiveAsset(activeAssetVersion, "flat", undefined, appearanceFlatColor);
  }, [activeAssetVersion, appearanceFlatColor, handleTextureActiveAsset]);

  const handleRemeshPreset = useCallback(
    async (preset: "web" | "game" | "print") => {
      if (!activeAssetVersion) {
        showError("Сначала выберите модель в истории или ассетах.");
        return;
      }
      if (preset === "web") {
        showSuccess("Remesh preset Web: запускаем консервативный cleanup.");
        await handleQuickFixActiveAsset(activeAssetVersion, "safe");
        return;
      }
      if (preset === "game") {
        showSuccess("Remesh preset Game: запускаем strong cleanup.");
        await handleQuickFixActiveAsset(activeAssetVersion, "strong");
        return;
      }
      showSuccess("Remesh preset Print: запускаем strong cleanup.");
      await handleQuickFixActiveAsset(activeAssetVersion, "strong");
    },
    [activeAssetVersion, handleQuickFixActiveAsset, showError, showSuccess]
  );

  const isAssetPipelineBusy = Boolean(assetAction);
  const activeDiagnosticsStatus = activeAssetVersion?.checks?.diagnostics?.status || "unknown";
  const activeDiagnosticsRiskScoreRaw = Number(activeAssetVersion?.checks?.diagnostics?.riskScore);
  const activePrintabilityScore = Number.isFinite(activeDiagnosticsRiskScoreRaw)
    ? Math.max(0, Math.min(100, Math.round(100 - activeDiagnosticsRiskScoreRaw)))
    : null;
  const activeIssuesList = useMemo(() => {
    const issues = activeAssetVersion?.checks?.diagnostics?.issues || activeAssetVersion?.checks?.topology?.issues || [];
    if (!Array.isArray(issues)) return [];
    return issues
      .map((item) => (typeof item?.message === "string" ? item.message.trim() : ""))
      .filter(Boolean)
      .slice(0, 6);
  }, [activeAssetVersion?.checks?.diagnostics?.issues, activeAssetVersion?.checks?.topology?.issues]);
  const activePrintabilityTone =
    activePrintabilityScore === null
      ? "text-white/65"
      : activePrintabilityScore >= 85
        ? "text-emerald-200"
        : activePrintabilityScore >= 65
          ? "text-amber-200"
          : "text-rose-200";
  const activeDiagnosticsBadgeClass =
    activeDiagnosticsStatus === "ok"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
      : activeDiagnosticsStatus === "warning"
        ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
        : activeDiagnosticsStatus === "critical"
          ? "border-rose-400/40 bg-rose-500/10 text-rose-200"
          : "border-white/20 bg-white/5 text-white/60";

  const queueJobs = useMemo<QueueJobItem[]>(() => {
    const items: QueueJobItem[] = [];

    for (const job of jobHistory) {
      const status: QueueJobItem["status"] =
        job.status === "queued"
          ? "queued"
          : job.status === "processing"
            ? "running"
            : job.status === "completed"
              ? "done"
              : "error";
      const outputVersionId = publishedAssetsByJobId[job.id] || null;
      items.push({
        id: `gen:${job.id}`,
        queueJobId: job.id,
        type: job.parentJobId ? "Повтор" : "Генерация",
        label: job.prompt || `Job ${job.id}`,
        status,
        progress: Math.max(0, Math.min(100, job.progress || 0)),
        etaSeconds: job.etaSeconds ?? null,
        message: job.errorMessage || job.stage || "",
        source: "generation",
        historyJobId: job.id,
        versionId: outputVersionId,
      });
    }

    for (const asset of Object.values(publishedAssetsById)) {
      const pipelineJobs = Array.isArray(asset.pipelineJobs) ? asset.pipelineJobs : [];
      for (const pipeline of pipelineJobs) {
        const rawStatus = String(pipeline.status || "").toLowerCase();
        const status: QueueJobItem["status"] =
          rawStatus === "queued"
            ? "queued"
            : rawStatus === "running" || rawStatus === "processing"
              ? "running"
              : rawStatus === "done" || rawStatus === "completed"
                ? "done"
                : rawStatus === "canceled"
                  ? "canceled"
                  : "error";
        const rawType = String(pipeline.type || "").toLowerCase();
        const typeLabel =
          rawType === "analyze"
            ? "Анализ"
            : rawType === "mesh_fix" || rawType === "fix"
              ? "Быстрый фикс"
              : rawType === "texture"
                ? "Текстуры"
              : rawType === "split"
                ? "Разделить"
                : rawType === "dcc_blender"
                  ? "Blender"
                  : rawType === "export"
                    ? "Экспорт"
                    : "Задача";
        items.push({
          id: `pipe:${String(pipeline.id || `${asset.id}:${rawType}`)}`,
          queueJobId: String(pipeline.id || ""),
          type: typeLabel,
          label: asset.title || `Asset ${asset.id}`,
          status,
          progress: Math.max(0, Math.min(100, Number(pipeline.progress) || 0)),
          message: typeof pipeline.message === "string" ? pipeline.message : "",
          source: "pipeline",
          versionId: asset.id,
        });
      }
    }

    return items.sort((a, b) => {
      const aRank = a.status === "running" ? 0 : a.status === "queued" ? 1 : a.status === "error" ? 2 : 3;
      const bRank = b.status === "running" ? 0 : b.status === "queued" ? 1 : b.status === "error" ? 2 : 3;
      if (aRank !== bRank) return aRank - bRank;
      return a.label.localeCompare(b.label);
    });
  }, [jobHistory, publishedAssetsById, publishedAssetsByJobId]);

  const queueSummary = useMemo(() => {
    const running = queueJobs.filter((job) => job.status === "running").length;
    const queued = queueJobs.filter((job) => job.status === "queued").length;
    const errors = queueJobs.filter((job) => job.status === "error").length;
    return { running, queued, errors };
  }, [queueJobs]);

  const filteredQueueByState = useMemo(() => {
    if (queueFilter === "all") return queueJobs;
    if (queueFilter === "running") return queueJobs.filter((job) => job.status === "running");
    if (queueFilter === "queued") return queueJobs.filter((job) => job.status === "queued");
    if (queueFilter === "done") return queueJobs.filter((job) => job.status === "done");
    return queueJobs.filter((job) => job.status === "error" || job.status === "canceled");
  }, [queueFilter, queueJobs]);

  const filteredQueueByQuery = useMemo(() => {
    const q = rightPanelQuery.trim().toLowerCase();
    if (!q) return filteredQueueByState;
    return filteredQueueByState.filter((job) => {
      return (
        job.type.toLowerCase().includes(q) ||
        job.label.toLowerCase().includes(q) ||
        job.id.toLowerCase().includes(q) ||
        String(job.message || "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [filteredQueueByState, rightPanelQuery]);

  const hasLiveQueueJobs = useMemo(
    () => queueJobs.some((job) => job.status === "queued" || job.status === "running"),
    [queueJobs]
  );

  const filteredJobHistory = useMemo(() => {
    if (jobHistoryFilter === "all") return jobHistory;
    return jobHistory.filter((job) => job.status === jobHistoryFilter);
  }, [jobHistory, jobHistoryFilter]);
  const filteredHistoryByQuery = useMemo(() => {
    const q = rightPanelQuery.trim().toLowerCase();
    if (!q) return filteredJobHistory;
    return filteredJobHistory.filter((job) => {
      const prompt = (job.prompt || "").toLowerCase();
      const id = job.id.toLowerCase();
      const stage = (job.stage || "").toLowerCase();
      return prompt.includes(q) || id.includes(q) || stage.includes(q);
    });
  }, [filteredJobHistory, rightPanelQuery]);
  const filteredGalleryByQuery = useMemo(() => {
    const q = rightPanelQuery.trim().toLowerCase();
    if (!q) return gallery;
    return gallery.filter((asset) => {
      return (
        asset.name.toLowerCase().includes(q) ||
        asset.format.toLowerCase().includes(q)
      );
    });
  }, [gallery, rightPanelQuery]);

  const renderJobStatusTone = (status?: AiGenerationJob["status"]) => {
    if (status === "completed") return "text-emerald-300";
    if (status === "failed") return "text-rose-300";
    if (status === "processing") return "text-cyan-300";
    return "text-white/60";
  };

  const displayProgress = Math.max(0, Math.min(100, serverJob?.progress ?? 0));
  const estimatedTokenCost = resolveGenerationTokenCost(tokenCost, {
    quality: qualityPreset,
    style: stylePreset,
    advanced: advancedPreset,
  });
  const canUseProQuality = subscriptionLoading
    ? true
    : Boolean(subscription?.isActive && subscription?.proAccess);
  const isMockTopupLoading = billingUIState.mockTopup.status === "loading";
  const isMockTopupEnabled = mockBillingEnabled;
  const isRealBillingDisabled = !billingUIState.realBilling.enabled;
  const baseEtaMinutes = Math.max(1, Math.round((serverJob?.etaSeconds ?? 180) / 60));
  const estimatedEtaMinutes = resolveGenerationEtaMinutes(baseEtaMinutes, {
    quality: qualityPreset,
    style: stylePreset,
    advanced: advancedPreset,
  });
  const resultJob = latestCompletedJob ?? (serverJob?.status === "completed" ? serverJob : null);
  const isResultPublished = Boolean(resultJob?.id && publishedAssetsByJobId[resultJob.id]);
  const handlePrintResult = useCallback(() => {
    const modelUrl = resultAsset?.modelUrl || resultJob?.result?.modelUrl || "";
    if (!modelUrl) {
      showError("Не найден URL модели.");
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
  const activeTextureProfile = useMemo(() => {
    const textureChecks = activeAssetVersion?.checks?.texture;
    if (!textureChecks || typeof textureChecks !== "object") return null;

    const tintRaw = String(textureChecks?.tintHex || "")
      .trim()
      .toLowerCase();
    const tintHex = /^#[0-9a-f]{6}$/.test(tintRaw) ? tintRaw : "#aab0ba";
    const roughnessRaw = Number(textureChecks?.roughness);
    const metalnessRaw = Number(textureChecks?.metalness);
    const roughness = Number.isFinite(roughnessRaw) ? Math.max(0, Math.min(1, roughnessRaw)) : 0.72;
    const metalness = Number.isFinite(metalnessRaw) ? Math.max(0, Math.min(1, metalnessRaw)) : 0.08;
    const baseColorMapUrl = normalizeTextureSourceUrl(
      textureChecks?.baseColorMapUrl || textureChecks?.sourceImageUrl || ""
    );

    return {
      mode: textureChecks?.mode === "flat" ? "flat" : "image",
      tintHex,
      roughness,
      metalness,
      baseColorMapUrl: baseColorMapUrl || null,
    };
  }, [activeAssetVersion?.checks?.texture]);
  const activeTextureTint = useMemo(() => {
    if (appearancePreset !== "original") {
      return APPEARANCE_PRESET_TINT[appearancePreset];
    }
    return activeTextureProfile?.tintHex || "#aab0ba";
  }, [activeTextureProfile?.tintHex, appearancePreset]);
  const activeMaterialOverride = useMemo<ModelMaterialOverride | null>(() => {
    const tuningRoughness = Math.max(0, Math.min(1, appearanceRoughness / 100));
    const tuningMetalness = Math.max(0, Math.min(1, appearanceMetalness / 100));
    if (appearancePreset !== "original") {
      const preset = APPEARANCE_PRESET_PBR[appearancePreset];
      return {
        baseColor: APPEARANCE_PRESET_TINT[appearancePreset],
        roughness: appearanceTuningOpen ? tuningRoughness : preset.roughness,
        metalness: appearanceTuningOpen ? tuningMetalness : preset.metalness,
      };
    }
    if (!activeTextureProfile) {
      if (!appearanceTuningOpen) return null;
      return {
        baseColor: normalizeHexColorClient(appearanceFlatColor, "#aab0ba"),
        roughness: tuningRoughness,
        metalness: tuningMetalness,
      };
    }
    return {
      baseColor: activeTextureProfile.tintHex,
      baseColorMapUrl:
        activeTextureProfile.mode === "image" ? activeTextureProfile.baseColorMapUrl : null,
      roughness: appearanceTuningOpen ? tuningRoughness : activeTextureProfile.roughness,
      metalness: appearanceTuningOpen ? tuningMetalness : activeTextureProfile.metalness,
    };
  }, [activeTextureProfile, appearanceFlatColor, appearanceMetalness, appearancePreset, appearanceRoughness, appearanceTuningOpen]);
  const effectiveViewportRenderMode = useMemo<"final" | "wireframe" | "base">(() => {
    if (viewportRenderMode === "wireframe") return "wireframe";
    if (appearancePreset !== "original") return "base";
    return viewportRenderMode;
  }, [appearancePreset, viewportRenderMode]);
  const noActiveModelTooltip = "Сначала сгенерируйте/выберите модель";
  const busyPipelineTooltip = "Сейчас выполняется обработка. Подождите завершения.";
  const noTextureSourceTooltip = "Нужно исходное изображение (референс или source image).";
  const activeModelStatus = useMemo<"READY" | "RUNNING" | "ERROR">(() => {
    if (activeAssetVersion && assetAction?.assetId === activeAssetVersion.id) return "RUNNING";
    if (serverJobError) return "ERROR";
    return "READY";
  }, [activeAssetVersion, assetAction?.assetId, serverJobError]);
  const activeModelStatusClass =
    activeModelStatus === "RUNNING"
      ? "border-amber-400/55 bg-amber-500/10 text-amber-100"
      : activeModelStatus === "ERROR"
        ? "border-rose-400/55 bg-rose-500/10 text-rose-200"
        : "border-emerald-400/55 bg-emerald-500/10 text-emerald-100";
  const [modelScale, setModelScale] = useState(1);

  useEffect(() => {
    if (qualityPreset === "pro" && !canUseProQuality) {
      setQualityPreset("standard");
    }
  }, [canUseProQuality, qualityPreset]);

  useEffect(() => {
    setModelScale(1);
    setViewportIssueMarkers([]);
    setViewportStats(null);
    setViewportBounds(null);
    setCreateRefsOpen(false);
    setAppearanceTuningOpen(false);
    setAppearancePreset(activeAssetVersion?.versionLabel === "textured_v1" ? "original" : "clay");
  }, [activeAssetVersion?.versionLabel, activePreviewModel]);

  useEffect(() => {
    if (!activeTextureProfile) return;
    setAppearanceFlatColor(activeTextureProfile.tintHex);
    setAppearanceRoughness(Math.round(activeTextureProfile.roughness * 100));
    setAppearanceMetalness(Math.round(activeTextureProfile.metalness * 100));
  }, [activeTextureProfile]);

  const handleBounds = useCallback((bounds: { size: number; boxSize: [number, number, number]; radius: number }) => {
    if (!bounds?.size || !Number.isFinite(bounds.size)) return;
    setViewportBounds(bounds);
    const nextScale = Math.min(1.25, Math.max(0.6, MODEL_STAGE_TARGET_SIZE / bounds.size));
    setModelScale(nextScale);
  }, []);
  const handleViewportStats = useCallback((stats: { polyCount: number; meshCount: number }) => {
    setViewportStats(stats);
  }, []);
  const handleViewportIssueMarkers = useCallback((markers: ModelIssueMarker[]) => {
    setViewportIssueMarkers(Array.isArray(markers) ? markers : []);
  }, []);
  const isDesktopPanelHidden = focusMode || panelCollapsed;
  const viewportCameraPosition = useMemo<[number, number, number]>(() => {
    if (viewportViewPreset === "front") return [0, 1.35, 4.8];
    if (viewportViewPreset === "back") return [0, 1.35, -4.8];
    if (viewportViewPreset === "left") return [-4.8, 1.35, 0];
    if (viewportViewPreset === "right") return [4.8, 1.35, 0];
    if (viewportViewPreset === "top") return [0, 5.2, 0.01];
    if (viewportViewPreset === "bottom") return [0, -3.6, 0.01];
    return [3.6, 2.6, 4.6];
  }, [viewportViewPreset]);
  const viewportCameraFov = viewportViewPreset === "top" || viewportViewPreset === "bottom" ? 30 : 40;
  const viewportPresetLabel = useMemo(() => {
    if (viewportViewPreset === "front") return "спереди";
    if (viewportViewPreset === "back") return "сзади";
    if (viewportViewPreset === "left") return "слева";
    if (viewportViewPreset === "right") return "справа";
    if (viewportViewPreset === "top") return "сверху";
    if (viewportViewPreset === "bottom") return "снизу";
    return "свободный";
  }, [viewportViewPreset]);
  const viewportMouseButtons = useMemo(() => {
    if (viewportControlMode === "pan") {
      return {
        LEFT: MOUSE.PAN,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.ROTATE,
      };
    }
    if (viewportControlMode === "zoom") {
      return {
        LEFT: MOUSE.DOLLY,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.PAN,
      };
    }
    return {
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    };
  }, [viewportControlMode]);
  const handleViewportCapture = useCallback(() => {
    if (typeof document === "undefined") return;
    const canvas = document.querySelector<HTMLCanvasElement>("#ai-lab-viewport canvas");
    if (!canvas) {
      showError("Viewport не готов к capture.");
      return;
    }
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) {
      showError("Не удалось подготовить скриншот.");
      return;
    }
    // Keep screenshot readable even if viewport is in transparent mode.
    if (viewportBackgroundMode === "transparent") {
      ctx.fillStyle = "#050a0f";
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    }
    ctx.drawImage(canvas, 0, 0);
    const href = exportCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = href;
    link.download = `ai-lab-screenshot-${Date.now()}.png`;
    link.click();
    showSuccess("Скриншот сохранен.");
  }, [showError, showSuccess, viewportBackgroundMode]);
  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // ignore
    }
    router.push("/store");
  }, [router]);
  const handleCancelSynthesis = useCallback(() => {
    if (!isSynthRunning) return;
    setServerJob((prev) =>
      prev
        ? {
            ...prev,
            status: "failed",
            stage: "USER_CANCELLED",
            errorMessage: "Generation cancelled by user.",
            updatedAt: new Date().toISOString(),
          }
        : prev
    );
    setServerJobError("Generation cancelled by user.");
    showSuccess("Генерация остановлена в интерфейсе.");
  }, [isSynthRunning, showSuccess]);
  const handleStopMonitoring = useCallback(() => {
    setServerJob(null);
    setServerJobError(null);
    showSuccess("Мониторинг задачи остановлен.");
  }, [showSuccess]);

  const handleOpenQueueJob = useCallback(
    (item: QueueJobItem) => {
      if (item.source === "generation" && item.historyJobId) {
        const sourceJob = jobHistory.find((job) => job.id === item.historyJobId) || null;
        if (sourceJob) {
          handlePickHistoryJob(sourceJob);
          setLabPanelTab("history");
          return;
        }
      }
      if (item.versionId && publishedAssetsById[item.versionId]) {
        const asset = publishedAssetsById[item.versionId];
        activatePublishedAsset(asset, { jobId: asset.jobId || null });
        setLabPanelTab("history");
      }
    },
    [activatePublishedAsset, handlePickHistoryJob, jobHistory, publishedAssetsById]
  );

  const handleShowQueueJobLogs = useCallback(
    (item: QueueJobItem) => {
      const statusLabel =
        item.status === "running"
          ? "в работе"
          : item.status === "queued"
            ? "в очереди"
            : item.status === "done"
              ? "готово"
              : item.status === "canceled"
                ? "отменено"
                : "ошибка";
      const message = item.message?.trim() || "Логи недоступны. Откройте серверную консоль.";
      showSuccess(`[${item.type}] ${statusLabel}: ${message}`);
    },
    [showSuccess]
  );

  const handleCancelQueueJob = useCallback(
    async (item: QueueJobItem) => {
      const jobId = String(item.queueJobId || "").trim();
      if (!jobId) return;
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
          method: "POST",
          credentials: "include",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          throw new Error(typeof data?.error === "string" ? data.error : "Failed to cancel job.");
        }
        showSuccess("Задача отменена.");
        await Promise.all([fetchJobHistory(true), fetchPublishedAssets(true)]);
      } catch (error) {
        pushUiError(error instanceof Error ? error.message : "Failed to cancel job.");
      }
    },
    [fetchJobHistory, fetchPublishedAssets, pushUiError, showSuccess]
  );

  const handleRetryQueueJob = useCallback(
    async (item: QueueJobItem) => {
      if (item.source === "generation" && item.historyJobId) {
        const sourceJob = jobHistory.find((job) => job.id === item.historyJobId) || null;
        if (sourceJob) {
          await handleRetryHistoryJob(sourceJob);
          return;
        }
      }
      if (!item.versionId || !publishedAssetsById[item.versionId]) return;
      const asset = publishedAssetsById[item.versionId];
      const rawType = item.type.toLowerCase();
      if (rawType.includes("анализ")) {
        await handleAnalyzeActiveAsset(asset, true);
        return;
      }
      if (rawType.includes("фикс")) {
        await handleQuickFixActiveAsset(asset, "safe");
        return;
      }
      if (rawType.includes("раздел")) {
        await handleSplitActiveAsset(asset);
        return;
      }
      if (rawType.includes("текстур")) {
        await handleTextureActiveAsset(asset, "image");
        return;
      }
      if (rawType.includes("blender")) {
        await queueBlenderJobForAsset(asset);
      }
    },
    [
      handleAnalyzeActiveAsset,
      handleQuickFixActiveAsset,
      handleRetryHistoryJob,
      handleSplitActiveAsset,
      handleTextureActiveAsset,
      jobHistory,
      publishedAssetsById,
      queueBlenderJobForAsset,
    ]
  );

  useEffect(() => {
    if (labPanelTab !== "queue" && !hasLiveQueueJobs) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      await Promise.all([fetchJobHistory(true), fetchPublishedAssets(true)]);
      if (cancelled) return;
      const interval = hasLiveQueueJobs ? 1800 : 12000;
      timer = window.setTimeout(() => {
        void tick();
      }, interval);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [fetchJobHistory, fetchPublishedAssets, hasLiveQueueJobs, labPanelTab]);

  useEffect(() => {
    const onGlobalClick = () => {
      setTokensPopoverOpen(false);
      setQuickSettingsOpen(false);
      setToolsMenuOpen(false);
      setUserMenuOpen(false);
    };
    window.addEventListener("click", onGlobalClick);
    return () => window.removeEventListener("click", onGlobalClick);
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#030304] text-white">
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center page-bg-fade"
        style={{
          backgroundImage: `url(${AI_LAB_BG})`,
          backgroundPosition: "center 70%",
          filter:
            effectiveThemeMode === "light" ? "brightness(0.92) saturate(0.82)" : "brightness(0.75)",
        }}
      />
      <div
        className={`pointer-events-none fixed inset-0 z-10 ${
          effectiveThemeMode === "light" ? "bg-black/20" : "bg-black/35"
        }`}
      />
      <div
        className={`pointer-events-none fixed inset-0 z-20 cad-grid-pattern ${
          effectiveThemeMode === "light" ? "opacity-[0.14]" : "opacity-[0.22]"
        }`}
      />
      <div
        className={`pointer-events-none fixed inset-0 z-20 ${
          effectiveThemeMode === "light"
            ? "bg-[radial-gradient(circle_at_top,_rgba(180,220,255,0.1),_transparent_55%),radial-gradient(circle_at_20%_20%,_rgba(203,213,225,0.1),_transparent_45%)]"
            : "bg-[radial-gradient(circle_at_top,_rgba(46,209,255,0.08),_transparent_50%),radial-gradient(circle_at_20%_20%,_rgba(148,163,184,0.07),_transparent_45%)]"
        }`}
      />

      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#04080d]/85 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-[1760px] px-4 sm:px-6">
          <div className="flex h-14 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-4 lg:gap-6">
              <a href="/store" className="shrink-0 text-lg font-bold tracking-[0.2em] text-white">
                3D-STORE
              </a>
              <nav className="hidden items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/70 lg:flex">
                <button
                  type="button"
                  onClick={() => {
                    setTokensPopoverOpen(false);
                    setQuickSettingsOpen(false);
                    setToolsMenuOpen(false);
                    setUserMenuOpen(false);
                    showSuccess("Командные workspace будут добавлены позже. Сейчас доступен личный проект.");
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 transition hover:border-white/35 hover:text-white"
                  title="Workspaces в разработке"
                >
                  <span>{currentProjectName}</span>
                  <span className="rounded-full border border-white/20 px-2 py-0.5 text-[8px] tracking-[0.22em] text-white/55">
                    WORKSPACE СКОРО
                  </span>
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setToolsMenuOpen((prev) => !prev);
                      setTokensPopoverOpen(false);
                      setQuickSettingsOpen(false);
                      setUserMenuOpen(false);
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 transition hover:border-white/35 hover:text-white"
                    title="Быстрые инструменты AI Lab"
                  >
                    Инструменты
                    <ChevronDown className={`h-3.5 w-3.5 transition ${toolsMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  {toolsMenuOpen && (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      className="absolute left-0 top-10 z-50 w-[280px] space-y-2 rounded-xl border border-white/15 bg-[#060a10]/95 p-3 shadow-[0_16px_32px_rgba(0,0,0,0.45)]"
                    >
                      <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/50">
                        Группы инструментов
                      </p>
                      <div className="grid grid-cols-2 gap-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em]">
                        {([
                          ["create", "Создать (G/1)"],
                          ["check", "Проверить (C/2)"],
                          ["repair", "Исправить (R/3)"],
                          ["appearance", "Материалы (M/4)"],
                          ["export", "Экспорт (E/5)"],
                        ] as Array<[RightPanelMainBlock, string]>).map(([block, label]) => (
                          <button
                            key={block}
                            type="button"
                            onClick={() => {
                              setRightPanelMainBlock(block);
                              setToolsMenuOpen(false);
                            }}
                            className={`rounded-lg border px-2 py-1 text-left transition ${
                              rightPanelMainBlock === block
                                ? "border-cyan-300/60 bg-cyan-500/12 text-cyan-100"
                                : "border-white/10 bg-white/[0.02] text-white/65 hover:border-white/30 hover:text-white"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="h-px bg-white/10" />
                      <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/50">
                        Полка справа
                      </p>
                      <div className="grid grid-cols-3 gap-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em]">
                        {([
                          ["assets", "Ассеты"],
                          ["history", "История"],
                          ["queue", "Очередь"],
                        ] as Array<[LabPanelTab, string]>).map(([tab, label]) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => {
                              setLabPanelTab(tab);
                              setToolsMenuOpen(false);
                            }}
                            className={`rounded-lg border px-2 py-1 text-left transition ${
                              labPanelTab === tab
                                ? "border-cyan-300/60 bg-cyan-500/12 text-cyan-100"
                                : "border-white/10 bg-white/[0.02] text-white/65 hover:border-white/30 hover:text-white"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="h-px bg-white/10" />
                      <div className="flex gap-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em]">
                        <button
                          type="button"
                          onClick={() => {
                            if (focusMode) setFocusMode(false);
                            setPanelCollapsed((prev) => !prev);
                            setToolsMenuOpen(false);
                          }}
                          className="flex-1 rounded-lg border border-white/15 bg-white/[0.02] px-2 py-1 text-white/70 transition hover:border-white/35 hover:text-white"
                        >
                          {isDesktopPanelHidden ? "Показать панели" : "Скрыть панели"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFocusMode((prev) => !prev);
                            setToolsMenuOpen(false);
                          }}
                          className="flex-1 rounded-lg border border-white/15 bg-white/[0.02] px-2 py-1 text-white/70 transition hover:border-white/35 hover:text-white"
                        >
                          {focusMode ? "Фокус OFF" : "Фокус ON"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </nav>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setTokensPopoverOpen((prev) => !prev);
                    setQuickSettingsOpen(false);
                    setToolsMenuOpen(false);
                    setUserMenuOpen(false);
                  }}
                  className="group inline-flex items-center gap-1.5 rounded-full border border-[#2ED1FF]/45 bg-[linear-gradient(180deg,rgba(11,16,20,0.95),rgba(8,13,18,0.95))] px-3 py-1.5 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-[#D8F6FF] shadow-[0_0_16px_rgba(46,209,255,0.24)] transition hover:border-[#7FE7FF]/80 hover:shadow-[0_0_20px_rgba(46,209,255,0.34)]"
                >
                  <Coins className="h-4 w-4 text-[#8FE7FF] transition duration-200 group-hover:scale-110 group-hover:text-[#BFF4FF]" />
                  <span>ТОКЕНЫ: {tokensLoading ? "..." : tokens}</span>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setTopupOpen(true);
                    setBillingUIState((prev) => ({
                      ...prev,
                      mockTopup: {
                        status: "idle",
                      },
                    }));
                    setTokensPopoverOpen(false);
                    setQuickSettingsOpen(false);
                    setToolsMenuOpen(false);
                    setUserMenuOpen(false);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#2ED1FF]/45 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_14px_rgba(46,209,255,0.22)] transition hover:border-[#7FE7FF]/70 hover:text-white hover:shadow-[0_0_18px_rgba(46,209,255,0.3)]"
                  aria-label="Пополнить токены"
                  title="Пополнить токены"
                >
                  +
                </button>
                {tokensPopoverOpen && (
                  <div
                    onClick={(event) => event.stopPropagation()}
                    className="absolute right-0 top-10 z-50 w-[300px] space-y-2 rounded-xl border border-white/15 bg-[#060a10]/95 p-3 shadow-[0_16px_32px_rgba(0,0,0,0.45)]"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/70">
                        Баланс токенов
                      </p>
                      <p className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-100">
                        <Coins className="h-3.5 w-3.5" />
                        <span>{tokensLoading ? "..." : tokens}</span>
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                      <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/55">
                         Последние события
                      </p>
                      <div className="mt-1 space-y-1">
                        {tokenEvents.slice(0, 5).map((event) => (
                          <div key={event.id} className="flex items-center justify-between text-[9px] text-white/65">
                            <span className="truncate">{tokenReasonLabel[event.reason] || event.reason}</span>
                            <span>{event.delta >= 0 ? "+" : ""}{Math.trunc(event.delta)}</span>
                          </div>
                        ))}
                        {tokenEvents.length === 0 && (
                           <p className="text-[9px] text-white/40">Событий пока нет.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setQuickSettingsOpen((prev) => !prev);
                    setTokensPopoverOpen(false);
                    setToolsMenuOpen(false);
                    setUserMenuOpen(false);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/70 transition hover:border-white/35 hover:text-white"
                  aria-label="Настройки"
                >
                  <Settings2 className="h-4 w-4" />
                </button>
                {quickSettingsOpen && (
                  <div
                    onClick={(event) => event.stopPropagation()}
                    className="absolute right-0 top-10 z-50 w-[280px] space-y-3 rounded-xl border border-white/15 bg-[#060a10]/95 p-3 shadow-[0_16px_32px_rgba(0,0,0,0.45)]"
                  >
                    <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/60">
                      Быстрые настройки
                    </p>
                    <div className="space-y-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/70">
                      <div className="flex items-center justify-between">
                        <span>Тема</span>
                        <div className="flex gap-1">
                          {(["dark", "auto"] as const).map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setUiThemeMode(value)}
                              className={`rounded-md border px-2 py-1 ${
                                uiThemeMode === value
                                  ? "border-cyan-300/60 bg-cyan-500/10 text-cyan-100"
                                  : "border-white/15 text-white/60 hover:border-white/30"
                              }`}
                            >
                              {value === "dark" ? "темная" : "авто"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Вьювер</span>
                        <div className="flex gap-1">
                          {(["performance", "quality"] as const).map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setViewerQuality(value)}
                              className={`rounded-md border px-2 py-1 ${
                                viewerQuality === value
                                  ? "border-cyan-300/60 bg-cyan-500/10 text-cyan-100"
                                  : "border-white/15 text-white/60 hover:border-white/30"
                              }`}
                            >
                              {value === "performance" ? "скорость" : "качество"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Язык (скоро)</span>
                        <div className="flex gap-1">
                          {(["ru", "en"] as const).map((value) => (
                            <button
                              key={value}
                              type="button"
                              disabled
                              title="Скоро"
                              className={`rounded-md border px-2 py-1 ${
                                uiLanguage === value
                                  ? "border-cyan-300/60 bg-cyan-500/10 text-cyan-100"
                                  : "border-white/15 text-white/60"
                              }`}
                            >
                              {value.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          showSuccess("Горячие клавиши: G/1 создать, C/2 проверить, R/3 исправить, M/4 материалы, E/5 экспорт.")
                        }
                        className="w-full rounded-md border border-white/15 bg-white/[0.02] px-2 py-1 text-left text-white/70 transition hover:border-white/30"
                      >
                        Список хоткеев
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setUserMenuOpen((prev) => !prev);
                    setTokensPopoverOpen(false);
                    setQuickSettingsOpen(false);
                    setToolsMenuOpen(false);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/70 transition hover:border-white/35 hover:text-white"
                  aria-label="Профиль"
                >
                  <UserRound className="h-4 w-4" />
                </button>
                {userMenuOpen && (
                  <div
                    onClick={(event) => event.stopPropagation()}
                    className="absolute right-0 top-10 z-50 w-[220px] space-y-1 rounded-xl border border-white/15 bg-[#060a10]/95 p-2 shadow-[0_16px_32px_rgba(0,0,0,0.45)]"
                  >
                    <button
                      type="button"
                      onClick={() => router.push("/profile")}
                      className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5 text-left text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/75 transition hover:border-white/30 hover:text-white"
                    >
                      <UserCog className="h-3.5 w-3.5" />
                      Профиль
                    </button>
                    <button
                      type="button"
                      disabled
                      title="Скоро"
                      className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5 text-left text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/40"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      API ключи
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="flex w-full items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1.5 text-left text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-rose-200 transition hover:border-rose-300"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Выйти
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className={`relative z-30 mx-auto flex w-full max-w-[1760px] flex-col gap-6 px-4 pb-20 pt-[110px] sm:px-6 lg:grid ${
          isDesktopPanelHidden ? "lg:grid-cols-1" : "lg:grid-cols-[360px_minmax(0,1fr)_380px]"
        }`}
      >
        <aside
          className={`relative flex h-fit flex-col gap-4 rounded-[28px] border border-white/10 bg-white/[0.03] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl lg:sticky lg:top-32 ${
            isDesktopPanelHidden ? "lg:hidden" : "lg:flex"
          }`}
        >
          <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-3">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-black/35 p-2">
              {([
                ["create", FlaskConical, "Создать"],
                ["check", Box, "Проверить"],
                ["repair", Scissors, "Исправить"],
                ["appearance", Wand2, "Материалы"],
                ["export", Rocket, "Экспорт"],
              ] as Array<[RightPanelMainBlock, typeof FlaskConical, string]>).map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (id === "create") {
                      handleStartNewGeneration();
                    }
                    setRightPanelMainBlock(id);
                  }}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                    rightPanelMainBlock === id
                      ? "border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                      : "border-white/15 bg-white/[0.03] text-white/70 hover:border-white/35 hover:text-white"
                  }`}
                  title={label}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/60">
                <span>
                  {rightPanelMainBlock === "create"
                    ? "Создать"
                    : rightPanelMainBlock === "check"
                      ? "Проверить"
                      : rightPanelMainBlock === "repair"
                        ? "Исправить"
                        : rightPanelMainBlock === "appearance"
                          ? "Материалы"
                          : "Экспорт"}
                </span>
                <span className="text-[9px] text-white/35">G/C/R/M/E</span>
              </div>

              {rightPanelMainBlock === "create" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/30 p-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em]">
                    <button
                      type="button"
                      onClick={() => setMode("image")}
                      className={`rounded-xl border px-3 py-2 transition ${
                        mode === "image"
                          ? "border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF]"
                          : "border-white/10 text-white/55 hover:border-white/30 hover:text-white"
                      }`}
                    >
                      Изображение в 3D
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("text")}
                      className={`rounded-xl border px-3 py-2 transition ${
                        mode === "text"
                          ? "border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF]"
                          : "border-white/10 text-white/55 hover:border-white/30 hover:text-white"
                      }`}
                    >
                      Текст в 3D
                    </button>
                  </div>
                  <div
                    className={`relative flex min-h-[170px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-4 text-center transition ${
                      dragActive
                        ? "border-[#2ED1FF]/70 bg-[#0b1014]/70 shadow-[0_0_24px_rgba(46,209,255,0.35)]"
                        : "border-white/20 bg-[radial-gradient(circle_at_center,rgba(46,209,255,0.06),transparent_60%)] hover:border-white/40"
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
                      <img src={uploadPreview} alt="Preview" className="h-full w-full rounded-xl border border-white/10 object-cover" />
                    ) : (
                      <>
                        <UploadCloud className="h-8 w-8 text-[#2ED1FF]" />
                        <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/50">
                          Перетащите изображение или кликните
                        </p>
                      </>
                    )}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <button
                      type="button"
                      onClick={() => setCreateRefsOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/55"
                    >
                      <span>Референсы {validInputReferences.length} / {MAX_INPUT_REFERENCES}</span>
                      <ChevronDown className={`h-4 w-4 transition ${createRefsOpen ? "rotate-180" : ""}`} />
                    </button>
                    {createRefsOpen && (
                      <div className="mt-2 space-y-2">
                        {validInputReferences.length === 0 ? (
                          <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/35">
                            Нет загруженных референсов
                          </p>
                        ) : (
                          validInputReferences.map((ref) => (
                            <div key={ref.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-2">
                              <div className="flex items-start gap-2">
                                {ref.previewUrl ? (
                                  <img
                                    src={ref.previewUrl}
                                    alt={ref.name}
                                    className="h-12 w-12 rounded-md border border-white/10 object-cover"
                                  />
                                ) : (
                                  <div className="flex h-12 w-12 items-center justify-center rounded-md border border-white/10 bg-black/30 text-[8px] text-white/40">
                                    IMG
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.14em] text-white/70">
                                    {ref.name}
                                  </p>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveReferenceBackground(ref.id)}
                                      disabled={Boolean(removingReferenceBgId || smartMaskingReferenceId)}
                                      className="rounded-full border border-cyan-400/40 px-2 py-0.5 text-[8px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.14em] text-cyan-100 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
                                    >
                                      RM BG
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleSmartMaskReference(ref.id)}
                                      disabled={Boolean(removingReferenceBgId || smartMaskingReferenceId)}
                                      className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[8px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.14em] text-amber-100 transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-45"
                                    >
                                      MASK+
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleOpenMaskEditor(ref.id)}
                                      disabled={Boolean(maskEditorLoading || maskApplying)}
                                      className="rounded-full border border-violet-400/40 px-2 py-0.5 text-[8px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.14em] text-violet-100 transition hover:border-violet-300 disabled:cursor-not-allowed disabled:opacity-45"
                                    >
                                      Ручная
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDownloadReference(ref)}
                                      className="rounded-full border border-white/20 px-2 py-0.5 text-[8px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.14em] text-white/75 transition hover:border-white/35 hover:text-white"
                                    >
                                      PNG
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveInputReference(ref.id)}
                                      className="rounded-full border border-rose-400/40 px-2 py-0.5 text-[8px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.14em] text-rose-200 transition hover:border-rose-300"
                                    >
                                      Удалить
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Опишите желаемый результат: форма, стиль, назначение."
                    className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80 placeholder:text-white/40 focus:border-[#2ED1FF]/60 focus:outline-none"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    {(["draft", "standard", "pro"] as const).map((value) => {
                      const proLocked = value === "pro" && !canUseProQuality;
                      return (
                        <button
                          key={value}
                          type="button"
                          disabled={proLocked}
                          title={proLocked ? "PRO доступен только с активной подпиской M/L" : undefined}
                          onClick={() => setQualityPreset(value)}
                          className={`rounded-lg border px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] ${
                            qualityPreset === value
                              ? "border-cyan-300/60 bg-cyan-500/12 text-cyan-100"
                              : "border-white/10 text-white/55 hover:border-white/30 hover:text-white"
                          } disabled:cursor-not-allowed disabled:opacity-45`}
                        >
                          {QUALITY_PRESET_LABEL[value]}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleStartServerSynthesis();
                    }}
                    disabled={serverJobLoading || isSynthRunning || tokensLoading}
                    className="group w-full rounded-2xl border border-emerald-400/60 bg-emerald-500/15 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-emerald-100 shadow-[0_0_0_rgba(16,185,129,0)] transition hover:border-emerald-300 hover:text-white hover:shadow-[0_0_20px_rgba(16,185,129,0.25)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {serverJobLoading ? (
                      "Генерация..."
                    ) : isSynthRunning ? (
                      `В работе ${Math.round(displayProgress)}%`
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span>Сгенерировать модель</span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-400/15 px-2 py-0.5 text-[10px]">
                          <Coins className="h-3.5 w-3.5 transition group-hover:scale-110" />
                          {estimatedTokenCost}
                        </span>
                      </span>
                    )}
                  </button>
                </div>
              )}

              {rightPanelMainBlock === "check" && (
                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/[0.08] px-3 py-2">
                    <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-emerald-100/80">Скор печати</p>
                    <p className={`mt-1 text-[11px] font-semibold ${activePrintabilityTone}`}>
                      {activePrintabilityScore === null ? "--" : `${activePrintabilityScore}/100`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAnalyzeActiveAsset(activeAssetVersion)}
                      disabled={!activeAssetVersion || isAssetPipelineBusy}
                      title={!activeAssetVersion ? noActiveModelTooltip : isAssetPipelineBusy ? busyPipelineTooltip : undefined}
                      className="rounded-lg border border-emerald-400/45 bg-emerald-500/10 px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-emerald-100 transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Анализ
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleShowAssetIssues(activeAssetVersion);
                        setViewerThicknessPreview(false);
                      }}
                      disabled={!activeAssetVersion}
                      title={!activeAssetVersion ? noActiveModelTooltip : undefined}
                      className="rounded-lg border border-white/25 bg-white/[0.02] px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/80 transition hover:border-white/45 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Показать проблемы
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/60">
                    <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-1">X: {viewportBounds ? viewportBounds.boxSize[0].toFixed(2) : "--"}</div>
                    <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-1">Y: {viewportBounds ? viewportBounds.boxSize[1].toFixed(2) : "--"}</div>
                    <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-1">Z: {viewportBounds ? viewportBounds.boxSize[2].toFixed(2) : "--"}</div>
                    <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-1">Масштаб: {modelScale.toFixed(2)}x</div>
                  </div>
                </div>
              )}

              {rightPanelMainBlock === "repair" && (
                <div className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3">
                  <button
                    type="button"
                    onClick={() => void handleQuickFixActiveAsset(activeAssetVersion, "safe")}
                    disabled={!activeAssetVersion || isAssetPipelineBusy}
                    title={!activeAssetVersion ? noActiveModelTooltip : isAssetPipelineBusy ? busyPipelineTooltip : undefined}
                    className="w-full rounded-lg border border-amber-400/45 bg-amber-500/10 px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-amber-100 transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Быстрый фикс
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleQuickFixActiveAsset(activeAssetVersion, "strong")}
                    disabled={!activeAssetVersion || isAssetPipelineBusy}
                    title={!activeAssetVersion ? noActiveModelTooltip : isAssetPipelineBusy ? busyPipelineTooltip : undefined}
                    className="w-full rounded-lg border border-emerald-400/45 bg-emerald-500/10 px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-emerald-100 transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Исправить для печати
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSplitActiveAsset(activeAssetVersion)}
                    disabled={!activeAssetVersion || isAssetPipelineBusy}
                    title={!activeAssetVersion ? noActiveModelTooltip : isAssetPipelineBusy ? busyPipelineTooltip : undefined}
                    className="w-full rounded-lg border border-cyan-400/45 bg-cyan-500/10 px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-cyan-100 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Разделить для печати
                  </button>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(["web", "game", "print"] as const).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => void handleRemeshPreset(preset)}
                        disabled={!activeAssetVersion || isAssetPipelineBusy}
                        title={!activeAssetVersion ? noActiveModelTooltip : isAssetPipelineBusy ? busyPipelineTooltip : undefined}
                        className="rounded-full border border-violet-300/45 px-2 py-1 text-[8px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.14em] text-violet-100 transition hover:border-violet-200 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Ремеш {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {rightPanelMainBlock === "appearance" && (
                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="rounded-full border border-white/10 bg-black/35 p-1.5">
                    <div className="flex items-center gap-1.5">
                      {([
                        ["clay", "Clay"],
                        ["original", "Original"],
                        ["resin", "Resin"],
                        ["plastic", "Plastic"],
                        ["hologram", "Holo"],
                      ] as Array<[typeof appearancePreset, string]>).map(([preset, label]) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setAppearancePreset(preset)}
                          disabled={!activeAssetVersion}
                          title={!activeAssetVersion ? noActiveModelTooltip : label}
                          className={`relative inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
                            appearancePreset === preset
                              ? "border-cyan-300/70 bg-cyan-500/12 shadow-[0_0_12px_rgba(34,211,238,0.35)]"
                              : "border-white/15 bg-white/[0.02] hover:border-white/35"
                          } disabled:cursor-not-allowed disabled:opacity-45`}
                        >
                          <span
                            className="h-4 w-4 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.4)]"
                            style={{ background: APPEARANCE_PRESET_SWATCH[preset] }}
                          />
                        </button>
                      ))}
                      <span className="mx-1 h-5 w-px bg-white/15" />
                      <button
                        type="button"
                        onClick={() => setAppearanceTuningOpen((prev) => !prev)}
                        disabled={!activeAssetVersion}
                        title={!activeAssetVersion ? noActiveModelTooltip : "Тонкая настройка материала"}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
                          appearanceTuningOpen
                            ? "border-cyan-300/65 bg-cyan-500/12 text-cyan-100"
                            : "border-white/15 bg-white/[0.02] text-white/65 hover:border-white/35 hover:text-white"
                        } disabled:cursor-not-allowed disabled:opacity-45`}
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {appearanceTuningOpen && (
                    <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-2">
                      <div className="flex items-center justify-between text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/65">
                        <span>Roughness</span>
                        <span>{appearanceRoughness}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={appearanceRoughness}
                        onChange={(event) => setAppearanceRoughness(Number(event.target.value) || 0)}
                        className="w-full accent-cyan-400"
                      />
                      <div className="flex items-center justify-between text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/65">
                        <span>Metalness</span>
                        <span>{appearanceMetalness}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={appearanceMetalness}
                        onChange={(event) => setAppearanceMetalness(Number(event.target.value) || 0)}
                        className="w-full accent-cyan-400"
                      />
                      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/35 px-2 py-1.5">
                        <span className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/60">
                          Цвет flat
                        </span>
                        <input
                          type="color"
                          value={appearanceFlatColor}
                          onChange={(event) =>
                            setAppearanceFlatColor(normalizeHexColorClient(event.target.value, "#aab0ba"))
                          }
                          className="h-6 w-8 cursor-pointer rounded border border-white/20 bg-transparent p-0"
                        />
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleTextureFromImage}
                    disabled={!activeAssetVersion || isAssetPipelineBusy}
                    title={
                      !activeAssetVersion
                        ? noActiveModelTooltip
                        : isAssetPipelineBusy
                          ? busyPipelineTooltip
                          : !resolveTextureImageSource()
                            ? `${noTextureSourceTooltip}. Будет применен fallback профиль.`
                            : undefined
                    }
                    className="w-full rounded-lg border border-cyan-400/45 bg-cyan-500/10 px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-cyan-100 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Текстуры (из изображения)
                  </button>
                  <button
                    type="button"
                    onClick={handleTextureFallbackMaterial}
                    disabled={!activeAssetVersion || isAssetPipelineBusy}
                    title={!activeAssetVersion ? noActiveModelTooltip : isAssetPipelineBusy ? busyPipelineTooltip : undefined}
                    className="w-full rounded-lg border border-white/25 bg-white/[0.02] px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/80 transition hover:border-white/45 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Однотонный материал
                  </button>
                </div>
              )}

              {rightPanelMainBlock === "export" && (
                <div className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeAssetVersion) return;
                      handleDownloadAssetGlb(activeAssetVersion);
                    }}
                    disabled={!activeAssetVersion || isAssetPipelineBusy}
                    title={!activeAssetVersion ? noActiveModelTooltip : isAssetPipelineBusy ? busyPipelineTooltip : undefined}
                    className="w-full rounded-lg border border-[#2ED1FF]/45 bg-[#2ED1FF]/10 px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-[#BFF4FF] transition hover:border-[#7FE7FF] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Скачать GLB
                  </button>
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                    <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/60">
                      Blender
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (!activeAssetVersion) return;
                        void queueBlenderJobForAsset(activeAssetVersion);
                      }}
                      disabled={!activeAssetVersion || isAssetPipelineBusy}
                      title={!activeAssetVersion ? noActiveModelTooltip : "Открыть в Blender"}
                      aria-label="Открыть в Blender"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-violet-400/45 bg-violet-500/10 text-violet-100 transition hover:border-violet-300 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <BlenderBadgeIcon className="h-4.5 w-4.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSendAssetToPrint(activeAssetVersion)}
                    disabled={!activeAssetVersion}
                    title={!activeAssetVersion ? noActiveModelTooltip : undefined}
                    className="w-full rounded-lg border border-emerald-400/45 bg-emerald-500/10 px-3 py-1.5 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-emerald-100 transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Отправить в печать
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        <section
          id="ai-lab-viewport"
          className={`relative flex min-h-[520px] flex-col overflow-hidden rounded-[32px] border border-white/10 ${
            viewportBackgroundMode === "transparent" ? "bg-transparent" : "bg-black/20"
          } ${
            focusMode ? "lg:min-h-[680px]" : ""
          }`}
        >
          {!focusMode && (
            <div className="absolute left-6 top-6 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/70">
              <Cpu className="h-3.5 w-3.5 text-[#2ED1FF]" />
              РАБОЧАЯ ЗОНА
            </div>
          )}
          <div className="relative h-[520px] w-full sm:h-[600px] lg:h-full">
            <Canvas
              gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
              onCreated={({ gl }) => {
                gl.setClearColor(0x000000, 0);
              }}
              dpr={viewerQuality === "performance" ? [1, 1.2] : [1, 1.8]}
              camera={{ position: viewportCameraPosition, fov: viewportCameraFov }}
              className="h-full w-full"
            >
              <ambientLight intensity={0.65} />
              <ReactorLights active={isSynthRunning} />
              <FloorPulse active={isSynthRunning} />
              {viewportShowGrid && (
                <Grid
                  infiniteGrid
                  sectionColor="#152b36"
                  cellColor="#0b2230"
                  fadeDistance={16}
                  fadeStrength={4}
                  position={[0, -1.2, 0]}
                />
              )}
              <Suspense fallback={null}>
                {activePreviewModel ? (
                  <group position={[0, MODEL_STAGE_OFFSET, 0]} scale={modelScale}>
                    <ModelView
                      rawModelUrl={activePreviewModel}
                      paintedModelUrl={null}
                      finish="Raw"
                      renderMode={effectiveViewportRenderMode}
                      accentColor="#2ED1FF"
                      baseColor={activeTextureTint}
                      materialOverride={activeMaterialOverride}
                      onBounds={handleBounds}
                      onStats={handleViewportStats}
                      onIssueMarkers={handleViewportIssueMarkers}
                    />
                  </group>
                ) : isSynthRunning ? (
                  <NeuralCore active progress={displayProgress} />
                ) : null}
                {(viewerIssuesOverlay || viewerThicknessPreview) && (
                  <ViewportIssueMarkers markers={viewportIssueMarkers} thinOnly={viewerThicknessPreview} />
                )}
              </Suspense>
              <OrbitControls
                enableRotate
                enablePan
                enableZoom
                mouseButtons={viewportMouseButtons}
                enableDamping
                autoRotate={viewportAutoRotate}
              />
              <Environment preset={viewportEnvironmentPreset} />
            </Canvas>
            <div className="laser-scan pointer-events-none absolute inset-x-6 z-10 h-0.5 rounded-full bg-gradient-to-r from-transparent via-[#2ED1FF] to-transparent opacity-70 shadow-[0_0_18px_rgba(46,209,255,0.65)]" />
          </div>

          {isSynthRunning && !activePreviewModel && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <div className="w-[min(430px,78%)] rounded-2xl border border-white/15 bg-[#050a0f]/72 px-5 py-4 text-center backdrop-blur-sm">
                <p className="text-sm font-semibold text-white/90">Генерация...</p>
                <p className="mt-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-white/55">
                  собираем геометрию и материалы
                </p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full bg-gradient-to-r from-[#8ECFFF] via-[#D9ECFF] to-[#FFFFFF] transition-all"
                    style={{ width: `${Math.max(4, Math.min(100, Math.round(displayProgress)))}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-0 z-10">
            <div className="absolute left-6 top-24 flex items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.32em] text-white/60">
              <span className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_12px_rgba(16,185,129,0.6)]" />
              NEURAL_LINK: ГОТОВ
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
          <div className="absolute inset-x-5 bottom-4 z-20 space-y-2">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-[#050a0f]/85 px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/70 backdrop-blur">
              <button
                type="button"
                onClick={() => setViewportControlMode("orbit")}
                title="Вращение модели"
                className={`rounded-full border px-2.5 py-1 transition ${
                  viewportControlMode === "orbit"
                    ? "border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                    : "border-white/15 bg-white/[0.02] hover:border-white/35 hover:text-white"
                }`}
              >
                Орбита
              </button>
              <button
                type="button"
                onClick={() => setViewportControlMode("pan")}
                title="Сдвиг сцены (зажмите ЛКМ и тяните)"
                className={`rounded-full border px-2.5 py-1 transition ${
                  viewportControlMode === "pan"
                    ? "border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                    : "border-white/15 bg-white/[0.02] hover:border-white/35 hover:text-white"
                }`}
              >
                Панорама
              </button>
              <button
                type="button"
                onClick={() => setViewportControlMode("zoom")}
                title="Приближение/отдаление (колесо или ЛКМ в режиме зума)"
                className={`rounded-full border px-2.5 py-1 transition ${
                  viewportControlMode === "zoom"
                    ? "border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                    : "border-white/15 bg-white/[0.02] hover:border-white/35 hover:text-white"
                }`}
              >
                Зум
              </button>
              <div className="ml-auto flex items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setViewportViewsOpen((prev) => !prev);
                      setViewportSettingsOpen(false);
                    }}
                    title="Выбор готового ракурса камеры"
                    className="rounded-full border border-white/15 bg-white/[0.02] px-2.5 py-1 transition hover:border-white/35 hover:text-white"
                  >
                    {`Ракурс: ${viewportPresetLabel}`}
                  </button>
                  {viewportViewsOpen && (
                    <div className="absolute bottom-9 right-0 z-30 w-[170px] space-y-1 rounded-xl border border-white/15 bg-[#060a10]/95 p-2 shadow-[0_12px_28px_rgba(0,0,0,0.45)]">
                      {(
                        [
                          ["orbit", "Сбросить вид"],
                          ["front", "Спереди"],
                          ["back", "Сзади"],
                          ["left", "Слева"],
                          ["right", "Справа"],
                          ["top", "Сверху"],
                          ["bottom", "Снизу"],
                        ] as Array<[string, string]>
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setViewportViewPreset(value as typeof viewportViewPreset);
                            setViewportViewsOpen(false);
                          }}
                          className={`w-full rounded-lg border px-2 py-1 text-left text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] transition ${
                            viewportViewPreset === value
                              ? "border-cyan-300/60 bg-cyan-500/12 text-cyan-100"
                              : "border-white/10 bg-white/[0.02] text-white/65 hover:border-white/30 hover:text-white"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setViewportSettingsOpen((prev) => !prev);
                      setViewportViewsOpen(false);
                    }}
                    title="Параметры освещения и фона"
                    className="rounded-full border border-white/15 bg-white/[0.02] px-2.5 py-1 transition hover:border-white/35 hover:text-white"
                  >
                    Настройки
                  </button>
                  {viewportSettingsOpen && (
                    <div className="absolute bottom-9 right-0 z-30 w-[220px] space-y-2 rounded-xl border border-white/15 bg-[#060a10]/95 p-2 shadow-[0_12px_28px_rgba(0,0,0,0.45)]">
                      <div className="space-y-1">
                        <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/45">
                          Освещение
                        </p>
                        <div className="grid grid-cols-3 gap-1">
                          {(["city", "studio", "night"] as const).map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setViewportEnvironmentPreset(preset)}
                              className={`rounded-md border px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] ${
                                viewportEnvironmentPreset === preset
                                  ? "border-cyan-300/60 bg-cyan-500/12 text-cyan-100"
                                  : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                              }`}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/45">
                          Фон
                        </p>
                        <div className="grid grid-cols-2 gap-1">
                          {(["scene", "transparent"] as const).map((modeValue) => (
                            <button
                              key={modeValue}
                              type="button"
                              onClick={() => setViewportBackgroundMode(modeValue)}
                              className={`rounded-md border px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] ${
                                viewportBackgroundMode === modeValue
                                  ? "border-cyan-300/60 bg-cyan-500/12 text-cyan-100"
                                  : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                              }`}
                            >
                              {modeValue === "scene" ? "Сцена" : "Прозрачный"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-[#050a0f]/85 px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/70 backdrop-blur">
              <button
                type="button"
                onClick={() => setViewportShowGrid((prev) => !prev)}
                title="Показать/скрыть сетку пола"
                className={`rounded-full border px-2.5 py-1 transition ${
                  viewportShowGrid
                    ? "border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                    : "border-white/15 bg-white/[0.02] hover:border-white/35 hover:text-white"
                }`}
              >
                Сетка
              </button>
              <button
                type="button"
                onClick={() =>
                  setViewportRenderMode((prev) => (prev === "wireframe" ? "final" : "wireframe"))
                }
                title="Режим каркаса (wireframe)"
                className={`rounded-full border px-2.5 py-1 transition ${
                  viewportRenderMode === "wireframe"
                    ? "border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                    : "border-white/15 bg-white/[0.02] hover:border-white/35 hover:text-white"
                }`}
              >
                Каркас
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !viewerIssuesOverlay;
                  setViewerIssuesOverlay(next);
                  if (next) setViewerThicknessPreview(false);
                }}
                disabled={!activePreviewModel}
                title="Подсветить обнаруженные проблемные зоны"
                className={`rounded-full border px-2.5 py-1 transition ${
                  viewerIssuesOverlay
                    ? "border-rose-300/60 bg-rose-500/15 text-rose-100"
                    : "border-white/15 bg-white/[0.02] hover:border-white/35 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                Issues
              </button>
              <button
                type="button"
                onClick={() => setViewerMeasureOverlay((prev) => !prev)}
                disabled={!activePreviewModel}
                title="Линейка и размеры bbox"
                className={`rounded-full border px-2.5 py-1 transition ${
                  viewerMeasureOverlay
                    ? "border-emerald-300/60 bg-emerald-500/15 text-emerald-100"
                    : "border-white/15 bg-white/[0.02] hover:border-white/35 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                Measure
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !viewerThicknessPreview;
                  setViewerThicknessPreview(next);
                  if (next) setViewerIssuesOverlay(false);
                }}
                disabled={!activePreviewModel}
                title="Предпросмотр тонких зон"
                className={`rounded-full border px-2.5 py-1 transition ${
                  viewerThicknessPreview
                    ? "border-amber-300/60 bg-amber-500/15 text-amber-100"
                    : "border-white/15 bg-white/[0.02] hover:border-white/35 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                Thickness
              </button>
              <button
                type="button"
                onClick={handleViewportCapture}
                title="Сделать скриншот окна просмотра"
                className="rounded-full border border-white/15 bg-white/[0.02] px-2.5 py-1 transition hover:border-white/35 hover:text-white"
              >
                Скриншот
              </button>
              <div className="ml-auto flex items-center gap-2">
                {isSynthRunning && (
                  <button
                    type="button"
                    onClick={handleCancelSynthesis}
                    className="rounded-full border border-amber-400/45 bg-amber-500/12 px-2.5 py-1 text-amber-200 transition hover:border-amber-300"
                  >
                    Отмена {Math.round(displayProgress)}%
                  </button>
                )}
                {(isSynthRunning || serverJob) && (
                  <button
                    type="button"
                    onClick={handleStopMonitoring}
                    className="rounded-full border border-rose-400/45 bg-rose-500/10 px-2.5 py-1 text-rose-200 transition hover:border-rose-300"
                  >
                    Стоп
                  </button>
                )}
              </div>
            </div>
            {viewerMeasureOverlay && viewportBounds && (
              <div className="rounded-2xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-emerald-100/85">
                <p>
                  BBox: {viewportBounds.boxSize[0].toFixed(2)} x {viewportBounds.boxSize[1].toFixed(2)} x{" "}
                  {viewportBounds.boxSize[2].toFixed(2)}
                </p>
                <p className="mt-1">
                  Radius: {viewportBounds.radius.toFixed(2)}
                  {viewportStats ? ` • Poly: ${viewportStats.polyCount} • Mesh: ${viewportStats.meshCount}` : ""}
                </p>
              </div>
            )}
            {(viewerIssuesOverlay || viewerThicknessPreview) && (
              <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-rose-100/85">
                {viewerThicknessPreview
                  ? `Тонкие зоны: ${viewportIssueMarkers.filter((marker) => marker.id.startsWith("thin")).length}`
                  : `Проблемные зоны: ${viewportIssueMarkers.length}`}
              </div>
            )}
          </div>
        </section>

        <aside
          className={`relative flex h-fit flex-col gap-5 rounded-[32px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl lg:sticky lg:top-32 ${
            isDesktopPanelHidden ? "lg:hidden" : "lg:flex"
          }`}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.34em] text-white/60">
                Полка
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-black/30 p-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em]">
              {([
                ["assets", "Ассеты"],
                ["history", "История"],
                ["queue", "Очередь"],
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
            <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/55">
              {labPanelTab === "history"
                ? "Лента истории"
                : labPanelTab === "assets"
                  ? "Библиотека ассетов"
                  : "Очередь задач и логи"}
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 p-2">
              <input
                value={rightPanelQueryInput}
                onChange={(event) => setRightPanelQueryInput(event.target.value)}
                placeholder={
                  labPanelTab === "queue"
                    ? "Поиск по задачам..."
                    : labPanelTab === "history"
                      ? "Поиск по истории..."
                      : "Поиск по ассетам..."
                }
                className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/80 placeholder:text-white/35 focus:border-cyan-400/50 focus:outline-none"
              />
            </div>
          </div>
          {labPanelTab !== "queue" && (
            <div className="rounded-2xl border border-cyan-400/35 bg-black/35 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/65">
                    Выбранная модель
                  </p>
                  {activeAssetVersion ? (
                    <>
                      <p className="mt-1 truncate text-sm font-semibold text-white/90">
                        {activeAssetVersion.title || activeHistoryJob?.prompt || `Asset ${activeAssetVersion.id}`}
                      </p>
                      <p className="mt-1 truncate text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/50">
                        {activeAssetVersion.versionLabel || "original"} • ID {activeAssetVersion.id.slice(0, 10)}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/45">
                      Выберите модель в истории или ассетах
                    </p>
                  )}
                </div>
                <span
                  className={`rounded-full border px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] ${activeModelStatusClass}`}
                >
                  {activeModelStatus}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (!activeHistoryJob) return;
                    setRemixJob(activeHistoryJob);
                    setRemixPrompt(activeHistoryJob.prompt || "");
                    setRemixLocalEdit(false);
                    setRemixTargetZone("ноги");
                    setRemixIssueReference(null);
                  }}
                  disabled={!activeHistoryJob || historyAction?.id === activeHistoryJob?.id}
                  title={!activeHistoryJob ? noActiveModelTooltip : undefined}
                  className="rounded-full border border-cyan-400/40 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-cyan-200 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {historyAction?.id === activeHistoryJob?.id && historyAction?.type === "variation" ? "..." : "Повтор"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!activeHistoryJob) return;
                    void handlePublishJob(activeHistoryJob);
                  }}
                  disabled={
                    !activeHistoryJob ||
                    historyAction?.id === activeHistoryJob.id ||
                    Boolean(activeHistoryJob?.id && publishedAssetsByJobId[activeHistoryJob.id])
                  }
                  title={!activeHistoryJob ? noActiveModelTooltip : undefined}
                  className="rounded-full border border-amber-400/40 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-amber-200 transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {activeHistoryJob?.id && publishedAssetsByJobId[activeHistoryJob.id] ? "Сохранено" : "В AI библиотеку"}
                </button>
              </div>
            </div>
          )}
          {labPanelTab === "queue" && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/15 bg-black/35 px-3 py-2">
                <div className="flex items-center justify-between text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/70">
                  <span>
                    Сейчас: {queueSummary.running} в работе • {queueSummary.queued} в очереди • {queueSummary.errors} ошибок
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/60 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    online
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {([
                  ["all", "Все"],
                  ["running", "В работе"],
                  ["queued", "Очередь"],
                  ["done", "Готово"],
                  ["error", "Ошибка"],
                ] as Array<[QueueFilter, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setQueueFilter(value)}
                    className={`rounded-full border px-2.5 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] transition ${
                      queueFilter === value
                        ? "border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_12px_rgba(46,209,255,0.25)]"
                        : "border-white/15 bg-white/[0.02] text-white/45 hover:border-white/30 hover:text-white/75"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {filteredQueueByQuery.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                    <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/40">
                      Задач не найдено.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setRightPanelQueryInput("");
                        setQueueFilter("all");
                      }}
                      className="mt-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
                    >
                      Сбросить фильтры
                    </button>
                  </div>
                ) : (
                  filteredQueueByQuery.map((item) => {
                    const typeLower = item.type.toLowerCase();
                    const isRunning = item.status === "running";
                    const isQueued = item.status === "queued";
                    const isDone = item.status === "done";
                    const isError = item.status === "error" || item.status === "canceled";
                    const iconToneClass = isError
                      ? "border-rose-400/35 bg-rose-500/10 text-rose-200"
                      : isRunning
                        ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                        : isQueued
                          ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-100"
                          : "border-white/20 bg-white/[0.05] text-white/70";
                    const badgeClass = isRunning
                      ? "border-emerald-400/55 bg-emerald-500/10 text-emerald-100"
                      : isQueued
                        ? "border-cyan-400/55 bg-cyan-500/10 text-cyan-100"
                        : isDone
                          ? "border-white/30 bg-white/5 text-white/70"
                          : "border-rose-400/55 bg-rose-500/10 text-rose-200";
                    const statusLabel = isRunning
                      ? "В РАБОТЕ"
                      : isQueued
                        ? "В ОЧЕРЕДИ"
                        : isDone
                          ? "ГОТОВО"
                          : item.status === "canceled"
                            ? "ОТМЕНЕНО"
                            : "ОШИБКА";
                    const canOpen = Boolean(item.historyJobId || item.versionId);
                    const canCancel = Boolean(item.queueJobId) && (isQueued || isRunning);
                    const canRetry = isError;

                    return (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] px-3 py-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${iconToneClass}`}>
                            {typeLower.includes("генерац") || typeLower.includes("ремикс") ? (
                              <FlaskConical className="h-4 w-4" />
                            ) : typeLower.includes("фикс") || typeLower.includes("текстур") ? (
                              <Wand2 className="h-4 w-4" />
                            ) : typeLower.includes("раздел") ? (
                              <Scissors className="h-4 w-4" />
                            ) : typeLower.includes("экспорт") ? (
                              <Rocket className="h-4 w-4" />
                            ) : typeLower.includes("blender") ? (
                              <BlenderBadgeIcon className="h-4 w-4" />
                            ) : typeLower.includes("анализ") ? (
                              <Cpu className="h-4 w-4" />
                            ) : (
                              <Box className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[15px] font-semibold leading-5 text-white/90">{item.type}</p>
                                <p className="mt-1 truncate text-[12px] text-white/60">{item.label}</p>
                              </div>
                              <span
                                className={`rounded-full border px-2.5 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] ${badgeClass}`}
                              >
                                {statusLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 h-2.5 overflow-hidden rounded-full border border-white/10 bg-black/40">
                          <div
                            className={`h-full transition-all ${
                              isError
                                ? "bg-gradient-to-r from-rose-500 to-rose-300"
                                : "bg-gradient-to-r from-[#2ED1FF] via-[#7FE7FF] to-white"
                            }`}
                            style={{ width: `${Math.max(4, Math.min(100, Math.round(item.progress || 0)))}%` }}
                          />
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-white/60">
                          <span className="truncate">
                            {isQueued || isRunning ? `ETA ${formatEta(item.etaSeconds ?? null)}` : item.message || "—"}
                          </span>
                          <span className="font-[var(--font-jetbrains-mono)]">{Math.round(item.progress || 0)}%</span>
                        </div>
                        <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenQueueJob(item)}
                            disabled={!canOpen}
                            className="rounded-full border border-cyan-400/45 bg-cyan-500/10 px-2.5 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            Открыть
                          </button>
                          <button
                            type="button"
                            onClick={() => handleShowQueueJobLogs(item)}
                            className="rounded-full border border-white/25 bg-white/[0.03] px-2.5 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/75 transition hover:border-white/35 hover:text-white"
                          >
                            Логи
                          </button>
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => void handleCancelQueueJob(item)}
                              className="rounded-full border border-amber-400/50 bg-amber-500/10 px-2.5 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-amber-100 transition hover:border-amber-300"
                            >
                              Отменить
                            </button>
                          )}
                          {canRetry && (
                            <button
                              type="button"
                              onClick={() => void handleRetryQueueJob(item)}
                              className="rounded-full border border-rose-400/50 bg-rose-500/10 px-2.5 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-rose-200 transition hover:border-rose-300"
                            >
                              Повторить
                            </button>
                          )}
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
              <span>История AI</span>
              <span className="text-white/30">{filteredHistoryByQuery.length}</span>
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
                      {filterValue === "all"
                        ? "все"
                        : filterValue === "completed"
                          ? "готово"
                          : filterValue === "failed"
                            ? "ошибка"
                            : filterValue === "queued"
                              ? "очередь"
                              : "в работе"}
                    </button>
                  );
                }
              )}
            </div>
            <div className="mt-3 space-y-2">
              {jobHistoryLoading ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/40">
                  ЗАГРУЗКА...
                </div>
              ) : filteredHistoryByQuery.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                  <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/40">
                    ПУСТО. ИЗМЕНИТЕ ПОИСК ИЛИ СГЕНЕРИРУЙТЕ ПЕРВУЮ МОДЕЛЬ.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRightPanelQueryInput("");
                        setJobHistoryFilter("all");
                      }}
                      className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
                    >
                      Сбросить фильтры
                    </button>
                    <button
                      type="button"
                      onClick={() => setRightPanelMainBlock("create")}
                      className="rounded-full border border-cyan-400/35 bg-cyan-500/10 px-3 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-300"
                    >
                      Сгенерировать первую модель
                    </button>
                  </div>
                </div>
              ) : (
                filteredHistoryByQuery.map((job) => {
                  const linkedAsset = publishedAssetsByJobId[job.id]
                    ? publishedAssetsById[publishedAssetsByJobId[job.id]]
                    : null;
                  const fixAvailable = Boolean(
                    linkedAsset?.fixAvailable || linkedAsset?.checks?.topology?.fixAvailable
                  );
                  const diagnosticsStatus = linkedAsset?.checks?.diagnostics?.status || "unknown";
                  const versionLabel = linkedAsset?.versionLabel || "original";
                  return (
                  <div
                    key={job.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handlePickHistoryJob(job)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handlePickHistoryJob(job);
                      }
                    }}
                    className={`rounded-xl border bg-white/[0.03] px-3 py-2 transition ${
                      activeHistoryJobId === job.id
                        ? "border-[#2ED1FF]/60 shadow-[0_0_14px_rgba(46,209,255,0.2)]"
                        : "border-white/10 hover:border-white/25"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold text-white/90">
                          {job.prompt || `Задача ${job.id}`}
                        </p>
                        <p className="mt-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/45">
                          {formatJobDate(job.createdAt)} • {job.mode}
                          {Array.isArray(job.inputRefs) && job.inputRefs.length > 0
                            ? ` • рефы:${Math.min(MAX_INPUT_REFERENCES, job.inputRefs.length)}`
                            : ""}
                          {job.parentJobId ? " • remix" : ""}
                        </p>
                      </div>
                      <p className={`text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] ${renderJobStatusTone(job.status)}`}>
                        {JOB_STATUS_LABEL_RU[job.status] || job.status}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                      <p className="truncate text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/45">
                        {job.stage || SERVER_STAGE_BY_STATUS[job.status]} • {Math.max(0, Math.min(100, job.progress || 0))}%
                        {(job.status === "queued" || job.status === "processing") &&
                          ` • ETA ${formatEta(job.etaSeconds ?? null)}`}
                        {job.status === "queued" &&
                          typeof job.queuePosition === "number" &&
                          job.queuePosition > 0 &&
                          ` • Q#${job.queuePosition}`}
                        {fixAvailable ? " • доступен фикс" : ""}
                        {linkedAsset ? ` • diag:${diagnosticsStatus}` : ""}
                        {linkedAsset ? ` • ${versionLabel}` : ""}
                      </p>
                      <div className="grid w-full grid-cols-3 gap-1.5 xl:w-auto xl:min-w-[248px]">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setRemixJob(job);
                            setRemixPrompt(job.prompt || "");
                            setRemixLocalEdit(false);
                            setRemixTargetZone("ноги");
                            setRemixIssueReference(null);
                          }}
                          disabled={historyAction?.id === job.id || job.status !== "completed"}
                          className="w-full rounded-full border border-cyan-400/40 px-2 py-1 text-center text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-cyan-200 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Создать ремикс (альтернативный вариант)"
                        >
                          {historyAction?.id === job.id && historyAction?.type === "variation" ? "..." : "РЕМИКС"}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handlePublishJob(job);
                          }}
                          disabled={
                            historyAction?.id === job.id ||
                            job.status !== "completed" ||
                            Boolean(publishedAssetsByJobId[job.id])
                          }
                          className="w-full rounded-full border border-amber-400/40 px-2 py-1 text-center text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.22em] text-amber-200 transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {publishedAssetsByJobId[job.id]
                            ? "СОХРАНЕНО"
                            : historyAction?.id === job.id && historyAction?.type === "publish"
                              ? "..."
                              : "ПУБЛИКАЦИЯ"}
                        </button>
                        <details className="group relative w-full" onClick={(event) => event.stopPropagation()}>
                          <summary className="list-none cursor-pointer rounded-full border border-white/20 px-2 py-1 text-center text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white [&::-webkit-details-marker]:hidden">
                            ЕЩЕ
                          </summary>
                          <div className="absolute right-0 top-8 z-20 min-w-[172px] space-y-1 rounded-xl border border-white/10 bg-[#06090d]/95 p-2 shadow-[0_12px_24px_rgba(0,0,0,0.45)]">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleRetryHistoryJob(job);
                              }}
                              disabled={
                                historyAction?.id === job.id ||
                                (job.status !== "failed" && job.status !== "queued")
                              }
                              className="w-full rounded-lg border border-emerald-400/40 px-2 py-1 text-left text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-emerald-200 transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {historyAction?.id === job.id && historyAction?.type === "retry" ? "..." : "ПОВТОР"}
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleDeleteHistoryJob(job);
                              }}
                              disabled={historyAction?.id === job.id}
                              className="w-full rounded-lg border border-rose-400/40 px-2 py-1 text-left text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-rose-200 transition hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {historyAction?.id === job.id && historyAction?.type === "delete" ? "..." : "УДАЛИТЬ"}
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
              <span className="text-white/30">{filteredGalleryByQuery.length} / {GALLERY_LIMIT}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {filteredGalleryByQuery.length === 0 ? (
                <div className="col-span-2 rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-center">
                  <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/40">
                    ПОКА НЕТ РЕЗУЛЬТАТОВ
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRightPanelQueryInput("")}
                      className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
                    >
                      Сбросить фильтры
                    </button>
                    <button
                      type="button"
                      onClick={() => setRightPanelMainBlock("create")}
                      className="rounded-full border border-cyan-400/35 bg-cyan-500/10 px-3 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-300"
                    >
                      Сгенерировать первую модель
                    </button>
                  </div>
                </div>
              ) : (
                filteredGalleryByQuery.map((asset) => (
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
                          МОДЕЛЬ
                        </div>
                      )}
                    </div>
                    <div className="flex w-full items-center justify-between gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-white/60">
                      <span className="truncate">{asset.name}</span>
                      <span className="text-white/30">{asset.format.toUpperCase()}</span>
                    </div>
                    <div className="flex w-full items-center gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDownload(asset);
                        }}
                        className="min-w-0 w-full truncate rounded-full border border-[#2ED1FF]/40 px-1.5 py-1 text-center text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-[#BFF4FF] transition hover:border-[#7FE7FF]"
                      >
                        СКАЧАТЬ
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRemoveGalleryAsset(asset);
                        }}
                        className="rounded-full border border-rose-400/40 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-rose-200 transition hover:border-rose-300"
                        title="Удалить из витрины"
                      >
                        УДАЛИТЬ
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
          <div className="w-full max-w-[920px] rounded-[28px] border border-[#2ED1FF]/35 bg-[#05070a]/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-3 text-[12px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-cyan-200">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
                  [ ПОПОЛНЕНИЕ ТОКЕНОВ ]
                </div>
                <p className="mt-3 text-sm text-white/70">
                  Режим: <span className="font-semibold text-cyan-100">{billingUIState.billingMode}</span>
                </p>
              </div>
              <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-white/55">
                Токены: {tokensLoading ? "..." : billingUIState.tokenBalance}
              </p>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-emerald-400/35 bg-emerald-500/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-emerald-100">Тестовое пополнение токенов</h3>
                  <span className="rounded-full border border-emerald-300/45 bg-emerald-500/15 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-emerald-100">
                    MOCK ACTIVE
                  </span>
                </div>
                <p className="mt-2 text-xs text-white/65">Для разработки и проверки сценариев AI Lab.</p>
                {!isMockTopupEnabled && (
                  <p className="mt-2 text-xs text-amber-200">
                    Mock-пополнение отключено в текущем окружении.
                  </p>
                )}

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {MOCK_TOPUP_PACKS.map((pack) => {
                    const selected = billingUIState.mockTopup.selectedPackageId === pack.id;
                    return (
                      <button
                        key={pack.id}
                        type="button"
                        onClick={() => handleMockPackageTopup(pack)}
                        disabled={!isMockTopupEnabled || isMockTopupLoading}
                        className={`rounded-xl border px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                          selected
                            ? "border-emerald-300/70 bg-emerald-500/20"
                            : "border-emerald-400/35 bg-emerald-500/5 hover:border-emerald-300/65 hover:bg-emerald-500/15"
                        }`}
                      >
                        <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-emerald-100">
                          {pack.title}
                        </p>
                        <p className="mt-2 text-xs text-white/55">{isMockTopupLoading ? "обработка..." : pack.note}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                  <label
                    htmlFor="mock-topup-amount"
                    className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/65"
                  >
                    Количество токенов
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="mock-topup-amount"
                      type="text"
                      inputMode="numeric"
                      placeholder="Например: 150"
                      value={mockCustomAmountInput}
                      onChange={(event) => {
                        const digitsOnly = event.target.value.replace(/[^\d]/g, "").slice(0, 6);
                        setMockCustomAmountInput(digitsOnly);
                        setBillingUIState((prev) => ({
                          ...prev,
                          mockTopup: {
                            ...prev.mockTopup,
                            status: prev.mockTopup.status === "error" ? "idle" : prev.mockTopup.status,
                            errorMessage: undefined,
                          },
                        }));
                      }}
                      disabled={!isMockTopupEnabled || isMockTopupLoading}
                      className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={handleMockCustomTopupSubmit}
                      disabled={!isMockTopupEnabled || isMockTopupLoading}
                      className="rounded-xl border border-emerald-300/45 bg-emerald-500/15 px-4 py-2 text-[11px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-emerald-50 transition hover:border-emerald-200/70 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isMockTopupLoading ? "..." : "Пополнить"}
                    </button>
                  </div>
                  {billingUIState.mockTopup.errorMessage ? (
                    <p className="text-xs text-rose-300">{billingUIState.mockTopup.errorMessage}</p>
                  ) : (
                    <p className="text-[11px] text-white/50">
                      Допустимо только целое число от {MOCK_TOPUP_MIN} до {MOCK_TOPUP_MAX}.
                    </p>
                  )}
                  {billingUIState.mockTopup.status === "success" && (
                    <p className="text-xs text-emerald-200">Токены начислены (mock).</p>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.04] p-4 opacity-85">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-cyan-100">Реальное пополнение / Подписка</h3>
                  <span className="rounded-full border border-amber-300/45 bg-amber-500/15 px-2 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-amber-100">
                    Скоро
                  </span>
                </div>
                <p className="mt-2 text-xs text-white/65">
                  {realBillingReasonLabel(billingUIState.realBilling.reason)} Функция появится после интеграции платежного API.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {["S", "M", "L"].map((planCode) => (
                    <button
                      key={planCode}
                      type="button"
                      disabled
                      className="rounded-xl border border-cyan-300/25 bg-cyan-500/5 px-3 py-3 text-left text-xs text-white/45 disabled:cursor-not-allowed"
                      title="Пока недоступно. Подключаем реальный API."
                    >
                      <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-cyan-100/70">
                        PLAN {planCode}
                      </p>
                      <p className="mt-2">Подписка</p>
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs text-white/50">
                    {isRealBillingDisabled ? "Недоступно до подключения API." : "Реальный API подключен."}
                  </p>
                  <button
                    type="button"
                    onClick={handleRealBillingPreviewClick}
                    className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
                  >
                    Почему недоступно?
                  </button>
                </div>
              </section>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setTopupOpen(false)}
                disabled={isMockTopupLoading}
                className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.35em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {maskEditorOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-[1120px] rounded-[26px] border border-white/15 bg-[#05070a]/95 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.65)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-cyan-100">
                  [ MASK EDITOR ]
                </p>
                <p className="mt-1 text-sm text-white/75">
                  {maskEditorReference?.name || maskImageNameRef.current || "reference"}
                </p>
                <p className="mt-1 text-[11px] text-amber-200/85">Умная маска скоро появится. Сейчас доступна ручная и магнитная доводка.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!maskEditorReference) return;
                    closeMaskEditor();
                    void handleRemoveReferenceBackground(maskEditorReference.id);
                  }}
                  disabled={!maskEditorReference || removingReferenceBgId === maskEditorReference?.id}
                  className="rounded-full border border-emerald-300/45 bg-emerald-500/10 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-emerald-100 transition hover:border-emerald-200 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Убрать фон
                </button>
                <button
                  type="button"
                  disabled
                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/45"
                  title="Умная маска пока недоступна"
                >
                  Умная маска (скоро)
                </button>
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
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_1fr]">
              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/35 p-3">
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
                    title="Палочка по похожим пикселям. Alt временно инвертирует действие."
                  >
                    Палочка
                  </button>
                  <div className="ml-auto flex items-center gap-1">
                    <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/55">Preview</span>
                    {(["overlay", "alpha", "black", "white", "checker"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setMaskPreviewMode(mode)}
                        className={`rounded-full border px-2.5 py-1 text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.14em] transition ${
                          maskPreviewMode === mode
                            ? "border-cyan-300/70 bg-cyan-500/15 text-cyan-100"
                            : "border-white/15 bg-white/5 text-white/60 hover:border-white/35"
                        }`}
                      >
                        {mode === "overlay"
                          ? "Наложение"
                          : mode === "alpha"
                            ? "Альфа"
                            : mode === "black"
                              ? "Черный"
                              : mode === "white"
                                ? "Белый"
                                : "Прозрачный"}
                      </button>
                    ))}
                  </div>
                </div>

                {maskMode === "wand" ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.04] px-3 py-2">
                    <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/55">Допуск</span>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={maskWandTolerance}
                      onChange={(event) => setMaskWandTolerance(Number(event.target.value))}
                      className="w-44 accent-cyan-300"
                    />
                    <span className="min-w-[40px] text-[10px] text-white/65">{maskWandTolerance}%</span>
                    <button
                      type="button"
                      onClick={() => setMaskWandAction("erase")}
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] transition ${
                        maskWandAction === "erase"
                          ? "border-rose-300/60 bg-rose-500/15 text-rose-100"
                          : "border-white/20 bg-white/5 text-white/60 hover:border-white/35"
                      }`}
                    >
                      Убрать (-)
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
                      Оставить (+)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMaskWandOuterOnly((value) => !value)}
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] transition ${
                        maskWandOuterOnly
                          ? "border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                          : "border-white/20 bg-white/5 text-white/60 hover:border-white/35"
                      }`}
                      title="Когда включено, палочка режет только внешний фон."
                    >
                      Внешний фон
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                      <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/55">Размер</span>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="range"
                          min={1}
                          max={300}
                          value={maskBrushSize}
                          onChange={(event) => setMaskBrushSize(Number(event.target.value))}
                          className="w-full accent-cyan-300"
                        />
                        <span className="min-w-[44px] text-[10px] text-white/65">{maskBrushSize}px</span>
                      </div>
                    </label>
                    <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                      <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/55">Жесткость</span>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={maskBrushHardness}
                          onChange={(event) => setMaskBrushHardness(Number(event.target.value))}
                          className="w-full accent-cyan-300"
                        />
                        <span className="min-w-[40px] text-[10px] text-white/65">{maskBrushHardness}%</span>
                      </div>
                    </label>
                    <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                      <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/55">Сглаживание</span>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={maskBrushSmoothing}
                          onChange={(event) => setMaskBrushSmoothing(Number(event.target.value))}
                          className="w-full accent-cyan-300"
                        />
                        <span className="min-w-[40px] text-[10px] text-white/65">{maskBrushSmoothing}%</span>
                      </div>
                    </label>
                    <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/55">Магнитный край</span>
                        <button
                          type="button"
                          onClick={() => setMaskMagneticEdge((value) => !value)}
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] transition ${
                            maskMagneticEdge
                              ? "border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                              : "border-white/20 bg-white/5 text-white/60 hover:border-white/35"
                          }`}
                        >
                          {maskMagneticEdge ? "ON" : "OFF"}
                        </button>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={maskSnapStrength}
                          onChange={(event) => setMaskSnapStrength(Number(event.target.value))}
                          disabled={!maskMagneticEdge}
                          className="w-full accent-cyan-300 disabled:opacity-50"
                        />
                        <span className="min-w-[40px] text-[10px] text-white/65">{maskSnapStrength}%</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid gap-2 md:grid-cols-3">
                  <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                    <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/55">Feather</span>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={10}
                        step={1}
                        value={maskFeatherPx}
                        onChange={(event) => setMaskFeatherPx(Number(event.target.value))}
                        className="w-full accent-cyan-300"
                      />
                      <span className="min-w-[32px] text-[10px] text-white/65">{maskFeatherPx}px</span>
                    </div>
                  </label>
                  <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                    <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/55">Smooth</span>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={maskSmoothLevel}
                        onChange={(event) => setMaskSmoothLevel(Number(event.target.value))}
                        className="w-full accent-cyan-300"
                      />
                      <span className="min-w-[32px] text-[10px] text-white/65">{maskSmoothLevel}</span>
                    </div>
                  </label>
                  <label className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                    <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/55">Shift Edge</span>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="range"
                        min={-10}
                        max={10}
                        step={1}
                        value={maskShiftEdgePx}
                        onChange={(event) => setMaskShiftEdgePx(Number(event.target.value))}
                        className="w-full accent-cyan-300"
                      />
                      <span className="min-w-[32px] text-[10px] text-white/65">{maskShiftEdgePx}</span>
                    </div>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                  <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/55">View</span>
                  <button
                    type="button"
                    onClick={() => handleMaskZoomStep(-1)}
                    className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[10px] text-white/70 transition hover:border-white/35"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMaskZoomStep(1)}
                    className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[10px] text-white/70 transition hover:border-white/35"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={handleMaskZoomReset}
                    className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] text-white/70 transition hover:border-white/35"
                  >
                    100%
                  </button>
                  <button
                    type="button"
                    onClick={handleMaskZoomFit}
                    className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] text-white/70 transition hover:border-white/35"
                  >
                    Fit
                  </button>
                  <span className="ml-auto text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/55">
                    {Math.round(maskViewZoom * 100)}%
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/45 p-2">
                <div
                  ref={maskViewportRef}
                  onWheel={handleMaskCanvasWheel}
                  className="relative h-[62vh] overflow-hidden rounded-xl border border-white/10 bg-black/65"
                >
                  <canvas
                    ref={maskCanvasRef}
                    onPointerDown={handleMaskCanvasPointerDown}
                    onPointerMove={handleMaskCanvasPointerMove}
                    onPointerUp={handleMaskCanvasPointerUp}
                    onPointerLeave={handleMaskCanvasPointerUp}
                    onContextMenu={(event) => event.preventDefault()}
                    className="absolute left-0 top-0 touch-none rounded-lg"
                    style={{
                      cursor: maskCanvasCursor,
                      transform: `translate(${maskViewPanX}px, ${maskViewPanY}px) scale(${maskViewZoom})`,
                      transformOrigin: "left top",
                    }}
                  />
                </div>
              </div>
            </div>

            {maskEditorError && (
              <div className="mt-3 rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {maskEditorError}
              </div>
            )}

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
                {maskApplying ? "Применяем..." : "Применить маску"}
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
                Промпт
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

      {blenderInstallOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-[560px] rounded-[28px] border border-violet-400/35 bg-[#05070a]/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
            <div className="flex items-center gap-3 text-[12px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-violet-100">
              <span className="h-2 w-2 rounded-full bg-violet-300 shadow-[0_0_12px_rgba(167,139,250,0.7)]" />
              [ BLENDER BRIDGE ]
            </div>
            <p className="mt-4 text-sm text-white/75">
              Open in Blender недоступен, пока Bridge не настроен. Установите аддон и подключите token.
            </p>
            <ol className="mt-4 space-y-2 text-sm text-white/70">
              <li>
                1. Установите Blender Bridge addon в Blender (Edit -&gt; Preferences -&gt;
                Add-ons -&gt; Install).
              </li>
              <li>2. Вставьте API token сервера (BLENDER_BRIDGE_TOKEN) в настройках аддона.</li>
              <li>3. Нажмите Test connection, затем Fetch jobs и Import latest.</li>
            </ol>
            <p className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
              Для локальной проверки включите NEXT_PUBLIC_BLENDER_BRIDGE_ENABLED=1.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setBlenderInstallOpen(false)}
                className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
              >
                Закрыть
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
                Закрыть
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

