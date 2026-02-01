"use client";

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Grid, OrbitControls, Stage } from "@react-three/drei";
import { AnimatePresence, motion, useMotionValue, useSpring } from "framer-motion";
import { Vector3, type WebGLRendererParameters } from "three";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Heart,
  Layers,
  Menu,
  Palette,
  Printer,
  RotateCw,
  Scan,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Trash2,
  User,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import ModelView, { RenderMode } from "@/components/ModelView";
import { ToastContainer, useToast } from "@/components/Toast";
import AuthForm from "@/components/AuthForm";
import { ORDER_STATUS_UNREAD_KEY } from "@/lib/orderStatus";
import { useFavorites, type FavoriteItem } from "@/lib/favorites";

type TechMode = "SLA Resin" | "FDM Plastic";
type ModelBounds = {
  size: number;
  boxSize: [number, number, number];
  radius: number;
};

const HERO_PORTAL_IMAGE = "/backgrounds/prtal.png";
const HERO_PORTAL_MASK = "/backgrounds/portal_glow_mask_soft_score_blur.png";

const estimatePrintTime = (
  bounds: ModelBounds | null,
  tech: TechMode | null,
  polyCount?: number | null,
  scaleLabel?: string | null,
  modelScale?: number | null
) => {
  if (!bounds) return null;
  const [width, height, depth] = bounds.boxSize;
  if (![width, height, depth].every((v) => Number.isFinite(v) && v > 0)) {
    return null;
  }

  const maxSide = Math.max(width, height, depth);
  const fromScale = parseScaleMm(scaleLabel ?? null);
  const mmPerUnit =
    fromScale && maxSide > 0
      ? fromScale / maxSide
      : typeof modelScale === "number" && modelScale > 0
        ? 100 * modelScale
        : 100;

  const widthMm = width * mmPerUnit;
  const heightMm = height * mmPerUnit;
  const depthMm = depth * mmPerUnit;
  const volumeMm3 = widthMm * heightMm * depthMm;
  const polyFactor =
    typeof polyCount === "number" && polyCount > 0
      ? Math.min(2.2, Math.max(0.7, Math.log10(polyCount / 100000 + 1)))
      : 1;

  const volumeCm3 = volumeMm3 / 1000;
  const maxHeightMm = Math.max(widthMm, heightMm, depthMm);
  let minutes = 0;
  let profileLabel = "Профиль";

  if (tech === "SLA Resin") {
    const layerHeightMm = 0.05;
    const secondsPerLayer = 3.6;
    const layers = Math.max(1, Math.round(maxHeightMm / layerHeightMm));
    minutes = (layers * secondsPerLayer) / 60 + 8;
    minutes *= polyFactor * 0.9;
    profileLabel = "Elegoo 4";
  } else {
    const minutesPerCm3 = tech === "FDM Plastic" ? 0.6 : 1.2;
    minutes = volumeCm3 * minutesPerCm3 * polyFactor + 12;
    profileLabel = tech === "FDM Plastic" ? "BambuLab" : "FDM";
  }

  minutes = Math.max(20, minutes);
  if (!Number.isFinite(minutes)) return null;

  const roundedMinutes = Math.round(minutes);
  const hours = Math.floor(roundedMinutes / 60);
  const mins = roundedMinutes % 60;
  if (hours <= 0) {
    return `${mins}m • ${profileLabel}`;
  }
  return `${hours}h ${mins}m • ${profileLabel}`;
};

type SidebarCategory = {
  id: string;
  title: string;
  count: number;
  children?: SidebarCategory[];
};

type CategoryDoc = {
  id?: string | number;
  title?: string;
  parent?: string | number | { id?: string | number; title?: string } | null;
};

type MediaDoc = {
  id?: string;
  url?: string;
  filename?: string;
  thumbnail?: string | null;
};

type SidebarCategoryNode = SidebarCategory & {
  parentKey: string | null;
};

type ProductDoc = {
  id?: string;
  name?: string;
  slug?: string;
  sku?: string;
  format?: string;
  technology?: string;
  price?: number;
  polyCount?: number;
  modelScale?: number;
  printTime?: string;
  scale?: string;
  isVerified?: boolean;
  isFeatured?: boolean;
  category?: CategoryDoc | string | number | null;
  categories?:
    | Array<CategoryDoc | string | number>
    | { docs?: Array<CategoryDoc | string | number>; data?: Array<CategoryDoc | string | number> }
    | null;
  rawModel?: MediaDoc | string | null;
  paintedModel?: MediaDoc | string | null;
  thumbnail?: MediaDoc | string | null;
};

type CatalogProduct = {
  id: string;
  name: string;
  price: string;
  priceValue: number | null;
  formatKey: FormatMode | null;
  rawModelUrl: string | null;
  paintedModelUrl: string | null;
  rawModelId?: string | null;
  paintedModelId?: string | null;
  modelScale: number | null;
  thumbnailUrl: string;
  techKey: TechMode | null;
  tech: string;
  slug: string;
  sku: string;
  type: string;
  polyCount: number | null;
  printTime: string | null;
  scale: string | null;
  verified: boolean;
  isFeatured: boolean;
  categoryTitles: string[];
  categoryIds: string[];
  categoryKeys: string[];
};

type SearchSuggestion = {
  id: string;
  label: string;
  type: "product" | "category" | "sku" | "recent";
  slug?: string;
};

type CustomPrintMeta = {
  uploadId: string;
  uploadUrl?: string;
  uploadName?: string;
  technology?: string;
  material?: string;
  quality?: string;
  dimensions?: { x: number; y: number; z: number };
  volumeCm3?: number;
};

type CartItem = {
  id: string;
  productId: string;
  name: string;
  formatKey: FormatMode;
  formatLabel: string;
  priceLabel: string;
  priceValue: number;
  quantity: number;
  thumbnailUrl: string;
  customPrint?: CustomPrintMeta | null;
};

const normalizeFormat = (value?: string): FormatMode | null => {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("digital")) {
    return "digital";
  }
  if (normalized.includes("physical")) {
    return "physical";
  }
  return null;
};

const normalizeTechnology = (value?: unknown): TechMode | null => {
  if (!value) {
    return null;
  }
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null
        ? ((value as { value?: string; label?: string }).value ??
            (value as { value?: string; label?: string }).label ??
            "")
        : "";
  const normalized = raw.toLowerCase();
  if (
    normalized.includes("sla") ||
    normalized.includes("resin") ||
    normalized.includes("смол")
  ) {
    return "SLA Resin";
  }
  if (
    normalized.includes("fdm") ||
    normalized.includes("plastic") ||
    normalized.includes("пласт")
  ) {
    return "FDM Plastic";
  }
  return null;
};

const formatPrice = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("ru-RU").format(value);
};

const formatCurrency = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }
  return `₽${formatPrice(value)}`;
};

const formatCount = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return new Intl.NumberFormat("ru-RU").format(value);
};

const buildCartThumbnail = (label: string) => {
  const shortLabel = label.trim().slice(0, 2).toUpperCase() || "3D";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#1f2937"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="160" height="120" rx="24" fill="url(#g)"/><circle cx="120" cy="24" r="28" fill="rgba(46,209,255,0.25)"/><text x="18" y="70" fill="#E2E8F0" font-family="Arial, sans-serif" font-size="28" font-weight="700">${shortLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const buildProductPlaceholder = () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="280" viewBox="0 0 420 280"><defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#020617"/></linearGradient><linearGradient id="line" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="rgba(46,209,255,0)"/><stop offset="50%" stop-color="rgba(46,209,255,0.6)"/><stop offset="100%" stop-color="rgba(46,209,255,0)"/></linearGradient><filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" /></filter></defs><rect width="420" height="280" rx="32" fill="url(#bg)"/><g opacity="0.25"><path d="M0 70h420M0 140h420M0 210h420" stroke="rgba(148,163,184,0.35)" stroke-width="1"/><path d="M105 0v280M210 0v280M315 0v280" stroke="rgba(148,163,184,0.35)" stroke-width="1"/></g><g filter="url(#blur)" opacity="0.4"><rect x="80" y="70" width="260" height="140" rx="20" fill="rgba(46,209,255,0.08)"/></g><g fill="none" stroke="url(#line)" stroke-width="2"><path d="M140 90l120 -30 120 60 -120 30 -120 -60z"/><path d="M140 90v90l120 60v-90"/><path d="M260 60v90l120 60v-90"/></g><text x="28" y="36" font-family="JetBrains Mono, Consolas, monospace" font-size="12" fill="rgba(226,232,240,0.55)" letter-spacing="3">WIREFRAME</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const resolveCartThumbnail = (url: string | null, label: string) => {
  if (url && /\.(png|jpe?g|webp|gif|avif)$/i.test(url)) {
    return url;
  }
  return buildCartThumbnail(label);
};

const splitTokens = (value: string) =>
  value.split(/[^\p{L}\p{N}]+/gu).filter(Boolean);

const matchesQuery = (value: string, query: string) => {
  const normalized = value.toLowerCase();
  if (normalized.startsWith(query)) {
    return true;
  }
  return splitTokens(normalized).some((token) => token.startsWith(query));
};

const MODEL_EXTENSIONS = [".glb", ".gltf", ".stl"];

const isModelAsset = (value: string) =>
  MODEL_EXTENSIONS.some((ext) => value.toLowerCase().endsWith(ext));

const isExternalUrl = (value: string) =>
  value.startsWith("http://") || value.startsWith("https://");

const isGltfAsset = (value: string) => value.toLowerCase().endsWith(".gltf");

const extractFilename = (value: string) => {
  const normalized = value.split("?")[0] ?? value;
  const parts = normalized.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || null;
};

const buildProxyUrl = (filename: string) =>
  `/api/media-file/${encodeURIComponent(filename)}`;

const buildProxyUrlFromSource = (value?: string | null) => {
  if (!value) return null;
  const filename = extractFilename(value);
  return filename ? buildProxyUrl(filename) : null;
};

const resolveMediaUrl = (value?: MediaDoc | string | null) => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    if (isModelAsset(value)) {
      if (isGltfAsset(value)) {
        return value;
      }
      if (isExternalUrl(value)) {
        return value;
      }
      const filename = extractFilename(value);
      return filename ? buildProxyUrl(filename) : value;
    }
    return value;
  }

  const url = typeof value.url === "string" ? value.url : null;
  if (url) {
    if (isExternalUrl(url)) {
      return url;
    }
    if (url.startsWith("/")) {
      return url;
    }
  }

  const filename = value.filename ?? null;
  if (filename && isModelAsset(filename)) {
    if (isGltfAsset(filename)) {
      if (url) {
        return url;
      }
      return `/media/${filename}`;
    }
    return buildProxyUrl(filename);
  }

  if (url) {
    return url;
  }
  if (filename) {
    return `/media/${filename}`;
  }
  return null;
};

const resolveMediaId = (value?: MediaDoc | string | null) => {
  if (!value || typeof value === "string") {
    return null;
  }
  if (value.id) {
    return String(value.id);
  }
  if ((value as any).value) {
    return String((value as any).value);
  }
  return null;
};

const resolveProductThumbnail = (value: MediaDoc | string | null | undefined) => {
  if (value && typeof value === "object") {
    const thumbnail = typeof value.thumbnail === "string" ? value.thumbnail : null;
    if (thumbnail) {
      return thumbnail;
    }
    const url = typeof value.url === "string" ? value.url : null;
    if (url && /\.(png|jpe?g|webp|gif|avif)$/i.test(url)) {
      return url;
    }
  }
  if (typeof value === "string" && /\.(png|jpe?g|webp|gif|avif)$/i.test(value)) {
    return value;
  }
  return buildProductPlaceholder();
};

const resolveCategoryTitle = (
  value: CategoryDoc | string | number | null | undefined,
  categoriesById: Map<string, string>
) => {
  if (!value) {
    return null;
  }
  const normalizeLabel = (label?: string | null) => label?.trim() ?? null;
  const resolveById = (rawId?: string | number | null) => {
    if (rawId === null || rawId === undefined) {
      return null;
    }
    const resolved = categoriesById.get(String(rawId));
    return resolved ? resolved.trim() : null;
  };

  if (typeof value === "number") {
    return resolveById(value);
  }
  if (typeof value === "string") {
    return normalizeLabel(categoriesById.get(value) ?? value);
  }
  if (value.title) {
    return normalizeLabel(value.title);
  }
  if (value.id) {
    return resolveById(value.id);
  }
  const fallbackLabel =
    normalizeLabel(
      (value as { label?: string; name?: string }).label ??
        (value as { label?: string; name?: string }).name ??
        null
    ) ?? null;
  if (fallbackLabel) {
    return fallbackLabel;
  }
  if ((value as { _id?: string | number })._id) {
    return resolveById((value as { _id?: string | number })._id ?? null);
  }
  return null;
};

const normalizeCategoryKey = (value?: string | null) =>
  value?.trim().toLowerCase() ?? "";

const unwrapCategoryValue = (value?: unknown) => {
  if (!value || typeof value !== "object") {
    return value ?? null;
  }
  const candidate = (value as { value?: unknown; data?: unknown; doc?: unknown }).value ??
    (value as { value?: unknown; data?: unknown; doc?: unknown }).data ??
    (value as { value?: unknown; data?: unknown; doc?: unknown }).doc;
  return candidate ?? value;
};

const extractCategoryArray = (
  value?: unknown
): Array<CategoryDoc | string | number> => {
  if (Array.isArray(value)) {
    return value as Array<CategoryDoc | string | number>;
  }
  if (value && typeof value === "object") {
    const candidate =
      (value as { docs?: unknown; data?: unknown }).docs ??
      (value as { docs?: unknown; data?: unknown }).data;
    if (Array.isArray(candidate)) {
      return candidate as Array<CategoryDoc | string | number>;
    }
  }
  return [];
};

const getProductCategoryValues = (product: ProductDoc) => {
  const values = extractCategoryArray(product.categories);
  if (product.category) {
    values.push(product.category);
  }
  return values;
};

const collectCategoryTitles = (product: ProductDoc, categoriesById: Map<string, string>) => {
  const titles: string[] = [];
  const addTitle = (value?: CategoryDoc | string | number | null) => {
    const normalizedValue = unwrapCategoryValue(value) as CategoryDoc | string | number | null;
    const title = resolveCategoryTitle(normalizedValue ?? null, categoriesById);
    if (title) {
      titles.push(title);
    }
  };

  getProductCategoryValues(product).forEach((category) => addTitle(category ?? null));

  return Array.from(new Set(titles));
};

const collectCategoryIds = (product: ProductDoc) => {
  const ids: string[] = [];
  const addId = (value?: CategoryDoc | string | number | null) => {
    const normalizedValue = unwrapCategoryValue(value);
    if (!normalizedValue) {
      return;
    }
    if (typeof normalizedValue === "number") {
      ids.push(String(normalizedValue));
      return;
    }
    if (typeof normalizedValue === "string") {
      ids.push(normalizedValue);
      return;
    }
    if (
      typeof normalizedValue === "object" &&
      (normalizedValue as { id?: string | number }).id !== undefined
    ) {
      ids.push(String((normalizedValue as { id?: string | number }).id));
      return;
    }
    if (
      typeof normalizedValue === "object" &&
      (normalizedValue as { _id?: string | number })._id !== undefined
    ) {
      ids.push(String((normalizedValue as { _id?: string | number })._id));
    }
  };

  getProductCategoryValues(product).forEach((category) => addId(category ?? null));

  return Array.from(new Set(ids));
};

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6 } },
};

const interiorBackgrounds = {
  lab: "/backgrounds/bg_lab.png",
  home: "/backgrounds/bg_home.png",
  work: "/backgrounds/bg_work.png",
} as const;

const interiorThemeKeywords = {
  lab: [
    "sci-fi",
    "scifi",
    "cyber",
    "robot",
    "android",
    "mech",
    "space",
    "future",
    "character",
    "персонаж",
    "герой",
    "кибер",
    "робот",
    "андроид",
    "мех",
    "космо",
    "будущее",
  ],
  home: [
    "home",
    "decor",
    "interior",
    "furniture",
    "architecture",
    "архитектур",
    "дом",
    "декор",
    "интерьер",
    "мебел",
    "светильник",
    "ваза",
  ],
  work: [
    "terrain",
    "tabletop",
    "wargame",
    "tool",
    "mechanic",
    "industrial",
    "vehicle",
    "weapon",
    "props",
    "prototype",
    "хобби",
    "игруш",
    "террейн",
    "механ",
    "инжен",
    "техника",
    "машин",
    "танк",
    "корабл",
    "самолет",
    "оруж",
  ],
} as const;

const normalizeThemeText = (value: string) => value.toLowerCase();

const collapseThemeText = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9а-я]+/gi, "");

const hasThemeMatch = (
  source: string,
  collapsed: string,
  keywords: readonly string[]
) =>
  keywords.some((keyword) => {
    const normalized = normalizeThemeText(keyword);
    const collapsedKeyword = collapseThemeText(keyword);
    return source.includes(normalized) || (collapsedKeyword && collapsed.includes(collapsedKeyword));
  });

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 2147483647;
  }
  return hash;
};

const createSeededRandom = (seed: number) => {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
};

const pickInteriorBackground = (product?: CatalogProduct | null) => {
  if (!product) {
    return interiorBackgrounds.lab;
  }

  const tokens = [
    product.name,
    product.slug,
    product.sku,
    ...product.categoryTitles,
    ...product.categoryKeys,
  ]
    .filter(Boolean)
    .join(" ");

  const normalized = normalizeThemeText(tokens);
  const collapsed = collapseThemeText(tokens);

  if (hasThemeMatch(normalized, collapsed, interiorThemeKeywords.lab)) {
    return interiorBackgrounds.lab;
  }
  if (hasThemeMatch(normalized, collapsed, interiorThemeKeywords.home)) {
    return interiorBackgrounds.home;
  }
  if (hasThemeMatch(normalized, collapsed, interiorThemeKeywords.work)) {
    return interiorBackgrounds.work;
  }

  const keys = Object.keys(interiorBackgrounds) as Array<
    keyof typeof interiorBackgrounds
  >;
  const fallbackKey =
    keys[hashString(product.id || product.name || "lab") % keys.length] ??
    "lab";
  return interiorBackgrounds[fallbackKey];
};

const parseScaleMm = (value?: string | null) => {
  if (!value) {
    return null;
  }
  if (!/mm|мм/i.test(value)) {
    return null;
  }
  const match = value.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const numeric = Number.parseFloat(match[1]);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
};

const formatDimensions = (
  bounds: ModelBounds | null,
  scaleLabel?: string | null,
  modelScale?: number | null
) => {
  if (!bounds) {
    return null;
  }
  const [width, height, depth] = bounds.boxSize;
  const maxSide = Math.max(width, height, depth);
  if (!Number.isFinite(maxSide) || maxSide <= 0) {
    return null;
  }

  const fromScale = parseScaleMm(scaleLabel ?? null);
  const mmPerUnit =
    fromScale && maxSide > 0
      ? fromScale / maxSide
      : typeof modelScale === "number" && modelScale > 0
        ? 100 * modelScale
        : 100;

  const toMm = (value: number) => Math.max(1, Math.round(value * mmPerUnit));
  return `${toMm(width)} x ${toMm(height)} x ${toMm(depth)} мм`;
};

type FinishMode = "raw" | "pro";
type PreviewMode = "default" | "interior" | "ar";
type FormatMode = "digital" | "physical";
type LightingMode = "sun" | "side" | "golden";

const lightingPresets: Array<{ value: LightingMode; label: string }> = [
  { value: "sun", label: "СОЛНЕЧНЫЙ (СВЕРХУ)" },
  { value: "side", label: "БОКОВОЙ" },
  { value: "golden", label: "ЗОЛОТОЙ ЧАС" },
];

const finishOptions: Array<{ value: FinishMode; label: string }> = [
  { value: "raw", label: "ОРИГИНАЛ" },
  { value: "pro", label: "ПРО" },
];

const accentOptions: Array<{ value: string; label: string }> = [
  { value: "#f3f4f6", label: "ICE" },
  { value: "#2ED1FF", label: "CYAN" },
  { value: "#22c55e", label: "EMERALD" },
  { value: "#f59e0b", label: "AMBER" },
  { value: "#f43f5e", label: "ROSE" },
  { value: "#94a3b8", label: "SLATE" },
];

const CATALOG_CACHE_KEY = "store3d_catalog_cache";
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const CATALOG_REQUEST_TIMEOUT_MS = 15_000;
const CATALOG_REQUEST_RETRY_DELAY_MS = 1200;
const CATALOG_REQUEST_MAX_RETRIES = 1;
const MODEL_LOAD_TIMEOUT_MS = 12_000;
const SEARCH_RECENTS_KEY = "store3d_search_recent";

export default function Home() {
  const router = useRouter();
  const { toasts, showSuccess, showError, removeToast } = useToast();
  const [isMounted, setIsMounted] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [renderMode, setRenderMode] = useState<RenderMode>("final");
  const [finish, setFinish] = useState<FinishMode>("raw");
  const [preview, setPreview] = useState<PreviewMode>("default");
  const [lightingMode, setLightingMode] = useState<LightingMode>("side");
  const [activeColor, setActiveColor] = useState("#f3f4f6");
  const [format, setFormat] = useState<FormatMode>("digital");
  const [technology, setTechnology] = useState<TechMode>("SLA Resin");
  const [verified, setVerified] = useState(false);
  const [useGlobalCatalog, setUseGlobalCatalog] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const [hasUnreadStatus, setHasUnreadStatus] = useState(false);
  const [products, setProducts] = useState<ProductDoc[]>([]);
  const [categoriesData, setCategoriesData] = useState<CategoryDoc[]>([]);
  const [productsError, setProductsError] = useState(false);
  const [categoriesError, setCategoriesError] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [scanPulse, setScanPulse] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isWorkshopOpen, setWorkshopOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [userProfile, setUserProfile] = useState<any | null>(null);
  const [modelRetryKey, setModelRetryKey] = useState(0);
  const [modelErrorCount, setModelErrorCount] = useState(0);
  const [heroModelReady, setHeroModelReady] = useState(false);
  const [heroModelStalled, setHeroModelStalled] = useState(false);
  const [useProxyForModels, setUseProxyForModels] = useState(false);
  const [forceProxyMedia, setForceProxyMedia] = useState(false);
  const { favorites, favoriteIds, toggleFavorite } = useFavorites();
  const [heroBounds, setHeroBounds] = useState<ModelBounds | null>(null);
  const [heroPolyCountComputed, setHeroPolyCountComputed] = useState<number | null>(null);
  const heroSectionRef = useRef<HTMLDivElement | null>(null);
  const heroEntranceRef = useRef<HTMLDivElement | null>(null);
  const showPortalHero = false;
  const [heroVisible, setHeroVisible] = useState(false);
  const [heroInView, setHeroInView] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const heroParallaxX = useMotionValue(0);
  const heroParallaxY = useMotionValue(0);
  const heroParallaxXSpring = useSpring(heroParallaxX, { stiffness: 80, damping: 18, mass: 0.4 });
  const heroParallaxYSpring = useSpring(heroParallaxY, { stiffness: 80, damping: 18, mass: 0.4 });
  const heroParticles = useMemo(() => {
    const rand = createSeededRandom(9021);
    return Array.from({ length: 28 }, (_, index) => {
      const size = 1.5 + rand() * 2.5;
      return {
        id: `particle-${index}`,
        left: `${Math.round(rand() * 100)}%`,
        size,
        duration: 12 + rand() * 14,
        delay: rand() * -12,
        opacity: 0.35 + rand() * 0.45,
      };
    });
  }, []);
  const controlsRef = useRef<any | null>(null);
  const previousRenderModeRef = useRef<RenderMode>("final");
  const zoomAnimationRef = useRef<number | null>(null);
  const apiBase = "";

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const forceProxy = params.get("proxy") === "1";
    const ua = navigator.userAgent || "";
    const isMobileUa = /android|iphone|ipad|ipod|iemobile|mobile/i.test(ua);
    if (forceProxy || isMobileUa) {
      setForceProxyMedia(true);
    }
  }, []);

  const formatLabelForKey = (formatKey: FormatMode) =>
    formatKey === "physical" ? "Печатная модель" : "Цифровой STL";

  const refreshUser = useCallback(() => {
    fetch(`${apiBase}/api/users/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const user = data?.user ?? data?.doc ?? null;
        setUserProfile(user);
      })
      .catch(() => {
        setUserProfile(null);
      });
  }, [apiBase]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const isNarrow = window.matchMedia?.("(max-width: 768px)")?.matches;
    if (prefersReduced || isNarrow) {
      setAutoRotate(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(SEARCH_RECENTS_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setRecentSearches(
          parsed.filter((value) => typeof value === "string" && value.trim()).slice(0, 6)
        );
      }
    } catch {
      // Ignore malformed local storage
    }
  }, []);

  const commitSearch = useCallback((value: string) => {
    const term = value.trim();
    if (!term) return;
    setRecentSearches((prev) => {
      const normalized = term.toLowerCase();
      const next = [
        term,
        ...prev.filter((entry) => entry.toLowerCase() !== normalized),
      ].slice(0, 6);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SEARCH_RECENTS_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const normalizeCustomPrint = (source: any): CustomPrintMeta | null => {
    if (!source || typeof source !== "object") {
      return null;
    }

    const raw = source.customPrint && typeof source.customPrint === "object" ? source.customPrint : source;
    const uploadId =
      typeof raw.uploadId === "string"
        ? raw.uploadId
        : typeof raw.customerUploadId === "string"
          ? raw.customerUploadId
          : null;

    if (!uploadId) {
      return null;
    }

    const dimensions =
      raw.dimensions && typeof raw.dimensions === "object"
        ? {
            x: Number(raw.dimensions.x) || 0,
            y: Number(raw.dimensions.y) || 0,
            z: Number(raw.dimensions.z) || 0,
          }
        : undefined;

    return {
      uploadId,
      uploadUrl: typeof raw.uploadUrl === "string" ? raw.uploadUrl : undefined,
      uploadName: typeof raw.uploadName === "string" ? raw.uploadName : undefined,
      technology: typeof raw.technology === "string" ? raw.technology : undefined,
      material: typeof raw.material === "string" ? raw.material : undefined,
      quality: typeof raw.quality === "string" ? raw.quality : undefined,
      dimensions,
      volumeCm3: typeof raw.volumeCm3 === "number" ? raw.volumeCm3 : undefined,
    };
  };

  const normalizeStoredItem = (item: any): CartItem | null => {
    if (!item || typeof item !== "object") {
      return null;
    }

    const productId =
      typeof item.productId === "string"
        ? item.productId
        : typeof item.id === "string"
          ? item.id
          : null;

    if (!productId) {
      return null;
    }

    const formatKey = item.formatKey === "physical" ? "physical" : "digital";
    const name = typeof item.name === "string" ? item.name : "Item";
    const priceValue = typeof item.priceValue === "number" ? item.priceValue : 0;
    const quantity =
      typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
    const formatLabel =
      typeof item.formatLabel === "string" ? item.formatLabel : formatLabelForKey(formatKey);
    const priceLabel =
      typeof item.priceLabel === "string" ? item.priceLabel : formatCurrency(priceValue);
    const thumbnailUrl =
      typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : buildCartThumbnail(name);
    const id =
      typeof item.id === "string" && item.productId
        ? item.id
        : `${productId}:${formatKey}`;
    const customPrint = normalizeCustomPrint(item);

    return {
      id,
      productId,
      name,
      formatKey,
      formatLabel,
      priceLabel,
      priceValue,
      quantity,
      thumbnailUrl,
      customPrint,
    };
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem("store3d_cart");
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((item) => normalizeStoredItem(item))
          .filter((item): item is CartItem => Boolean(item));
        setCartItems(normalized);
      }
    } catch {
      setCartItems([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const updateUnread = () => {
      const raw = window.localStorage.getItem(ORDER_STATUS_UNREAD_KEY);
      const count = raw ? Number(raw) : 0;
      setHasUnreadStatus(Number.isFinite(count) && count > 0);
    };
    updateUnread();
    window.addEventListener("order-status-unread", updateUnread);
    return () => window.removeEventListener("order-status-unread", updateUnread);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("store3d_cart", JSON.stringify(cartItems));
  }, [cartItems]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;
    const buildApiUrl = (path: string) => `${apiBase}${path}`;
    const readCatalogCache = () => {
      if (typeof window === "undefined") {
        return null;
      }
      try {
        const raw = window.localStorage.getItem(CATALOG_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as {
          ts?: number;
          products?: ProductDoc[];
          categories?: CategoryDoc[];
        };
        if (!parsed?.ts || Date.now() - parsed.ts > CATALOG_CACHE_TTL_MS) {
          return null;
        }
        return {
          products: Array.isArray(parsed.products) ? parsed.products : [],
          categories: Array.isArray(parsed.categories) ? parsed.categories : [],
        };
      } catch {
        return null;
      }
    };
    const writeCatalogCache = (products: ProductDoc[], categories: CategoryDoc[]) => {
      if (typeof window === "undefined") {
        return;
      }
      try {
        window.localStorage.setItem(
          CATALOG_CACHE_KEY,
          JSON.stringify({ ts: Date.now(), products, categories })
        );
      } catch {
        // ignore cache write errors
      }
    };
    const fetchCatalog = async (attempt = 0): Promise<{
      products: ProductDoc[];
      categories: CategoryDoc[];
    }> => {
      const attemptController = new AbortController();
      const timeoutId = window.setTimeout(() => attemptController.abort(), CATALOG_REQUEST_TIMEOUT_MS);
      const handleAbort = () => attemptController.abort();
      controller.signal.addEventListener("abort", handleAbort, { once: true });

      try {
        const response = await fetch(buildApiUrl("/api/catalog"), {
          signal: attemptController.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          throw response;
        }
        const data = await response.json();
        return {
          products: Array.isArray(data?.products) ? data.products : data?.docs ?? [],
          categories: Array.isArray(data?.categories) ? data.categories : [],
        };
      } catch (error) {
        if (attempt < CATALOG_REQUEST_MAX_RETRIES && !controller.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, CATALOG_REQUEST_RETRY_DELAY_MS));
          return fetchCatalog(attempt + 1);
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
        controller.signal.removeEventListener("abort", handleAbort);
      }
    };

    const fetchData = async () => {
      const cached = readCatalogCache();
      const hasCache = Boolean(cached);
      if (cached) {
        setCategoriesData(cached.categories);
        setProducts(cached.products);
        setDataLoading(false);
        setCategoriesError(false);
        setProductsError(false);
      } else {
        setDataLoading(true);
      }
      setProductsError(false);
      setCategoriesError(false);

      const [catalogResult] = await Promise.allSettled([fetchCatalog()]);

      if (!isMounted) {
        return;
      }

      if (catalogResult.status === "fulfilled") {
        const nextCategories = Array.isArray(catalogResult.value?.categories)
          ? catalogResult.value.categories
          : [];
        const nextProducts = Array.isArray(catalogResult.value?.products)
          ? catalogResult.value.products
          : [];
        setCategoriesData(nextCategories);
        setProducts(nextProducts);
        writeCatalogCache(nextProducts, nextCategories);
      } else {
        if (!hasCache) {
          setCategoriesData([]);
          setProducts([]);
        }
        setCategoriesError(true);
        setProductsError(true);
      }
      setDataLoading(false);
    };

    fetchData().catch(() => {
      if (!isMounted) {
        return;
      }
      setProductsError(true);
      setCategoriesError(true);
      setProducts([]);
      setCategoriesData([]);
      setDataLoading(false);
    });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [apiBase]);

  const categoriesById = useMemo(() => {
    const map = new Map<string, string>();
    categoriesData?.forEach((category) => {
      const title = category?.title?.trim();
      if (category?.id && title) {
        map.set(String(category.id), title);
      }
    });
    return map;
  }, [categoriesData]);

  const categoryKeyById = useMemo(() => {
    const map = new Map<string, string>();
    categoriesData?.forEach((category) => {
      const title = category?.title?.trim();
      if (category?.id && title) {
        map.set(String(category.id), normalizeCategoryKey(title));
      }
    });
    return map;
  }, [categoriesData]);

  const normalizedProducts = useMemo(() => {
    return (products ?? []).map((product) => {
      const categoryTitles = collectCategoryTitles(product, categoriesById);
      const categoryIds = collectCategoryIds(product);
      const categoryKeys = Array.from(
        new Set(
          [
            ...categoryIds
              .map((id) => categoryKeyById.get(String(id)) ?? "")
              .filter(Boolean),
            ...categoryTitles.map((title) => normalizeCategoryKey(title)).filter(Boolean),
          ].filter(Boolean)
        )
      );
      const formatKey = normalizeFormat(product.format);
      const techKey = normalizeTechnology(product.technology);
      const techLabel =
        techKey ??
        (typeof product.technology === "string" ? product.technology : "Unknown");
      const rawModelUrl = resolveMediaUrl(product.rawModel ?? null);
      const paintedModelUrl = resolveMediaUrl(product.paintedModel ?? null);
      const rawModelId = resolveMediaId(product.rawModel ?? null);
      const paintedModelId = resolveMediaId(product.paintedModel ?? null);
      const priceValue = typeof product.price === "number" ? product.price : null;
      const priceLabel = formatCurrency(product.price);
      const polyCount = typeof product.polyCount === "number" ? product.polyCount : null;
      const modelScale =
        typeof product.modelScale === "number" ? product.modelScale : null;
      const printTime = product.printTime ?? null;
      const scale = product.scale ?? null;
      const thumbnailUrl = resolveProductThumbnail(product.thumbnail ?? null);

      return {
        id: String(product.id ?? product.name ?? ""),
        name: product.name ?? "Untitled",
        slug: product.slug ?? "",
        sku: product.sku ?? "",
        type: product.format ?? (formatKey === "digital" ? "Digital STL" : "Physical Print"),
        tech: techLabel,
        price: priceLabel,
        priceValue,
        polyCount,
        modelScale,
        printTime,
        scale,
        verified: Boolean(product.isVerified),
        isFeatured: Boolean(product.isFeatured),
        formatKey,
        techKey,
        categoryTitles,
        categoryIds,
        categoryKeys,
        rawModelUrl,
        paintedModelUrl,
        rawModelId,
        paintedModelId,
        thumbnailUrl,
      };
    });
  }, [products, categoriesById, categoryKeyById]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const searchSuggestions = useMemo<SearchSuggestion[]>(() => {
    const suggestions: SearchSuggestion[] = [];
    const seen = new Set<string>();

    const addSuggestion = (label: string, type: SearchSuggestion["type"], slug?: string) => {
      const key = `${type}:${label.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      suggestions.push({ id: key, label, type, slug });
    };

    if (normalizedQuery.length < 2) {
      recentSearches.forEach((entry) => {
        addSuggestion(entry, "recent");
      });
      return suggestions.slice(0, 6);
    }

    normalizedProducts.forEach((product) => {
      if (product.name && matchesQuery(product.name, normalizedQuery)) {
        addSuggestion(product.name, "product", product.slug);
      }
      if (product.sku && matchesQuery(product.sku, normalizedQuery)) {
        addSuggestion(product.sku, "sku", product.slug);
      }
      product.categoryTitles.forEach((title) => {
        if (title && matchesQuery(title, normalizedQuery)) {
          addSuggestion(title, "category");
        }
      });
    });

    return suggestions.slice(0, 8);
  }, [normalizedProducts, normalizedQuery, recentSearches]);

  const filteredProducts = useMemo(() => {
    return normalizedProducts.filter((product) => {
      const matchesFormat = useGlobalCatalog ? true : product.formatKey === format;
      const matchesTech = useGlobalCatalog ? true : product.techKey === technology;
      const matchesVerified = useGlobalCatalog ? true : !verified || product.verified;
      const matchesCategory = activeCategory
        ? product.categoryKeys.includes(activeCategory)
        : true;
      const matchesSearch =
        !normalizedQuery ||
        [
          product.name,
          product.sku,
          product.slug,
          ...product.categoryTitles,
        ].some((value) => value && matchesQuery(String(value), normalizedQuery));
      return matchesFormat && matchesTech && matchesVerified && matchesCategory && matchesSearch;
    });
  }, [
    normalizedProducts,
    format,
    technology,
    verified,
    activeCategory,
    normalizedQuery,
    useGlobalCatalog,
  ]);

  const countBasisProducts = useMemo(() => {
    return normalizedProducts.filter((product) => {
      const matchesFormat = useGlobalCatalog ? true : product.formatKey === format;
      const matchesTech = useGlobalCatalog ? true : product.techKey === technology;
      const matchesVerified = useGlobalCatalog ? true : !verified || product.verified;
      const matchesSearch =
        !normalizedQuery ||
        [
          product.name,
          product.sku,
          product.slug,
          ...product.categoryTitles,
        ].some((value) => value && matchesQuery(String(value), normalizedQuery));
      return matchesFormat && matchesTech && matchesVerified && matchesSearch;
    });
  }, [normalizedProducts, format, technology, verified, normalizedQuery, useGlobalCatalog]);

  const categoryCountsByKey = useMemo(() => {
    const counts = new Map<string, number>();
    countBasisProducts.forEach((product) => {
      product.categoryKeys.forEach((key) => {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
    });
    return counts;
  }, [countBasisProducts]);

  const sidebarCategories = useMemo<SidebarCategory[]>(() => {
    const nodes = new Map<string, SidebarCategoryNode>();
    const seen = new Set<string>();

    const resolveParentKey = (parent?: CategoryDoc["parent"] | null) => {
      if (!parent) {
        return null;
      }
      if (typeof parent === "object") {
        const title = (parent as { title?: string }).title;
        if (title) {
          return normalizeCategoryKey(title);
        }
        const id = (parent as { id?: string | number }).id;
        if (id !== undefined) {
          return categoryKeyById.get(String(id)) ?? null;
        }
      }
      if (typeof parent === "string" || typeof parent === "number") {
        return categoryKeyById.get(String(parent)) ?? null;
      }
      return null;
    };

    const addNode = (title: string, parentKey: string | null) => {
      const key = normalizeCategoryKey(title);
      if (!key) {
        return;
      }
      if (seen.has(key)) {
        const existing = nodes.get(key);
        if (existing && parentKey && !existing.parentKey) {
          existing.parentKey = parentKey;
        }
        return;
      }
      seen.add(key);
      nodes.set(key, {
        id: key,
        title,
        count: categoryCountsByKey.get(key) ?? 0,
        children: [],
        parentKey,
      });
    };

    categoriesData
      ?.filter((category) => category?.id && category?.title)
      .forEach((category) => {
        const title = category.title?.trim() ?? "";
        if (!title) {
          return;
        }
        const parentKey = resolveParentKey(category.parent ?? null);
        addNode(title, parentKey);
      });

    const animeKey = normalizeCategoryKey("Аниме");
    const animeGirlsKey = normalizeCategoryKey("Аниме девушки");
    if (animeKey) {
      addNode("Аниме", null);
    }
    if (animeGirlsKey) {
      addNode("Аниме девушки", animeKey ?? null);
      const animeNode = animeKey ? nodes.get(animeKey) : null;
      const animeGirlsNode = nodes.get(animeGirlsKey);
      if (animeNode && animeGirlsNode) {
        animeGirlsNode.parentKey = animeKey;
      }
    }

    const roots: SidebarCategory[] = [];
    nodes.forEach((node) => {
      if (node.parentKey && nodes.has(node.parentKey)) {
        const parent = nodes.get(node.parentKey);
        if (parent) {
          parent.children = parent.children ?? [];
          parent.children.push(node);
          return;
        }
      }
      roots.push(node);
    });

    const sortNodes = (list: SidebarCategory[]) => {
      list.sort((a, b) => a.title.localeCompare(b.title, "ru"));
      list.forEach((item) => {
        if (item.children?.length) {
          sortNodes(item.children);
        }
      });
    };

    sortNodes(roots);
    return roots;
  }, [categoriesData, categoryCountsByKey, categoryKeyById]);

  const defaultModelId = useMemo(() => {
    const featured = normalizedProducts.find((product) => product.isFeatured);
    return featured?.id ?? normalizedProducts[0]?.id ?? null;
  }, [normalizedProducts]);

  useEffect(() => {
    if (currentModelId || !defaultModelId) {
      return;
    }
    setCurrentModelId(defaultModelId);
  }, [currentModelId, defaultModelId]);

  useEffect(() => {
    if (filteredProducts.length === 0) {
      return;
    }
    const hasCurrent =
      currentModelId && filteredProducts.some((product) => product.id === currentModelId);
    if (!hasCurrent) {
      setCurrentModelId(filteredProducts[0].id);
    }
  }, [filteredProducts, currentModelId]);

  const currentProduct = useMemo(() => {
    if (!currentModelId) {
      return null;
    }
    return filteredProducts.find((product) => product.id === currentModelId) ?? null;
  }, [filteredProducts, currentModelId]);

  const interiorBackgroundUrl = useMemo(
    () => pickInteriorBackground(currentProduct),
    [currentProduct]
  );

  const activeModelUrl = useMemo(() => {
    if (!currentProduct) {
      return null;
    }
    if (finish === "pro") {
      return currentProduct.paintedModelUrl ?? currentProduct.rawModelUrl;
    }
    return currentProduct.rawModelUrl;
  }, [currentProduct, finish]);

  useEffect(() => {
    if (!currentProduct) {
      return;
    }
    setScanPulse((prev) => prev + 1);
    setIsScanning(true);
    const timeout = setTimeout(() => setIsScanning(false), 500);
    return () => clearTimeout(timeout);
  }, [activeModelUrl, currentProduct]);

  useEffect(() => {
    setHeroBounds(null);
    setHeroPolyCountComputed(null);
  }, [currentModelId]);

  const isFavorite = useCallback((id: string) => favoriteIds.has(id), [favoriteIds]);
  const buildFavoriteItem = (product: CatalogProduct): FavoriteItem => {
    const formatLabel = product.formatKey
      ? formatLabelForKey(product.formatKey)
      : product.type.toUpperCase();
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      priceLabel: product.price,
      priceValue: product.priceValue,
      thumbnailUrl: product.thumbnailUrl,
      tech: product.tech,
      formatLabel,
      formatKey: product.formatKey ?? null,
    };
  };
  const heroName = currentProduct?.name ?? "Нет модели";
  const heroSku = currentProduct?.sku || currentProduct?.slug || "-";
  const heroPriceLabel = formatCurrency(currentProduct?.priceValue ?? null);
  const heroPolyCount = currentProduct?.polyCount ?? heroPolyCountComputed ?? null;
  const heroPrintTime = currentProduct?.printTime ?? null;
  const heroScale = currentProduct?.scale ?? null;
  const heroEstimatedPrintTime = useMemo(
    () =>
      estimatePrintTime(
        heroBounds,
        currentProduct?.techKey ?? null,
        heroPolyCount,
        currentProduct?.scale ?? null,
        currentProduct?.modelScale ?? null
      ),
    [heroBounds, currentProduct?.techKey, heroPolyCount, currentProduct?.scale, currentProduct?.modelScale]
  );
  const isCurrentDigital = currentProduct?.formatKey === "digital";

  const buildPrintUrl = useCallback((product: CatalogProduct) => {
    const modelUrl = product.rawModelUrl ?? product.paintedModelUrl ?? null;
    if (!modelUrl) return null;
    const mediaId =
      product.rawModelUrl === modelUrl ? product.rawModelId : product.paintedModelId;
    const proxyUrl = buildProxyUrlFromSource(modelUrl) ?? modelUrl;
    const params = new URLSearchParams();
    params.set("model", proxyUrl);
    params.set("name", product.name ?? "model");
    params.set("source", "digital");
    if (product.techKey) {
      params.set("tech", product.techKey);
    }
    if (mediaId) {
      params.set("mediaId", mediaId);
    }
    if (typeof product.priceValue === "number" && Number.isFinite(product.priceValue)) {
      params.set("price", String(product.priceValue));
    }
    return `/services/print?${params.toString()}`;
  }, []);

  const handleOrderPrint = useCallback(
    (product: CatalogProduct) => {
      const url = buildPrintUrl(product);
      if (!url) {
        showError("У этой модели нет файла для печати.");
        return;
      }
      router.push(url);
    },
    [buildPrintUrl, router, showError]
  );
  const canPrintCurrent =
    Boolean(currentProduct?.rawModelUrl || currentProduct?.paintedModelUrl) &&
    isCurrentDigital;
  const handleHeaderPrint = useCallback(() => {
    if (currentProduct && canPrintCurrent) {
      handleOrderPrint(currentProduct);
      return;
    }
    router.push("/services/print");
  }, [canPrintCurrent, currentProduct, handleOrderPrint, router]);
  const isCurrentFavorite = currentProduct ? isFavorite(currentProduct.id) : false;
  const heroRawModelUrl = useMemo(() => {
    if (!currentProduct) return null;
    if (!useProxyForModels && !forceProxyMedia) return currentProduct.rawModelUrl;
    return (
      buildProxyUrlFromSource(currentProduct.rawModelUrl) ??
      currentProduct.rawModelUrl
    );
  }, [currentProduct, useProxyForModels, forceProxyMedia]);
  const heroPaintedModelUrl = useMemo(() => {
    if (!currentProduct) return null;
    if (!useProxyForModels && !forceProxyMedia) return currentProduct.paintedModelUrl;
    return (
      buildProxyUrlFromSource(currentProduct.paintedModelUrl) ??
      currentProduct.paintedModelUrl
    );
  }, [currentProduct, useProxyForModels, forceProxyMedia]);
  const isInterior = preview === "interior";
  const heroDimensions =
    formatDimensions(heroBounds, currentProduct?.scale ?? null, currentProduct?.modelScale ?? null) ??
    "-";
  const isSlaProduct = currentProduct?.techKey === "SLA Resin";
  const hasPaintedModel = Boolean(currentProduct?.paintedModelUrl);
  const isBaseActive = renderMode === "base";
  const isWireframeActive = renderMode === "wireframe";

  useEffect(() => {
    if (!currentProduct || isSlaProduct) {
      return;
    }
    if (renderMode === "base") {
      setRenderMode("final");
    }
    if (finish !== "raw") {
      setFinish("raw");
    }
  }, [currentProduct, finish, isSlaProduct, renderMode]);

  useEffect(() => {
    setModelRetryKey(0);
    setModelErrorCount(0);
    setHeroModelReady(false);
    setHeroModelStalled(false);
    setUseProxyForModels(false);
  }, [currentProduct?.id]);

  useEffect(() => {
    if (!currentProduct || productsError || dataLoading) {
      return;
    }
    setHeroModelReady(false);
    setHeroModelStalled(false);
    const timer = window.setTimeout(() => {
      setHeroModelStalled(true);
    }, MODEL_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [currentProduct?.id, modelRetryKey, productsError, dataLoading]);

  useEffect(() => {
    if (heroModelReady) {
      setHeroModelStalled(false);
    }
  }, [heroModelReady]);

  useEffect(() => {
    if (modelErrorCount === 0 || modelErrorCount > 2) {
      return;
    }
    const timer = window.setTimeout(() => {
      setModelRetryKey((prev) => prev + 1);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [modelErrorCount]);

  const handleModelReady = useCallback(() => {
    setHeroModelReady(true);
    setHeroModelStalled(false);
  }, []);

  const attemptProxyFallback = useCallback(() => {
    if (useProxyForModels || forceProxyMedia) {
      return false;
    }
    const candidate =
      buildProxyUrlFromSource(currentProduct?.rawModelUrl ?? null) ??
      buildProxyUrlFromSource(currentProduct?.paintedModelUrl ?? null);
    if (!candidate) {
      return false;
    }
    setUseProxyForModels(true);
    return true;
  }, [
    currentProduct?.paintedModelUrl,
    currentProduct?.rawModelUrl,
    useProxyForModels,
    forceProxyMedia,
  ]);

  const handleModelError = useCallback(() => {
    const switched = attemptProxyFallback();
    setHeroModelReady(false);
    setHeroModelStalled(true);
    setModelErrorCount((prev) => prev + 1);
    if (switched) {
      setModelRetryKey((prev) => prev + 1);
    }
  }, [attemptProxyFallback]);

  const handleHeroBounds = useCallback(
    (bounds: ModelBounds) => {
      setHeroBounds(bounds);
      handleModelReady();
    },
    [handleModelReady]
  );

  const handleModelRetry = useCallback(() => {
    attemptProxyFallback();
    setHeroModelStalled(false);
    setModelErrorCount(0);
    setModelRetryKey((prev) => prev + 1);
  }, [attemptProxyFallback]);

  useEffect(() => {
    if (heroVisible || typeof window === "undefined") {
      return;
    }
    const target = heroSectionRef.current;
    if (!target || !("IntersectionObserver" in window)) {
      setHeroVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHeroVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [heroVisible]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const updateVisibility = () => setIsPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const handleHeroParallax = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      heroParallaxX.set(Math.max(Math.min(x * 10, 10), -10));
      heroParallaxY.set(Math.max(Math.min(y * 10, 10), -10));
    },
    [heroParallaxX, heroParallaxY]
  );

  const resetHeroParallax = useCallback(() => {
    heroParallaxX.set(0);
    heroParallaxY.set(0);
  }, [heroParallaxX, heroParallaxY]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const target = heroSectionRef.current;
    if (!target || !("IntersectionObserver" in window)) {
      setHeroInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setHeroInView(entries.some((entry) => entry.isIntersecting));
      },
      { threshold: 0.2 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const handleWorkshopPaint = () => {
    setRenderMode("final");
    if (hasPaintedModel) {
      setFinish("pro");
      return;
    }
    setFinish("raw");
  };

  const handleWorkshopBase = () => {
    setRenderMode("base");
  };
  const emptyCategoryMessage = "В этой категории пока нет моделей. Ожидайте пополнения";

  const handleProductSelect = useCallback(
    (id: string, options?: { scroll?: boolean }) => {
      setCurrentModelId(id);
      if (options?.scroll) {
        window.requestAnimationFrame(() => {
          heroSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    },
    []
  );
  const showHeroStandby = productsError || dataLoading || !currentProduct;
  const heroStandbyMessage = productsError
    ? "System Standby: No Data"
    : dataLoading
      ? "Loading Data..."
      : emptyCategoryMessage;
  const currentIndex = useMemo(() => {
    if (!currentModelId) {
      return -1;
    }
    return filteredProducts.findIndex((product) => product.id === currentModelId);
  }, [filteredProducts, currentModelId]);
  const canQuickSwitch = filteredProducts.length > 1;
  const handlePrev = () => {
    if (!filteredProducts.length) {
      return;
    }
    const index = currentIndex > 0 ? currentIndex - 1 : filteredProducts.length - 1;
    setCurrentModelId(filteredProducts[index].id);
  };
  const handleNext = () => {
    if (!filteredProducts.length) {
      return;
    }
    const index =
      currentIndex >= 0 && currentIndex < filteredProducts.length - 1
        ? currentIndex + 1
        : 0;
    setCurrentModelId(filteredProducts[index].id);
  };

  const showSystemStandby = productsError || dataLoading || filteredProducts.length === 0;
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const userLabel = useMemo(() => {
    const raw =
      userProfile?.username ??
      userProfile?.name ??
      userProfile?.email ??
      userProfile?.fullName ??
      "Neo";
    const value = String(raw || "Neo");
    return value.includes("@") ? value.split("@")[0] : value;
  }, [userProfile]);
  const cartTotal = cartItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0);
  const cartTotalLabel = formatCurrency(cartTotal);

  const addToCart = (product: CatalogProduct) => {
    const priceValue = typeof product.priceValue === "number" ? product.priceValue : 0;
    const resolvedFormatKey = product.formatKey ?? format;
    const formatLabel = formatLabelForKey(resolvedFormatKey);
    const thumbnailUrl = resolveCartThumbnail(
      product.paintedModelUrl ?? product.rawModelUrl ?? null,
      product.name
    );
    const cartId = `${product.id}:${resolvedFormatKey}`;

    setCartItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === cartId);
      if (existingIndex === -1) {
        return [
          ...prev,
          {
            id: cartId,
            productId: product.id,
            name: product.name,
            formatKey: resolvedFormatKey,
            formatLabel,
            priceLabel: formatCurrency(priceValue),
            priceValue,
            quantity: 1,
            thumbnailUrl,
          },
        ];
      }
      return prev.map((item, index) =>
        index === existingIndex
          ? { ...item, quantity: item.quantity + 1 }
          : item
      );
    });
    showSuccess("Товар добавлен");
  };

  const removeFromCart = (id: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleToggleSidebar = () => {
    setIsCartOpen(false);
    setIsSidebarOpen((prev) => !prev);
  };

  const handleToggleCart = () => {
    setIsSidebarOpen(false);
    router.push("/profile");
  };

  const handleCheckout = () => {
    setIsCartOpen(false);
    router.push("/checkout");
  };

  const handleLogout = async () => {
    try {
      await fetch(`${apiBase}/api/users/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      setUserProfile(null);
    }
  };

  const toggleRenderMode = (mode: RenderMode) => {
    setRenderMode((prev) => {
      if (prev === mode) {
        return previousRenderModeRef.current ?? "final";
      }
      previousRenderModeRef.current = prev;
      return mode;
    });
  };

  const handleZoom = (direction: "in" | "out") => {
    const controls = controlsRef.current;
    const camera = controls?.object;
    if (!controls || !camera) {
      return;
    }
    const target = controls.target ? controls.target.clone() : new Vector3();
    const offset = camera.position.clone().sub(target);
    const distance = offset.length();
    if (distance === 0) {
      return;
    }
    const minDistance =
      typeof controls.minDistance === "number" ? controls.minDistance : 2;
    const maxDistance =
      typeof controls.maxDistance === "number" ? controls.maxDistance : 10;
    const step = Math.max(distance * 0.1, 0.25);
    const nextDistance =
      direction === "in"
        ? Math.max(distance - step, minDistance)
        : Math.min(distance + step, maxDistance);
    const endPosition = target.clone().add(offset.normalize().multiplyScalar(nextDistance));
    const startPosition = camera.position.clone();
    const duration = 260;
    const startTime = performance.now();
    if (zoomAnimationRef.current) {
      cancelAnimationFrame(zoomAnimationRef.current);
    }

    const animate = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1);
      const eased =
        progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
      camera.position.lerpVectors(startPosition, endPosition, eased);
      controls.update?.();
      if (progress < 1) {
        zoomAnimationRef.current = requestAnimationFrame(animate);
      }
    };
    zoomAnimationRef.current = requestAnimationFrame(animate);
  };
  const standbyMessage = productsError
    ? "System Standby: No Data"
    : dataLoading
      ? "Loading Data..."
      : emptyCategoryMessage;
  const seoJsonLd = useMemo(() => {
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(
      /\/$/,
      ""
    );
    const items = normalizedProducts.slice(0, 24).map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: product.name,
      url: `${siteUrl}/product/${product.slug || product.id}`,
    }));
    const organization = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "3D-STORE",
      url: siteUrl,
      logo: `${siteUrl}/backgrounds/bg_lab.png`,
    };
    const itemList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: items,
    };
    return JSON.stringify([organization, itemList]);
  }, [normalizedProducts]);

  if (!isMounted) {
    return (
      <div className="relative min-h-screen bg-[#050505] text-white">
        <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#050505] text-white font-[var(--font-inter)]">
      <ToastContainer toasts={toasts} onRemove={removeToast} position="top-right" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: seoJsonLd }}
      />
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur">
          <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#0b0b0b] p-6 shadow-2xl">
            <button
              type="button"
              aria-label="Close auth modal"
              className="absolute right-4 top-4 text-white/60 transition hover:text-white"
              onClick={() => setAuthModalOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
            <AuthForm
              onSuccess={() => {
                refreshUser();
                setAuthModalOpen(false);
                router.push("/profile");
              }}
              redirectOnSuccess={false}
            />
          </div>
        </div>
      )}
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40 page-bg-fade" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.2),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
      </div>
      <GlobalHudMarkers />
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchSuggestions={searchSuggestions}
        onSearchCommit={commitSearch}
        onSearchPick={(value) => {
          setSearchQuery(value);
          commitSearch(value);
        }}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        cartCount={cartCount}
        onCartToggle={handleToggleCart}
        favoritesCount={favorites.length}
        isLoggedIn={Boolean(userProfile?.id)}
        userLabel={userLabel}
        onLogout={handleLogout}
        hasUnreadStatus={hasUnreadStatus}
        onPrint={handleHeaderPrint}
      />
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            className="fixed inset-0 z-30 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              aria-label="Close sidebar"
              className="absolute inset-0 bg-black/60"
              onClick={() => setIsSidebarOpen(false)}
            />
            <motion.div
              className="relative h-full w-[85%] max-w-[320px] bg-[#050505]"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "tween", duration: 0.25 }}
            >
              <Sidebar
                format={format}
                onFormatChange={setFormat}
                technology={technology}
                onTechnologyChange={setTechnology}
                  verified={verified}
                  onVerifiedChange={setVerified}
                  useGlobalCatalog={useGlobalCatalog}
                  onGlobalCatalogChange={setUseGlobalCatalog}
                  categories={sidebarCategories}
                  activeCategory={activeCategory}
                  onCategoryChange={setActiveCategory}
                  onRequestClose={() => setIsSidebarOpen(false)}
                className="h-full w-full overflow-y-auto rounded-none border-r border-white/10 pt-20"
              />
              <button
                type="button"
                aria-label="Close sidebar"
                className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white"
                onClick={() => setIsSidebarOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isCartOpen && (
          <motion.div
            className="fixed inset-0 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              aria-label="Close cart"
              className="absolute inset-0 bg-black/60"
              onClick={() => setIsCartOpen(false)}
            />
            <motion.div
              className="absolute right-0 top-0 flex h-full w-full max-w-[360px] flex-col bg-black/60 p-5 backdrop-blur-xl md:max-w-[420px]"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.25 }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Ваша корзина</h3>
                <button
                  type="button"
                  aria-label="Close cart"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white"
                  onClick={() => setIsCartOpen(false)}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {cartItems.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center text-white/70">
                  <p className="text-sm uppercase tracking-[0.3em]">Ваша корзина пуста</p>
                  <button
                    type="button"
                    className="mt-4 text-sm text-white underline underline-offset-4"
                    onClick={() => setIsCartOpen(false)}
                  >
                    Вернуться к покупкам
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-5 flex-1 space-y-3 overflow-y-auto pr-1">
                    {cartItems.map((item) => {
                      const resolvedCartThumb =
                        forceProxyMedia && isExternalUrl(item.thumbnailUrl)
                          ? buildProxyUrlFromSource(item.thumbnailUrl) ?? item.thumbnailUrl
                          : item.thumbnailUrl;
                      return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"
                      >
                        <img
                          src={resolvedCartThumb}
                          alt={item.name}
                          loading="lazy"
                          decoding="async"
                          onError={(event) => {
                            const img = event.currentTarget;
                            if (img.dataset.fallbackApplied === "1") {
                              img.src = buildCartThumbnail(item.name);
                              return;
                            }
                            img.dataset.fallbackApplied = "1";
                            const proxy = forceProxyMedia ? null : buildProxyUrlFromSource(img.src);
                            img.src = proxy ?? buildCartThumbnail(item.name);
                          }}
                          className="h-14 w-14 rounded-xl object-cover"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">{item.name}</p>
                          <p className="text-xs text-white/60">{item.formatLabel}</p>
                          <p className="text-xs text-white/50">{item.priceLabel}</p>
                        </div>
                        <button
                          type="button"
                          aria-label="Remove"
                          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white"
                          onClick={() => removeFromCart(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                    })}
                  </div>
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <div className="flex items-center justify-between text-sm text-white/80">
                      <span>Итого</span>
                      <span className="text-base font-semibold text-white">{cartTotalLabel}</span>
                    </div>
                    <button
                      type="button"
                      className="mt-4 w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
                      onClick={handleCheckout}
                    >
                      Оформить заказ
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {showPortalHero && (
        <section
          ref={heroEntranceRef}
          className="relative z-10 flex min-h-[100svh] items-center justify-center overflow-hidden px-4 pt-24 sm:px-6"
          onMouseMove={handleHeroParallax}
          onMouseLeave={resetHeroParallax}
        >
        <motion.img
          src={HERO_PORTAL_IMAGE}
          alt="Portal background"
          className="absolute inset-0 -z-10 h-full w-full object-cover"
          style={{
            x: heroParallaxXSpring,
            y: heroParallaxYSpring,
            scale: 1.05,
          }}
          loading="eager"
          decoding="async"
        />
        <div
          className="pointer-events-none absolute inset-0 -z-10 hero-portal-mask"
          style={{
            maskImage: `url(${HERO_PORTAL_MASK})`,
            WebkitMaskImage: `url(${HERO_PORTAL_MASK})`,
          }}
        />
        <div className="pointer-events-none absolute inset-0 -z-10 hero-portal-rotor" />
        <div className="pointer-events-none absolute inset-0 -z-10 hero-portal-sweep" />
        <div className="pointer-events-none absolute inset-0 -z-10 hero-portal-rays" />
        <div className="pointer-events-none absolute inset-0 -z-10 hero-portal-glitch" />
        <div className="pointer-events-none absolute inset-0 -z-10 hero-vignette" />
        <div className="pointer-events-none absolute inset-0 -z-10 hero-particles">
          {heroParticles.map((particle) => (
            <span
              key={particle.id}
              style={{
                left: particle.left,
                width: `${particle.size}px`,
                height: `${particle.size}px`,
                animationDuration: `${particle.duration}s`,
                animationDelay: `${particle.delay}s`,
                opacity: particle.opacity,
              }}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 -z-10 hero-sphere-pulse" />
        <div className="pointer-events-none absolute bottom-[-6%] left-[-10%] right-[-10%] -z-10 hero-fog" />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center text-center">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.55em] text-white/60"
          >
            3D STORE · LAB ENTRY
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 24, filter: "blur(18px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.9, ease: "easeOut", delay: 0.2 }}
            className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl"
          >
            СОВЕРШЕНСТВО В КАЖДОМ АТОМЕ
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
            className="mt-4 max-w-2xl text-sm text-white/70 sm:text-base"
          >
            От идеи до физического объекта: цифровые модели, печать и визуализация в единой лаборатории точности.
          </motion.p>
          <motion.button
            type="button"
            onClick={() => heroSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.65 }}
            className="mt-8 rounded-full border border-[#2ED1FF]/50 bg-[#0b0b0b]/80 px-8 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(46,209,255,0.25)] transition hover:border-[#2ED1FF] hover:shadow-[0_0_32px_rgba(46,209,255,0.45)]"
          >
            В магазин
          </motion.button>
          <motion.button
            type="button"
            onClick={() => heroSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="mt-10 flex flex-col items-center gap-2 text-xs uppercase tracking-[0.35em] text-white/60"
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <span>Прокрутите вниз</span>
            <ChevronDown className="h-5 w-5 text-[#2ED1FF]" />
          </motion.button>
        </div>
        </section>
      )}
      <div className="relative z-10 mx-auto max-w-[1400px] px-4 pb-28 pt-44 sm:px-6 sm:pb-24 sm:pt-32 md:pt-28">
        <div className="grid gap-6 lg:gap-8 md:grid-cols-[280px_1fr] md:items-start">
          <Sidebar
            format={format}
            onFormatChange={setFormat}
            technology={technology}
            onTechnologyChange={setTechnology}
              verified={verified}
              onVerifiedChange={setVerified}
              useGlobalCatalog={useGlobalCatalog}
              onGlobalCatalogChange={setUseGlobalCatalog}
              categories={sidebarCategories}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
            className="hidden md:flex md:self-start"
          />
          <main className="space-y-8 lg:space-y-10">
            <motion.section
              ref={heroSectionRef}
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="space-y-4 scroll-mt-24 sm:space-y-6 sm:scroll-mt-28"
            >
              <motion.div
                variants={itemVariants}
                className="relative overflow-hidden rounded-[32px] border border-white/5 bg-white/[0.02] p-4 sm:p-6 rim-light"
              >
                  <HUD
                    polyCount={heroPolyCount}
                    printTime={heroPrintTime ?? (heroEstimatedPrintTime ? `≈ ${heroEstimatedPrintTime}` : null)}
                    scale={heroScale}
                    dimensions={heroDimensions}
                  />
                <div className="relative z-10 h-[360px] w-full overflow-hidden rounded-3xl bg-[#070707] inner-depth sm:h-[360px] lg:h-[420px]">
                  <AnimatePresence initial={false}>
                    {isInterior && interiorBackgroundUrl ? (
                      <motion.div
                        key={interiorBackgroundUrl}
                        className="absolute inset-0 z-0 bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${interiorBackgroundUrl})`,
                          filter: "blur(6px) brightness(0.5)",
                        }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5 }}
                      />
                    ) : (
                      <motion.div
                        key="obsidian-grid"
                        className="absolute inset-0 z-0 bg-[#070707]"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5 }}
                      >
                        <div className="absolute inset-0 cad-grid-pattern opacity-40" />
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(46,209,255,0.08),transparent_60%)]" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="relative z-10 h-full w-full">
                    {showHeroStandby ? (
                      <SystemStandbyPanel message={heroStandbyMessage} className="h-full" />
                    ) : !heroVisible ? (
                      <SystemStandbyPanel message="3D ПРОСМОТР ГОТОВИТСЯ" className="h-full" />
                    ) : (
                      <ErrorBoundary
                        resetKey={`${currentProduct?.id ?? "none"}:${modelRetryKey}`}
                        onError={handleModelError}
                        fallback={
                          <SystemStandbyPanel
                            message="3D System Standby"
                            className="h-full"
                            actionLabel="Повторить"
                            onAction={handleModelRetry}
                          />
                        }
                      >
                        <Experience
                          autoRotate={autoRotate && heroInView && isPageVisible}
                          renderMode={renderMode}
                          finish={finish}
                          preview={preview}
                          lightingMode={lightingMode}
                          accentColor={activeColor}
                          rawModelUrl={heroRawModelUrl}
                          paintedModelUrl={heroPaintedModelUrl}
                          modelScale={currentProduct?.modelScale ?? null}
                          controlsRef={controlsRef}
                          onBounds={handleHeroBounds}
                          onStats={(stats) => {
                            setHeroPolyCountComputed(stats.polyCount);
                            handleModelReady();
                          }}
                          onReady={handleModelReady}
                          />
                      </ErrorBoundary>
                    )}
                    {heroModelStalled && !heroModelReady && !showHeroStandby && heroVisible && (
                      <div className="pointer-events-auto absolute inset-0 z-20">
                        <SystemStandbyPanel
                          message="МОДЕЛЬ ГРУЗИТСЯ СЛИШКОМ ДОЛГО"
                          className="h-full"
                          actionLabel="Повторить"
                          onAction={handleModelRetry}
                        />
                      </div>
                    )}
                    <AnimatePresence>
                      {isScanning && !showHeroStandby && (
                        <motion.div
                          key={scanPulse}
                          className="pointer-events-none absolute inset-0 z-10"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(46,209,255,0.18),transparent_45%,rgba(46,209,255,0.12))]" />
                          <motion.div
                            className="absolute left-0 right-0 h-16 bg-[#2ED1FF]/25 blur-sm"
                            initial={{ y: "-20%" }}
                            animate={{ y: "120%" }}
                            transition={{ duration: 0.5, ease: "easeInOut" }}
                          />
                          <div className="absolute inset-0 border border-[#2ED1FF]/15" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
                {canQuickSwitch && (
                  <>
                    <button
                      type="button"
                      aria-label="Предыдущая модель"
                      className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-white/5 p-2.5 text-white/70 transition hover:text-white sm:left-8 sm:p-3"
                      onClick={handlePrev}
                    >
                      <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Следующая модель"
                      className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-white/5 p-2.5 text-white/70 transition hover:text-white sm:right-8 sm:p-3"
                      onClick={handleNext}
                    >
                      <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                  </>
                )}
                  <div className="absolute inset-x-4 bottom-2 z-50 flex flex-col items-stretch gap-2 pb-[env(safe-area-inset-bottom)] sm:inset-x-8 sm:bottom-8 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
                  <div className="order-1 w-full sm:max-w-[420px] sm:w-auto">
                  <p className="text-[8px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-white/60 sm:text-[10px]">
                    TECH_ID: {heroSku}
                  </p>
                    <h2 className="text-lg font-bold italic leading-tight tracking-[0.01em] text-white sm:text-xl lg:text-2xl">
                      {heroName}
                    </h2>
                  <div className="mt-2 flex flex-col gap-2 sm:mt-4 sm:flex-row sm:items-center sm:gap-4">
                    <span className="text-lg font-semibold text-white sm:text-xl lg:text-2xl">
                      {heroPriceLabel}
                    </span>
                      <div className="flex w-full items-center gap-2 sm:w-auto">
                        <button
                          type="button"
                          aria-label="В корзину"
                          title="В корзину"
                          className="group flex h-12 w-12 items-center justify-center rounded-full bg-[#2ED1FF]/25 text-[#2ED1FF] shadow-[0_0_14px_rgba(46,209,255,0.25)] transition hover:bg-[#2ED1FF]/35 sm:h-9 sm:w-9"
                          onClick={() => currentProduct && addToCart(currentProduct)}
                        >
                          <ShoppingCart className="h-4 w-4" />
                          <span className="sr-only">В корзину</span>
                        </button>
                        {isCurrentDigital &&
                          (currentProduct?.rawModelUrl || currentProduct?.paintedModelUrl) && (
                          <button
                            type="button"
                            aria-label="Заказать печать"
                            title="Заказать печать"
                            className="group flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 transition hover:border-[#2ED1FF]/60 hover:text-white sm:h-9 sm:w-9"
                            onClick={() => currentProduct && handleOrderPrint(currentProduct)}
                          >
                            <Printer className="h-4 w-4" />
                            <span className="sr-only">Заказать печать</span>
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={isCurrentFavorite ? "В избранном" : "В избранное"}
                          title={isCurrentFavorite ? "В избранном" : "В избранное"}
                          className={`group flex h-12 w-12 items-center justify-center rounded-full border text-[10px] uppercase tracking-[0.12em] transition sm:h-9 sm:w-9 ${
                          isCurrentFavorite
                            ? "border-rose-400/60 bg-rose-500/10 text-rose-200 shadow-[0_0_18px_rgba(244,63,94,0.35)]"
                            : "border-white/15 bg-white/5 text-white/70 hover:text-white"
                        }`}
                        onClick={() =>
                          currentProduct && toggleFavorite(buildFavoriteItem(currentProduct))
                        }
                      >
                        <Heart
                          className="h-4 w-4"
                          fill={isCurrentFavorite ? "currentColor" : "none"}
                        />
                        <span className="sr-only">
                          {isCurrentFavorite ? "В избранном" : "В избранное"}
                        </span>
                      </button>
                    </div>
                  </div>
                  </div>
                  <div className="order-3 hidden w-full items-center justify-start gap-2 overflow-x-auto rounded-full px-3.5 py-2 glass-dock border-white/15 bg-white/5 sm:flex sm:flex-wrap sm:justify-center sm:overflow-visible sm:gap-4 sm:px-5 sm:py-2.5">
                  <DockButton
                    active={autoRotate}
                    label="Авто-поворот"
                    compactLabel="Авто"
                    icon={<RotateCw className="h-4 w-4" />}
                    onClick={() => setAutoRotate((prev) => !prev)}
                  />
                  <DockButton
                    active={false}
                    label="Zoom +"
                    compactLabel="Zoom +"
                    icon={<ZoomIn className="h-4 w-4" />}
                    onClick={() => handleZoom("in")}
                  />
                  <DockButton
                    active={false}
                    label="Zoom -"
                    compactLabel="Zoom -"
                    icon={<ZoomOut className="h-4 w-4" />}
                    onClick={() => handleZoom("out")}
                  />
                  <DockButton
                    active={preview === "interior"}
                    label="В интерьере"
                    compactLabel="Интерьер"
                    icon={<Scan className="h-4 w-4" />}
                    onClick={() =>
                      setPreview((prev) => (prev === "interior" ? "default" : "interior"))
                    }
                  />
                  <DockButton
                    active={preview === "ar"}
                    label="AR-просмотр"
                    compactLabel="AR"
                    icon={<Sparkles className="h-4 w-4" />}
                    onClick={() =>
                      setPreview((prev) => (prev === "ar" ? "default" : "ar"))
                    }
                  />
                  </div>
                  <div className="order-2 relative hidden w-full flex-wrap items-center gap-2 rounded-full bg-white/5 px-3 py-2 font-[var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-white/70 sm:flex sm:w-auto sm:text-xs">
                    <button
                      type="button"
                      aria-expanded={isWorkshopOpen}
                      className={`rounded-full min-h-[44px] px-3 py-2 transition sm:min-h-0 sm:px-3 sm:py-1 ${
                        isWorkshopOpen
                          ? "bg-white/15 text-white"
                          : "text-white/50 hover:text-white"
                      }`}
                      onClick={() => setWorkshopOpen((prev) => !prev)}
                    >
                      Мастерская
                    </button>
                    <AnimatePresence>
                      {isWorkshopOpen && (
                        <motion.div
                          className="absolute bottom-full right-0 z-20 mb-3 w-[320px] min-w-[280px] max-w-[calc(100vw-32px)] rounded-2xl border border-white/10 bg-[#0b0b0b]/80 p-6 text-[10px] text-white/70 shadow-2xl backdrop-blur-xl"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 6 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-white/40">
                                ОСВЕЩЕНИЕ
                              </p>
                                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white/5 p-1">
                                  {lightingPresets.map((option) => {
                                    const isActive = lightingMode === option.value;
                                    return (
                                      <button
                                        key={option.value}
                                        type="button"
                                        className={`rounded-full px-2 py-1.5 text-[11px] font-semibold font-[var(--font-inter)] transition ${
                                          isActive
                                            ? "bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.18)]"
                                            : "text-white/50 hover:text-white"
                                          }`}
                                        onClick={() => setLightingMode(option.value)}
                                      >
                                        {option.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            <div className="space-y-2">
                              <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-white/40">
                                ВИД
                              </p>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  className={`flex min-h-[36px] items-center justify-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold font-[var(--font-inter)] transition ${
                                    isWireframeActive
                                      ? "bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.18)]"
                                      : "text-white/50 hover:text-white"
                                  }`}
                                  onClick={() => toggleRenderMode("wireframe")}
                                >
                                  <Layers className="h-3.5 w-3.5" />
                                  Сетка
                                </button>
                                <button
                                  type="button"
                                  className={`flex min-h-[36px] items-center justify-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold font-[var(--font-inter)] transition ${
                                    isBaseActive
                                      ? "bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.18)]"
                                      : "text-white/50 hover:text-white"
                                  }`}
                                  onClick={() => toggleRenderMode("base")}
                                >
                                  <Palette className="h-3.5 w-3.5" />
                                  Чистый цвет
                                </button>
                              </div>
                            </div>
                            {isSlaProduct && (
                              <div className="space-y-2">
                                <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-white/40">
                                  МАТЕРИАЛ
                                </p>
                                <div className="flex rounded-full bg-white/5 p-1">
                                  <button
                                    type="button"
                                    className={`flex-1 rounded-full px-3 py-1.5 text-[11px] font-semibold font-[var(--font-inter)] transition ${
                                      isBaseActive
                                        ? "bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.18)]"
                                        : "text-white/50 hover:text-white"
                                    }`}
                                    onClick={handleWorkshopBase}
                                  >
                                    База (серый)
                                  </button>
                                  <button
                                    type="button"
                                    className={`flex-1 rounded-full px-3 py-1.5 text-[11px] font-semibold font-[var(--font-inter)] transition ${
                                      !isBaseActive
                                        ? "bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.18)]"
                                        : "text-white/50 hover:text-white"
                                    }`}
                                    onClick={handleWorkshopPaint}
                                  >
                                    Покраска
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="fixed inset-x-4 bottom-2 z-40 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-[#0b0f12]/85 px-3 py-2 font-[var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.14em] text-white/70 shadow-[0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:hidden">
                    <DockButton
                      active={autoRotate}
                      label="Авто-поворот"
                      compactLabel="Авто"
                      icon={<RotateCw className="h-4 w-4" />}
                      fullWidth
                      onClick={() => setAutoRotate((prev) => !prev)}
                    />
                    <DockButton
                      active={false}
                      label="Zoom +"
                      compactLabel="Zoom +"
                      icon={<ZoomIn className="h-4 w-4" />}
                      fullWidth
                      onClick={() => handleZoom("in")}
                    />
                    <DockButton
                      active={false}
                      label="Zoom -"
                      compactLabel="Zoom -"
                      icon={<ZoomOut className="h-4 w-4" />}
                      fullWidth
                      onClick={() => handleZoom("out")}
                    />
                    <DockButton
                      active={preview === "interior"}
                      label="В интерьере"
                      compactLabel="Интерьер"
                      icon={<Scan className="h-4 w-4" />}
                      fullWidth
                      onClick={() =>
                        setPreview((prev) => (prev === "interior" ? "default" : "interior"))
                      }
                    />
                    <DockButton
                      active={preview === "ar"}
                      label="AR-просмотр"
                      compactLabel="AR"
                      icon={<Sparkles className="h-4 w-4" />}
                      fullWidth
                      onClick={() =>
                        setPreview((prev) => (prev === "ar" ? "default" : "ar"))
                      }
                    />
                    <DockButton
                      active={isWorkshopOpen}
                      label="Мастерская"
                      compactLabel="Мастер"
                      icon={<Palette className="h-4 w-4" />}
                      fullWidth
                      onClick={() => setWorkshopOpen((prev) => !prev)}
                    />
                    <AnimatePresence>
                      {isWorkshopOpen && (
                        <motion.div
                          className="absolute bottom-full left-0 right-0 mb-3 rounded-2xl border border-white/10 bg-[#0b0b0b]/90 p-4 text-[10px] text-white/70 shadow-2xl backdrop-blur-xl"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-white/40">
                                ОСВЕЩЕНИЕ
                              </p>
                                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white/5 p-1">
                                  {lightingPresets.map((option) => {
                                    const isActive = lightingMode === option.value;
                                    return (
                                      <button
                                        key={option.value}
                                        type="button"
                                        className={`rounded-full px-2 py-1.5 text-[11px] font-semibold font-[var(--font-inter)] transition ${
                                          isActive
                                            ? "bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.18)]"
                                            : "text-white/50 hover:text-white"
                                          }`}
                                        onClick={() => setLightingMode(option.value)}
                                      >
                                        {option.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            <div className="space-y-2">
                              <p className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-white/40">
                                ВИД
                              </p>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  className={`flex min-h-[36px] items-center justify-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold font-[var(--font-inter)] transition ${
                                    isWireframeActive
                                      ? "bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.18)]"
                                      : "text-white/50 hover:text-white"
                                  }`}
                                  onClick={() => toggleRenderMode("wireframe")}
                                >
                                  <Layers className="h-3.5 w-3.5" />
                                  Сетка
                                </button>
                                <button
                                  type="button"
                                  className={`flex min-h-[36px] items-center justify-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold font-[var(--font-inter)] transition ${
                                    isBaseActive
                                      ? "bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.18)]"
                                      : "text-white/50 hover:text-white"
                                  }`}
                                  onClick={() => toggleRenderMode("base")}
                                >
                                  <Palette className="h-3.5 w-3.5" />
                                  Чистый цвет
                                </button>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            </motion.section>

            <motion.section
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="space-y-4 sm:space-y-5"
            >
              <motion.div variants={itemVariants} className="flex items-center gap-2 sm:gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 sm:h-10 sm:w-10">
                  <ShieldCheck className="h-4 w-4 text-[#D4AF37] sm:h-5 sm:w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/40 sm:text-xs">
                    ПРОВЕРЕННЫЕ КОЛЛЕКЦИИ
                  </p>
                  <h3 className="text-xl font-semibold text-white sm:text-2xl">
                    Отобранные подборки
                  </h3>
                </div>
              </motion.div>

              <motion.div
                variants={itemVariants}
                className="flex flex-wrap gap-2 md:hidden"
              >
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] transition ${
                    !useGlobalCatalog && format === "digital"
                      ? "border-[#2ED1FF]/70 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_12px_rgba(46,209,255,0.3)]"
                      : "border-white/15 bg-white/5 text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                  onClick={() => {
                    setUseGlobalCatalog(false);
                    setFormat("digital");
                  }}
                >
                  DIGITAL STL
                </button>
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] transition ${
                    !useGlobalCatalog && format === "physical"
                      ? "border-[#2ED1FF]/70 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_12px_rgba(46,209,255,0.3)]"
                      : "border-white/15 bg-white/5 text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                  onClick={() => {
                    setUseGlobalCatalog(false);
                    setFormat("physical");
                  }}
                >
                  PHYSICAL
                </button>
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] transition ${
                    !useGlobalCatalog && technology === "SLA Resin"
                      ? "border-white/60 bg-white/15 text-white shadow-[0_0_12px_rgba(255,255,255,0.15)]"
                      : "border-white/15 bg-white/5 text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                  onClick={() => {
                    setUseGlobalCatalog(false);
                    setTechnology("SLA Resin");
                  }}
                >
                  SLA
                </button>
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] transition ${
                    !useGlobalCatalog && technology === "FDM Plastic"
                      ? "border-white/60 bg-white/15 text-white shadow-[0_0_12px_rgba(255,255,255,0.15)]"
                      : "border-white/15 bg-white/5 text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                  onClick={() => {
                    setUseGlobalCatalog(false);
                    setTechnology("FDM Plastic");
                  }}
                >
                  FDM
                </button>
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] transition ${
                    !useGlobalCatalog && verified
                      ? "border-[#D4AF37]/80 bg-[#3b2f12] text-[#D4AF37] shadow-[0_0_12px_rgba(212,175,55,0.25)]"
                      : "border-white/15 bg-white/5 text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                  onClick={() => {
                    setUseGlobalCatalog(false);
                    setVerified((prev) => !prev);
                  }}
                >
                  VERIFIED
                </button>
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] transition ${
                    useGlobalCatalog
                      ? "border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_12px_rgba(46,209,255,0.3)]"
                      : "border-white/15 bg-white/5 text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                  onClick={() => setUseGlobalCatalog((prev) => !prev)}
                >
                  GLOBAL
                </button>
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] text-white/50 transition hover:border-white/30 hover:text-white"
                  onClick={() => {
                    setUseGlobalCatalog(false);
                    setVerified(false);
                    setActiveCategory("");
                    setSearchQuery("");
                  }}
                >
                  СБРОС
                </button>
              </motion.div>

              <ErrorBoundary fallback={<SystemStandbyPanel message="System Standby: No Data" />}>
                {showSystemStandby ? (
                  <SystemStandbyPanel message={standbyMessage} className="min-h-[200px] sm:min-h-[240px]" />
                ) : (
                  <motion.div
                    variants={containerVariants}
                    className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3"
                  >
                    {filteredProducts?.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        isSelected={product.id === currentModelId}
                        onClick={() => handleProductSelect(product.id, { scroll: true })}
                        isFavorite={isFavorite(product.id)}
                        onToggleFavorite={() => toggleFavorite(buildFavoriteItem(product))}
                        onAddToCart={() => addToCart(product)}
                        onOrderPrint={() => handleOrderPrint(product)}
                        forceProxyMedia={forceProxyMedia}
                      />
                    ))}
                  </motion.div>
                )}
              </ErrorBoundary>
            </motion.section>
          </main>
        </div>
      </div>
    </div>
  );
}

type HeaderProps = {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchSuggestions: SearchSuggestion[];
  onSearchCommit: (value: string) => void;
  onSearchPick: (value: string) => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  cartCount: number;
  onCartToggle: () => void;
  favoritesCount: number;
  isLoggedIn: boolean;
  userLabel: string;
  onLogout: () => void;
  hasUnreadStatus: boolean;
  onPrint?: () => void;
};

const suggestionTypeLabel: Record<SearchSuggestion["type"], string> = {
  product: "модель",
  category: "категория",
  sku: "sku",
  recent: "история",
};

type SearchSuggestionsProps = {
  suggestions: SearchSuggestion[];
  onPick: (value: string) => void;
  className?: string;
};

function SearchSuggestions({ suggestions, onPick, className }: SearchSuggestionsProps) {
  if (!suggestions.length) return null;

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-[#0b0f12]/95 p-2 text-xs text-white/80 shadow-[0_12px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl ${
        className ?? ""
      }`}
    >
      <p className="px-2 py-1 text-[9px] uppercase tracking-[0.35em] text-white/40">
        Быстрый поиск
      </p>
      <div className="space-y-1">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/5 hover:text-white"
            onClick={() => onPick(suggestion.label)}
          >
            <span className="truncate">{suggestion.label}</span>
            <span className="text-[9px] uppercase tracking-[0.3em] text-white/40">
              {suggestionTypeLabel[suggestion.type]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Header({
  searchQuery,
  onSearchChange,
  searchSuggestions,
  onSearchCommit,
  onSearchPick,
  isSidebarOpen,
  onToggleSidebar,
  cartCount,
  onCartToggle,
  favoritesCount,
  isLoggedIn,
  userLabel,
  onLogout,
  hasUnreadStatus,
  onPrint,
}: HeaderProps) {
  const router = useRouter();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [cartPopKey, setCartPopKey] = useState(0);
  const prevCartCountRef = useRef(cartCount);
  const logoReturnArmedRef = useRef(false);

  useEffect(() => {
    if (isSearchOpen) {
      inputRef.current?.focus();
    }
  }, [isSearchOpen]);

  useEffect(() => {
    if (cartCount > prevCartCountRef.current) {
      setCartPopKey((prev) => prev + 1);
    }
    prevCartCountRef.current = cartCount;
  }, [cartCount]);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 32) {
        logoReturnArmedRef.current = false;
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleLogoClick = () => {
    if (typeof window === "undefined") {
      router.push("/");
      return;
    }
    if (window.scrollY > 32) {
      logoReturnArmedRef.current = true;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    logoReturnArmedRef.current = false;
    router.push("/");
  };

  const toggleSearch = () => {
    setIsSearchOpen((prev) => {
      if (prev) {
        onSearchChange("");
      }
      return !prev;
    });
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      onSearchCommit(event.currentTarget.value);
    }
    if (event.key === "Escape") {
      onSearchChange("");
      setIsSearchOpen(false);
      event.currentTarget.blur();
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-30 border-b border-white/10 bg-obsidian/60 backdrop-blur-xl shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6 sm:py-5 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-6"
      >
        <motion.div variants={itemVariants} className="flex items-center gap-3 sm:gap-4">
          <div>
            <button
              type="button"
              onClick={handleLogoClick}
              className="block text-left transition hover:opacity-80"
              aria-label="На портал"
            >
              <h1 className="text-xl font-bold tracking-[0.2em] text-white sm:text-3xl">
                3D-STORE
              </h1>
            </button>
            <div className="mt-1 hidden items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50 sm:text-xs md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
              <span>СИСТЕМА: ONLINE</span>
            </div>
          </div>
        </motion.div>

        <motion.nav
          variants={itemVariants}
          className="hidden items-center justify-center gap-4 text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] md:flex"
        >
          <a
            href="/ai-lab"
            className="rounded-full border border-white/15 bg-white/5 px-5 py-2 text-[10px] uppercase tracking-[0.35em] text-white/70 transition hover:border-[#2ED1FF]/60 hover:text-white"
          >
            AI ЛАБОРАТОРИЯ
          </a>
          <button
            type="button"
            onClick={() => {
              if (onPrint) {
                onPrint();
                return;
              }
              router.push("/services/print");
            }}
            className="rounded-full border border-[#2ED1FF] bg-[#0b1014] px-5 py-2 text-[10px] uppercase tracking-[0.35em] text-[#BFF4FF] shadow-[0_0_18px_rgba(46,209,255,0.45)] transition hover:border-[#7FE7FF] hover:text-white"
          >
            ПЕЧАТЬ НА ЗАКАЗ
          </button>
        </motion.nav>

        <motion.div
          variants={itemVariants}
          className="flex items-center gap-2 md:justify-end md:gap-3"
        >
          <button
            type="button"
            onClick={() => {
              if (onPrint) {
                onPrint();
                return;
              }
              router.push("/services/print");
            }}
            className="hidden rounded-full border border-[#2ED1FF] bg-[#0b1014] px-3 py-2 text-[8px] uppercase tracking-[0.28em] text-[#BFF4FF] shadow-[0_0_12px_rgba(46,209,255,0.4)] transition hover:border-[#7FE7FF] sm:inline-flex md:hidden"
          >
            ПЕЧАТЬ НА ЗАКАЗ
          </button>
          <a
            href="/ai-lab"
            className="hidden rounded-full border border-white/15 bg-white/5 px-3 py-2 text-[8px] uppercase tracking-[0.28em] text-white/70 transition hover:border-[#2ED1FF]/60 hover:text-white sm:inline-flex md:hidden"
          >
            AI ЛАБОРАТОРИЯ
          </a>
          <button
            type="button"
            aria-label="Toggle sidebar"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white sm:h-11 sm:w-11 md:hidden"
            onClick={onToggleSidebar}
          >
            {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <button
            type="button"
            aria-label="Поиск"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white sm:h-11 sm:w-11 md:hidden"
            onClick={toggleSearch}
          >
            {isSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
          {isSearchOpen && (
            <div className="relative hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 md:flex">
              <input
                ref={inputRef}
                type="search"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Поиск: название, категория, артикул"
                className="w-52 bg-transparent text-xs uppercase tracking-[0.2em] text-white/80 placeholder:text-white/40 focus:outline-none"
              />
              <SearchSuggestions
                suggestions={searchSuggestions}
                onPick={onSearchPick}
                className="absolute left-0 right-0 top-full z-40 mt-3"
              />
            </div>
          )}
          <button
            type="button"
            aria-label="Поиск"
            className="hidden h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:border-white/35 hover:bg-white/10 hover:text-white hover:shadow-[0_0_12px_rgba(191,244,255,0.22)] md:flex"
            onClick={toggleSearch}
          >
            {isSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
          <a
            href="/favorites"
            aria-label="Избранное"
            className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition sm:h-11 sm:w-11 md:h-10 md:w-10 ${
              favoritesCount > 0
                ? "border-rose-300/50 bg-rose-500/15 text-rose-100 shadow-[0_0_18px_rgba(244,63,94,0.45)] hover:border-rose-300/70"
                : "border-white/15 bg-white/5 text-white/80 hover:border-white/35 hover:bg-white/10 hover:text-white hover:shadow-[0_0_12px_rgba(191,244,255,0.22)]"
            }`}
          >
            <Heart className="h-5 w-5" fill={favoritesCount > 0 ? "currentColor" : "none"} />
            {favoritesCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-400 text-[10px] font-semibold text-[#050505] shadow-[0_0_10px_rgba(244,63,94,0.45)]">
                {favoritesCount}
              </span>
            )}
          </a>
          <button
            type="button"
            aria-label="Корзина"
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:border-[#2ED1FF]/50 hover:bg-white/10 hover:text-white hover:shadow-[0_0_12px_rgba(46,209,255,0.25)] sm:h-11 sm:w-11 md:h-10 md:w-10"
            onClick={onCartToggle}
          >
            <ShoppingCart className="h-5 w-5" />
            {cartCount > 0 && (
              <motion.span
                key={cartPopKey}
                initial={{ scale: 1, boxShadow: "0 0 0 rgba(46,209,255,0)" }}
                animate={{
                  scale: [1, 1.15, 1],
                  boxShadow: [
                    "0 0 0 rgba(46,209,255,0)",
                    "0 0 16px rgba(46,209,255,0.9)",
                    "0 0 0 rgba(46,209,255,0)",
                  ],
                }}
                transition={{ duration: 0.3 }}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#2ED1FF] text-[10px] font-semibold text-[#050505]"
              >
                {cartCount}
              </motion.span>
            )}
          </button>
          {isLoggedIn ? (
            <div className="relative hidden md:flex">
              <div className="group relative">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40 hover:text-white"
                >
                  <span className="relative flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5">
                    <User className="h-4 w-4" />
                    {hasUnreadStatus && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]" />
                    )}
                  </span>
                  <span className="max-w-[120px] truncate text-[10px] tracking-[0.3em]">
                    {userLabel}
                  </span>
                </button>
                <div className="pointer-events-none absolute right-0 top-full z-30 mt-3 w-52 translate-y-2 rounded-2xl border border-white/10 bg-[#0b0f12]/95 p-2 text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/80 opacity-0 shadow-2xl backdrop-blur-xl transition group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                  <a
                    href="/profile"
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-white/70 transition hover:bg-white/5 hover:text-white"
                  >
                    Профиль
                  </a>
                  <a
                    href="/profile"
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-white/70 transition hover:bg-white/5 hover:text-white"
                  >
                    Мои заказы
                  </a>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-rose-200 transition hover:bg-rose-500/10"
                    onClick={onLogout}
                  >
                    Выход
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <a
              href="/profile"
              aria-label="Профиль"
              className="relative hidden h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:border-white/35 hover:bg-white/10 hover:text-white hover:shadow-[0_0_12px_rgba(191,244,255,0.22)] md:flex"
            >
              <User className="h-5 w-5" />
              {hasUnreadStatus && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]" />
              )}
            </a>
          )}
        </motion.div>

        <motion.div
          variants={itemVariants}
          className="flex w-full items-center justify-center gap-1.5 sm:hidden"
        >
          <a
            href="/ai-lab"
            className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[8px] uppercase tracking-[0.26em] text-white/70 transition hover:border-[#2ED1FF]/60 hover:text-white"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#2ED1FF]" />
            AI
          </a>
          <button
            type="button"
            onClick={() => {
              if (onPrint) {
                onPrint();
                return;
              }
              router.push("/services/print");
            }}
            className="flex items-center gap-1 rounded-full border border-[#2ED1FF] bg-[#0b1014] px-2.5 py-1 text-[8px] uppercase tracking-[0.26em] text-[#BFF4FF] shadow-[0_0_10px_rgba(46,209,255,0.4)] transition hover:border-[#7FE7FF] hover:text-white"
          >
            <Printer className="h-3.5 w-3.5" />
            ПЕЧАТЬ
          </button>
        </motion.div>
        {isSearchOpen && (
          <motion.div
            variants={itemVariants}
            className="relative order-last flex w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.2em] text-white/70 md:hidden"
          >
            <Search className="h-4 w-4 text-white/50" />
            <input
              ref={inputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Поиск: название, категория, артикул"
              className="flex-1 bg-transparent text-[10px] uppercase tracking-[0.2em] text-white/80 placeholder:text-white/40 focus:outline-none"
            />
            <button
              type="button"
              aria-label="Закрыть поиск"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-white/60 transition hover:text-white"
              onClick={toggleSearch}
            >
              <X className="h-4 w-4" />
            </button>
            <SearchSuggestions
              suggestions={searchSuggestions}
              onPick={onSearchPick}
              className="absolute left-0 right-0 top-full z-40 mt-2"
            />
          </motion.div>
        )}
      </motion.div>
    </header>
  );
}

type SidebarProps = {
  format: FormatMode;
  onFormatChange: (value: FormatMode) => void;
  technology: TechMode;
  onTechnologyChange: (value: TechMode) => void;
  verified: boolean;
  onVerifiedChange: (value: boolean) => void;
  useGlobalCatalog: boolean;
  onGlobalCatalogChange: (value: boolean) => void;
  categories: SidebarCategory[];
  activeCategory: string;
  onCategoryChange: (value: string) => void;
  onRequestClose?: () => void;
  className?: string;
};

function Sidebar({
  format,
  onFormatChange,
  technology,
  onTechnologyChange,
  verified,
  onVerifiedChange,
  useGlobalCatalog,
  onGlobalCatalogChange,
  categories,
  activeCategory,
  onCategoryChange,
  onRequestClose,
  className,
}: SidebarProps) {
  const [isCategoryListOpen, setCategoryListOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const pinnedCategoryIds = new Set(["аниме", "аниме девушки"]);

  const toggleCategoryGroup = (categoryId: string) => {
    setExpandedCategories((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));
  };

  const resolveCategoryCount = (category: SidebarCategory): number => {
    if (!category.children?.length) {
      return category.count;
    }
    const nestedCount = category.children.reduce(
      (total, child) => total + resolveCategoryCount(child),
      0
    );
    return Math.max(category.count, nestedCount);
  };

  const isCategoryTreeActive = (category: SidebarCategory): boolean =>
    activeCategory === category.id ||
    Boolean(category.children?.some((child) => isCategoryTreeActive(child)));

  const shouldShowCategory = (category: SidebarCategory): boolean => {
    if (pinnedCategoryIds.has(category.id)) {
      return true;
    }
    if (isCategoryTreeActive(category)) {
      return true;
    }
    if (resolveCategoryCount(category) > 0) {
      return true;
    }
    return Boolean(category.children?.some((child) => pinnedCategoryIds.has(child.id)));
  };

  return (
    <motion.aside
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className={`flex flex-col space-y-5 rounded-[28px] border border-white/5 bg-white/[0.03] p-4 backdrop-blur-xl sm:space-y-6 sm:p-6 ${className ?? ""}`}
    >
      <motion.div variants={itemVariants} className="space-y-2 sm:space-y-3">
        <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50 sm:text-xs">
          Технология
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-full bg-white/5 p-1">
          <button
            type="button"
            className={`rounded-full min-h-[44px] px-2.5 py-2 text-[10px] uppercase tracking-[0.2em] transition sm:min-h-0 sm:px-3 sm:text-xs ${
              technology === "SLA Resin"
                ? "border border-white/25 bg-white/15 text-white shadow-[0_0_12px_rgba(255,255,255,0.12)]"
                : "border border-white/10 bg-white/5 text-white/60 hover:border-white/25 hover:text-white"
            }`}
            onClick={() => onTechnologyChange("SLA Resin")}
          >
            SLA Resin
          </button>
          <button
            type="button"
            className={`rounded-full min-h-[44px] px-2.5 py-2 text-[10px] uppercase tracking-[0.2em] transition sm:min-h-0 sm:px-3 sm:text-xs ${
              technology === "FDM Plastic"
                ? "border border-white/25 bg-white/15 text-white shadow-[0_0_12px_rgba(255,255,255,0.12)]"
                : "border border-white/10 bg-white/5 text-white/60 hover:border-white/25 hover:text-white"
            }`}
            onClick={() => onTechnologyChange("FDM Plastic")}
          >
            FDM Plastic
          </button>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-2 sm:space-y-3">
        <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50 sm:text-xs">
          Формат
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`rounded-2xl min-h-[44px] px-2.5 py-2 text-[10px] uppercase tracking-[0.2em] transition sm:min-h-0 sm:px-3 sm:text-xs ${
              format === "digital"
                ? "border border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_14px_rgba(46,209,255,0.3)]"
                : "border border-white/10 bg-white/5 text-white/70 hover:border-white/25 hover:text-white"
            }`}
            onClick={() => onFormatChange("digital")}
          >
            Цифровой STL
          </button>
          <button
            type="button"
            className={`rounded-2xl min-h-[44px] px-2.5 py-2 text-[10px] uppercase tracking-[0.2em] transition sm:min-h-0 sm:px-3 sm:text-xs ${
              format === "physical"
                ? "border border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_14px_rgba(46,209,255,0.3)]"
                : "border border-white/10 bg-white/5 text-white/70 hover:border-white/25 hover:text-white"
            }`}
            onClick={() => onFormatChange("physical")}
          >
            Печатная модель
          </button>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-2 sm:space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50 sm:text-xs">
              Каталог
            </p>
            {useGlobalCatalog && (
              <span className="rounded-full border border-[#2ED1FF]/40 bg-[#2ED1FF]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-[#9BE7FF]">
                GLOBAL
              </span>
            )}
          </div>
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10 text-[10px] text-white/40"
            title="В глобальном режиме игнорируются фильтры технологии, формата и проверки."
          >
            ?
          </span>
        </div>
        <button
          type="button"
          className={`flex w-full min-h-[44px] items-center justify-between rounded-xl px-2.5 py-2 text-left text-[13px] transition sm:min-h-0 sm:px-3 sm:text-sm ${
            useGlobalCatalog
              ? "border border-white/20 bg-white/10 text-white"
              : "border border-white/10 bg-white/5 text-white/70 hover:border-white/25 hover:text-white"
          }`}
          onClick={() => onGlobalCatalogChange(!useGlobalCatalog)}
        >
          <span>Показать все модели</span>
          <span className="flex items-center gap-2 text-[10px] font-[var(--font-jetbrains-mono)] uppercase sm:text-xs">
            <span
              className={`relative inline-flex h-4 w-8 items-center rounded-full border transition ${
                useGlobalCatalog
                  ? "border-[#2ED1FF]/50 bg-[#2ED1FF]/20"
                  : "border-white/15 bg-white/5"
              }`}
              aria-hidden="true"
            >
              <span
                className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full transition-transform ${
                  useGlobalCatalog
                    ? "translate-x-4 bg-[#2ED1FF]"
                    : "translate-x-0 bg-white/30"
                }`}
              />
            </span>
            <span className="text-white/50">{useGlobalCatalog ? "ON" : "OFF"}</span>
          </span>
        </button>
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-2 sm:space-y-3">
        <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50 sm:text-xs">
          Категории
        </p>
        <div className="space-y-2">
          <button
            type="button"
            className={`flex w-full min-h-[44px] items-center justify-between rounded-xl px-2.5 py-2 text-left text-[13px] transition sm:min-h-0 sm:px-3 sm:text-sm ${
              activeCategory
                ? "bg-white/5 text-white/60 hover:text-white"
                : "bg-white/10 text-white"
            }`}
            onClick={() => {
              setCategoryListOpen((prev) => !prev);
              if (activeCategory) {
                onCategoryChange("");
              }
            }}
          >
            <span>Все категории</span>
            <ChevronRight
              className={`h-4 w-4 text-white/60 transition ${
                isCategoryListOpen ? "rotate-90 text-white" : ""
              }`}
            />
          </button>
          <div className={`${isCategoryListOpen ? "space-y-2" : "hidden"}`}>
            {categories
              ?.filter((category) => shouldShowCategory(category))
              .map((category) => {
                const visibleChildren =
                  category.children?.filter((child) => shouldShowCategory(child)) ?? [];
                const hasChildren = visibleChildren.length > 0;
                const isExpanded =
                  expandedCategories[category.id] ||
                  Boolean(visibleChildren.some((child) => isCategoryTreeActive(child)));
                const isActive = isCategoryTreeActive(category);
                const displayCount = resolveCategoryCount(category);

                return (
                  <div key={category.id} className="space-y-1">
                    <button
                      type="button"
                      className={`flex w-full min-h-[42px] items-center justify-between rounded-xl px-2.5 py-2 text-left text-[13px] transition sm:min-h-0 sm:px-3 sm:text-sm ${
                        isActive
                          ? "bg-white/10 text-white"
                          : "bg-white/5 text-white/60 hover:text-white"
                      }`}
                      onClick={() => {
                        if (hasChildren) {
                          toggleCategoryGroup(category.id);
                        } else {
                          onCategoryChange(category.id);
                          onRequestClose?.();
                        }
                      }}
                    >
                      <span>{category.title}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase text-white/40 sm:text-xs">
                          [{displayCount}]
                        </span>
                        {hasChildren && (
                          <ChevronRight
                            className={`h-4 w-4 text-white/40 transition ${
                              isExpanded ? "rotate-90 text-white/80" : ""
                            }`}
                          />
                        )}
                      </span>
                    </button>
                    {hasChildren && (
                      <div className={`${isExpanded ? "space-y-1" : "hidden"} pl-4`}>
                        {visibleChildren.map((child) => {
                          const isChildActive = activeCategory === child.id;
                          const childCount = resolveCategoryCount(child);
                          return (
                            <button
                              key={child.id}
                              type="button"
                              className={`flex w-full min-h-[40px] items-center justify-between rounded-xl px-2.5 py-2 text-left text-[12px] transition sm:min-h-0 sm:px-3 sm:text-sm ${
                                isChildActive
                                  ? "bg-white/10 text-white"
                                  : "bg-white/5 text-white/60 hover:text-white"
                              }`}
                              onClick={() => {
                                onCategoryChange(child.id);
                                onRequestClose?.();
                              }}
                            >
                              <span>{child.title}</span>
                              <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase text-white/40 sm:text-xs">
                                [{childCount}]
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </motion.div>

        <motion.div
          variants={itemVariants}
          className="mt-auto flex items-center justify-between gap-4 rounded-2xl border border-[#D4AF37]/15 bg-[#D4AF37]/10 px-3 py-2.5 sm:px-4 sm:py-3"
        >
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#D4AF37]/20 shadow-[0_0_10px_rgba(212,175,55,0.25)] sm:h-9 sm:w-9">
              <ShieldCheck className="h-4 w-4 text-[#D4AF37] sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-[#D4AF37]/90">
                ПРОВЕРЕНО_ТОВАР
              </p>
              <p className="text-sm leading-snug text-white/80">
                Показывать только проверенные товары
              </p>
            </div>
          </div>
          <button
            type="button"
            className={`flex h-11 w-16 shrink-0 items-center rounded-full border p-1 transition ${
              verified
                ? "border-[#D4AF37]/70 bg-[#D4AF37]/30 shadow-[0_0_18px_rgba(212,175,55,0.55)]"
                : "border-white/15 bg-white/5 hover:border-[#D4AF37]/40 hover:bg-[#D4AF37]/10"
            }`}
            onClick={() => onVerifiedChange(!verified)}
          >
            <span
              className={`block h-5 w-5 rounded-full transition ${
                verified
                  ? "translate-x-9 bg-[#D4AF37] shadow-[0_0_10px_rgba(212,175,55,0.7)]"
                  : "translate-x-0 bg-white/30"
              }`}
            />
          </button>
        </motion.div>
    </motion.aside>
  );
}

  type ExperienceProps = {
    autoRotate: boolean;
    renderMode: RenderMode;
    finish: FinishMode;
    preview: PreviewMode;
    lightingMode: LightingMode;
    accentColor: string;
    rawModelUrl?: string | null;
    paintedModelUrl?: string | null;
    modelScale?: number | null;
    controlsRef: MutableRefObject<any | null>;
    onBounds?: (bounds: ModelBounds) => void;
    onStats?: (stats: { polyCount: number; meshCount: number }) => void;
    onReady?: () => void;
  };

type CameraFitterProps = {
  bounds: ModelBounds | null;
  url: string;
  scale: number;
  controlsRef: MutableRefObject<any | null>;
  cameraFitRef: MutableRefObject<string | null>;
};

function CameraFitter({
  bounds,
  url,
  scale,
  controlsRef,
  cameraFitRef,
}: CameraFitterProps) {
  const { camera } = useThree();

  useEffect(() => {
    if (!bounds) {
      return;
    }
    const fitKey = `${url}:${scale.toFixed(4)}`;
    if (cameraFitRef.current === fitKey) {
      return;
    }
    camera.position.set(5, 5, 5);
    camera.updateProjectionMatrix();
    if (controlsRef.current?.target) {
      controlsRef.current.target.set(0, 1.2, 0);
      controlsRef.current.update?.();
    }
    cameraFitRef.current = fitKey;
  }, [bounds, camera, cameraFitRef, controlsRef, scale, url]);

  return null;
}

function Experience({
    autoRotate,
    renderMode,
    finish,
    preview,
    lightingMode,
    accentColor,
    rawModelUrl,
    paintedModelUrl,
    modelScale: _modelScale,
    controlsRef,
    onBounds,
    onStats,
    onReady,
  }: ExperienceProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [modelBounds, setModelBounds] = useState<ModelBounds | null>(null);
  const [lockedScale, setLockedScale] = useState<number | null>(null);
  const lastModelUrlRef = useRef<string | null>(null);
  const cameraFitRef = useRef<string | null>(null);
  const isAR = preview === "ar";
  const modelFinish = finish === "pro" ? "Painted" : "Raw";
  const modelUrl = rawModelUrl ?? "/models/DamagedHelmet.glb";
  const isWireframe = renderMode === "wireframe";
  const targetSize = 3.5;
  const baseSize = modelBounds?.size ?? targetSize;
  const autoScale = baseSize > 0 ? targetSize / baseSize : 1;
  const clampedAutoScale = Math.min(Math.max(autoScale, 0.2), 8);
  const finalScale = lockedScale ?? clampedAutoScale;
  const boxSize = modelBounds?.boxSize ?? [1, 1, 1];
  const shadowScale = Math.max(boxSize[0], boxSize[2]) * finalScale * 1.2;
  const shadowY = 0;
    const lightingConfig = useMemo(() => {
      switch (lightingMode) {
        case "side":
          return { preset: "city" as const, intensity: 1.4 };
        case "golden":
          return { preset: "sunset" as const, intensity: 1.2 };
        case "sun":
        default:
          return { preset: "studio" as const, intensity: 1.6 };
      }
    }, [lightingMode]);
  const isLowQuality = isMobile;
  const glConfig = useMemo<Partial<WebGLRendererParameters>>(
    () => ({
      antialias: !isLowQuality,
      alpha: true,
      powerPreference: isLowQuality ? "low-power" : "high-performance",
    }),
    [isLowQuality]
  );
  const dpr: number | [number, number] = isLowQuality ? 1 : [1, 2];
  const environmentIntensity = isLowQuality
    ? Math.max(0.6, lightingConfig.intensity * 0.75)
    : lightingConfig.intensity;
  const environmentResolution = isLowQuality ? 128 : 256;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    if ("addEventListener" in media) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    const legacyMedia = media as MediaQueryList & {
      addListener?: (listener: () => void) => void;
      removeListener?: (listener: () => void) => void;
    };
    legacyMedia.addListener?.(update);
    return () => legacyMedia.removeListener?.(update);
  }, []);

  const handleBounds = useCallback(
    (bounds: ModelBounds) => {
      setModelBounds(bounds);
      onBounds?.(bounds);
    },
    [onBounds]
  );

  useEffect(() => {
    if (modelUrl !== lastModelUrlRef.current) {
      lastModelUrlRef.current = modelUrl;
      setLockedScale(null);
      cameraFitRef.current = null;
      return;
    }
    if (!modelBounds || lockedScale !== null) {
      return;
    }
    setLockedScale(clampedAutoScale);
  }, [modelUrl, modelBounds, lockedScale, clampedAutoScale]);

  const stopPropagation = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  const handlePointerDown = (event: { stopPropagation: () => void }) => {
    stopPropagation(event);
    setIsDragging(true);
  };

  const handlePointerUp = (event: { stopPropagation: () => void }) => {
    stopPropagation(event);
    setIsDragging(false);
  };

  return (
    <Canvas
      camera={{ position: [5, 5, 5], fov: 42, near: 0.1, far: 1000 }}
      dpr={dpr}
      className="h-full w-full"
      gl={glConfig}
      style={{
        touchAction: "none",
        cursor: isMobile ? "default" : isDragging ? "grabbing" : "grab",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={stopPropagation}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={stopPropagation}
    >
      <CameraFitter
        bounds={modelBounds}
        url={modelUrl}
        scale={finalScale}
        controlsRef={controlsRef}
        cameraFitRef={cameraFitRef}
      />
        {lightingMode === "sun" && (
          <>
            <ambientLight intensity={0.25} />
            <directionalLight position={[3, 6, 2]} intensity={1.2} color="#fff7e8" />
            <directionalLight position={[-3, 1.5, -2]} intensity={0.3} color="#dbe8ff" />
          </>
        )}
        {lightingMode === "side" && (
          <>
            <ambientLight intensity={0.2} />
            <directionalLight position={[6, 3, 0]} intensity={1.3} color="#f0f6ff" />
            <directionalLight position={[-2, 1.5, 4]} intensity={0.35} color="#e8f0ff" />
          </>
        )}
        {lightingMode === "golden" && (
          <>
            <ambientLight intensity={0.15} />
            <directionalLight position={[5, 2.2, 3.5]} intensity={1.1} color="#ffcc8a" />
            <directionalLight position={[-3, 1.5, -2]} intensity={0.25} color="#cfe0ff" />
          </>
        )}
      <Stage
        environment={null}
        intensity={1}
        shadows={false}
        adjustCamera={false}
        center={{ disable: true }}
      >
        <group scale={finalScale}>
            <ModelView
              rawModelUrl={modelUrl}
              paintedModelUrl={paintedModelUrl}
              finish={modelFinish}
              renderMode={renderMode}
              accentColor={accentColor}
              onBounds={handleBounds}
              onStats={onStats}
              onReady={onReady}
            />
        </group>
      </Stage>
      {!isLowQuality && (
        <ContactShadows
          key={`shadow-${shadowScale}`}
          position={[0, shadowY, 0]}
          scale={shadowScale}
          opacity={0.6}
          blur={1.6}
          far={shadowScale * 0.8}
        />
      )}
      {isAR && (
        <Grid
          position={[0, 0, 0]}
          cellSize={0.3}
          cellThickness={0.6}
          cellColor="#2ED1FF"
          sectionSize={Math.max(1.5, shadowScale * 0.6)}
          sectionThickness={1}
          sectionColor="#2ED1FF"
          fadeDistance={Math.max(12, shadowScale * 4)}
          fadeStrength={1}
          infiniteGrid
        />
      )}
      <Environment
        preset={lightingConfig.preset}
        environmentIntensity={environmentIntensity}
        resolution={environmentResolution}
      />
      <OrbitControls
        makeDefault
        autoRotate={autoRotate}
        autoRotateSpeed={isMobile ? 0.35 : isWireframe ? 0.5 : 0.6}
        rotateSpeed={isMobile ? 0.6 : isWireframe ? 0.8 : 1}
        enablePan={false}
        enableDamping
        dampingFactor={0.05}
        enableZoom={false}
        minDistance={2}
        maxDistance={10}
        ref={controlsRef}
      />
    </Canvas>
  );
}

type HUDProps = {
  polyCount?: number | null;
  printTime?: string | null;
  scale?: string | null;
  dimensions?: string | null;
};

function HUD({ polyCount, printTime, scale, dimensions }: HUDProps) {
  const [isHudExpanded, setHudExpanded] = useState(true);
  const polyLabel = formatCount(polyCount) ?? "—";
  const printLabel = printTime || "14h 22m";
  const scaleLabel = scale || "1:1 REAL";
  const dimensionsLabel = dimensions || "—";
  const hudItems = [
    { label: "ПОЛИГОНЫ", compactLabel: "ПОЛИГ.", value: polyLabel, accent: true },
    { label: "ВРЕМЯ_ПЕЧАТИ", compactLabel: "ВРЕМЯ", value: printLabel },
    { label: "МАСШТАБ", compactLabel: "МАСШ", value: scaleLabel },
    { label: "ГАБАРИТЫ", compactLabel: "ГАБ.", value: dimensionsLabel },
  ];
  const compactItems = [
    { label: "ПОЛИГ.", value: polyLabel, accent: true },
    { label: "ГАБАР.", value: dimensionsLabel },
  ];

  useEffect(() => {
    if (window.innerWidth < 640) {
      setHudExpanded(false);
    }
  }, []);

  return (
    <div className="absolute left-3 right-3 top-2 z-50 flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 font-[var(--font-jetbrains-mono)] text-[8px] uppercase tracking-[0.16em] text-white/65 sm:left-8 sm:right-auto sm:top-8 sm:gap-3 sm:px-4 sm:py-3 sm:text-xs sm:tracking-[0.2em]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[8px] tracking-[0.28em] text-white/40 sm:text-[9px] sm:tracking-[0.35em]">
          <span className="sm:hidden">ИНЖ. ВИД</span>
          <span className="hidden sm:inline">ИНЖЕНЕРНЫЙ ВИД</span>
        </span>
        <button
          type="button"
          aria-expanded={isHudExpanded}
          aria-controls="hud-details"
          className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-[7px] tracking-[0.3em] text-white/60 transition hover:border-white/30 hover:text-white/90 sm:text-[8px]"
          onClick={() => setHudExpanded((prev) => !prev)}
        >
          <span>{isHudExpanded ? "СВЕРНУТЬ" : "ДЕТАЛИ"}</span>
          <ChevronRight
            className={`h-3 w-3 transition ${isHudExpanded ? "rotate-90" : ""}`}
          />
        </button>
      </div>
      <div
        className={`flex items-center gap-3 ${isHudExpanded ? "hidden" : ""}`}
      >
        {compactItems.map((item) => (
          <div key={item.label} className="flex items-baseline gap-1 whitespace-nowrap">
            <span className="text-white/40">{item.label}</span>
            <span className={item.accent ? "text-[#2ED1FF]" : "text-white"}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
      <div
        id="hud-details"
        className={`grid grid-cols-2 gap-1.5 sm:grid-cols-1 sm:gap-2 ${
          isHudExpanded ? "" : "hidden"
        }`}
      >
        {hudItems.map((item, index) => (
          <div
            key={item.label}
            className={`flex flex-col gap-1 text-center sm:flex-row sm:items-center sm:gap-2 sm:text-left ${
              index > 0 ? "sm:mt-2" : ""
            } ${item.accent ? "text-[#2ED1FF]" : ""}`}
          >
            <span>{item.label}:</span>
            <span className="text-white">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GlobalHudMarkers() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 hidden font-[var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.3em] text-white/40 md:block">
      <div className="absolute left-6 top-6 flex items-center gap-3">
        <span className="text-[#2ED1FF]">X:128.4</span>
        <span>Y:42.9</span>
        <span>Z:88.1</span>
      </div>
      <div className="absolute right-6 top-6 flex items-center gap-3">
        <span>СИСТЕМА:НОРМА</span>
        <span>УЗЕЛ:07</span>
      </div>
      <div className="absolute bottom-6 left-6 flex items-center gap-3">
        <span>СЕТКА:ЗАФИКС</span>
        <span>ТРАССА:АКТИВНА</span>
      </div>
      <div className="absolute bottom-6 right-6 flex items-center gap-3">
        <span>СИГНАЛ:99%</span>
        <span>FPS:120</span>
      </div>
    </div>
  );
}

type DockButtonProps = {
  active: boolean;
  label: string;
  compactLabel?: string;
  icon: ReactNode;
  fullWidth?: boolean;
  onClick: () => void;
};

function DockButton({ active, label, compactLabel, icon, fullWidth, onClick }: DockButtonProps) {
  return (
    <button
      className={`relative flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-2 text-[10px] uppercase tracking-[0.14em] transition sm:min-h-0 sm:gap-2 sm:px-3 sm:py-2 sm:text-xs sm:tracking-[0.2em] ${
        active
          ? "border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_14px_rgba(46,209,255,0.35)]"
          : "border-white/10 text-white/70 hover:border-white/25 hover:bg-white/10 hover:text-white"
      } ${fullWidth ? "w-full justify-center" : ""}`}
      onClick={onClick}
    >
      {icon}
      <span className="sm:hidden">{compactLabel ?? label}</span>
      <span className="hidden sm:inline">{label}</span>
      {active && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-3 -bottom-0.5 h-px rounded-full bg-[#BFF4FF] shadow-[0_0_8px_rgba(191,244,255,0.6)]"
        />
      )}
    </button>
  );
}

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  resetKey?: string | number;
  onError?: () => void;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError?.();
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

type SystemStandbyPanelProps = {
  message: string;
  className?: string;
  actionLabel?: string;
  onAction?: () => void;
};

function SystemStandbyPanel({
  message,
  className,
  actionLabel,
  onAction,
}: SystemStandbyPanelProps) {
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-[10px] uppercase tracking-[0.3em] text-white/60 sm:px-6 sm:py-10 sm:text-xs ${className ?? ""}`}
    >
      <div className="pointer-events-none absolute inset-0 cad-grid-pattern opacity-30" />
      <div className="relative flex flex-col items-center gap-3">
        <span>{message}</span>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="rounded-full border border-[#2ED1FF]/60 bg-[#0b1014] px-4 py-2 text-[9px] uppercase tracking-[0.28em] text-[#BFF4FF] shadow-[0_0_12px_rgba(46,209,255,0.35)] transition hover:border-[#7FE7FF] hover:text-white"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

  type ProductCardProps = {
    product: CatalogProduct;
    isSelected: boolean;
    onClick: () => void;
    isFavorite: boolean;
    onToggleFavorite: () => void;
    onAddToCart: () => void;
    onOrderPrint?: () => void;
  };

const buildMaterialDescription = (product: CatalogProduct) => {
  const keys = product.categoryKeys ?? [];
  const hasAny = (values: string[]) => values.some((value) => keys.includes(value));
  const isMiniature = hasAny([
    "миниатюры",
    "миниатюра",
    "фигурки",
    "фигуры",
    "персонажи",
    "аниме",
    "аниме девушки",
  ]);
  const isMechanical = hasAny([
    "механика",
    "детали",
    "индустрия",
    "техника",
    "робот",
    "кибер",
    "модуль",
  ]);
  const isTerrain = hasAny(["архитектура", "интерьер", "экстерьер", "сцены", "террейн", "декор"]);

  if (product.techKey === "SLA Resin") {
    if (isMiniature) {
      return "Смола SLA (стандарт/ABS-подобная/прозрачная): высокая детализация, тонкие элементы и гладкая поверхность.";
    }
    if (isMechanical) {
      return "Смола SLA (стандарт/ABS-подобная/прозрачная): точная геометрия и четкие посадки деталей.";
    }
    if (isTerrain) {
      return "Смола SLA (стандарт/ABS-подобная/прозрачная): чистые текстуры и аккуратные поверхности.";
    }
    return "Смола SLA (стандарт/ABS-подобная/прозрачная): высокая детализация и гладкая поверхность.";
  }

  if (product.techKey === "FDM Plastic") {
    if (isMechanical) {
      return "Пластик FDM (PLA/PETG/ABS): прочный, подходит для функциональных деталей.";
    }
    if (isTerrain) {
      return "Пластик FDM (PLA/PETG/ABS): хорош для крупных объектов и прототипов.";
    }
    if (isMiniature) {
      return "Пластик FDM (PLA/PETG/ABS): можно печатать, но тонкие детали требуют поддержки.";
    }
    return "Пластик FDM (PLA/PETG/ABS): прочный и доступный материал для печати.";
  }

  return "Материал: уточняется.";
};

function ProductCard({
  product,
  isSelected,
  onClick,
  isFavorite,
  onToggleFavorite,
  onAddToCart,
  onOrderPrint,
  forceProxyMedia,
}: ProductCardProps & { forceProxyMedia: boolean }) {
  const router = useRouter();
  const [favoritePulse, setFavoritePulse] = useState(false);
  const favoritePulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchDoneRef = useRef(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const resolvedThumbnail = useMemo(() => {
    if (!forceProxyMedia) {
      return product.thumbnailUrl;
    }
    if (!isExternalUrl(product.thumbnailUrl)) {
      return product.thumbnailUrl;
    }
    return buildProxyUrlFromSource(product.thumbnailUrl) ?? product.thumbnailUrl;
  }, [forceProxyMedia, product.thumbnailUrl]);
  const formatLabel =
    product.formatKey === "digital"
      ? "DIGITAL STL"
      : product.formatKey === "physical"
        ? "PHYSICAL"
        : product.type.toUpperCase();
  const statusTag = product.verified ? "VERIFIED" : product.isFeatured ? "POPULAR" : "NEW";
  const statusTone =
    statusTag === "VERIFIED"
      ? "border-[#D4AF37]/50 bg-[#D4AF37]/15 text-[#D4AF37]"
      : statusTag === "POPULAR"
        ? "border-[#2ED1FF]/50 bg-[#2ED1FF]/15 text-[#BFF4FF]"
        : "border-emerald-400/40 bg-emerald-400/15 text-emerald-200";
  const materialDescription = buildMaterialDescription(product);
  const productLink = product.slug
    ? `/product/${encodeURIComponent(product.slug)}`
    : product.id
      ? `/product/${encodeURIComponent(String(product.id))}`
      : "";
  const prefetchProduct = useCallback(() => {
    if (!productLink || prefetchDoneRef.current) {
      return;
    }
    prefetchDoneRef.current = true;
    router.prefetch(productLink);
  }, [productLink, router]);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  useEffect(() => {
    return () => {
      if (favoritePulseTimeoutRef.current) {
        clearTimeout(favoritePulseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!productLink || prefetchDoneRef.current || typeof window === "undefined") {
      return;
    }
    const target = cardRef.current;
    if (!target || !("IntersectionObserver" in window)) {
      prefetchProduct();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          prefetchProduct();
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [prefetchProduct, productLink]);

  return (
    <motion.article
      variants={itemVariants}
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onKeyDown={handleKeyDown}
      onPointerEnter={prefetchProduct}
      onFocus={prefetchProduct}
      onClick={onClick}
      className={`group flex h-full w-full flex-col rounded-3xl bg-white/5 px-3.5 pt-3.5 pb-3 text-left backdrop-blur-xl light-sweep transition-all sm:px-6 sm:pt-6 sm:pb-4 hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(0,0,0,0.35)] ${
        isSelected
          ? "border border-[#2ED1FF]/50 shadow-[0_0_20px_rgba(46,209,255,0.2)]"
          : "border border-transparent"
      }`}
    >
      <div className="relative mb-3 overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:mb-4">
        <img
          src={resolvedThumbnail}
          alt={product.name}
          loading="lazy"
          decoding="async"
          onError={(event) => {
            const img = event.currentTarget;
            if (img.dataset.fallbackApplied === "1") {
              img.src = buildProductPlaceholder();
              return;
            }
            img.dataset.fallbackApplied = "1";
            const proxy = forceProxyMedia ? null : buildProxyUrlFromSource(img.src);
            img.src = proxy ?? buildProductPlaceholder();
          }}
          className="h-32 w-full object-contain p-2 transition-transform duration-300 ease-out group-hover:scale-[1.02] sm:h-40"
        />
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_30px_rgba(0,0,0,0.35)]" />
        <div className="absolute left-2.5 top-2.5 flex items-center gap-2 sm:left-3 sm:top-3">
          <span className="rounded-full bg-black/60 px-2.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.2em] text-white shadow-[0_0_12px_rgba(0,0,0,0.4)] sm:px-3 sm:py-1 sm:text-[10px]">
            {formatLabel}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.2em] sm:text-[9px] ${statusTone}`}
          >
            {statusTag}
          </span>
        </div>
          <div className="absolute right-2.5 top-2.5 flex flex-col items-end gap-2 sm:right-3 sm:top-3">
            <motion.button
              type="button"
              aria-label={isFavorite ? "Удалить из избранного" : "Добавить в избранное"}
              animate={favoritePulse ? { scale: [1, 1.12, 1] } : { scale: 1 }}
              transition={{ duration: 0.35 }}
              className={`group/fav flex h-9 w-9 items-center justify-center rounded-full border text-white transition sm:h-10 sm:w-10 ${
                isFavorite
                  ? "border-rose-300/70 bg-rose-500/20 text-rose-200 shadow-[0_0_14px_rgba(244,63,94,0.45)]"
                  : "border-white/10 bg-black/40 text-white/70 hover:border-rose-300/40 hover:text-white"
              }`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleFavorite();
                if (!isFavorite) {
                  setFavoritePulse(true);
                  if (favoritePulseTimeoutRef.current) {
                    clearTimeout(favoritePulseTimeoutRef.current);
                  }
                  favoritePulseTimeoutRef.current = setTimeout(() => {
                    setFavoritePulse(false);
                  }, 350);
                }
              }}
            >
              <Heart className="h-4 w-4" fill={isFavorite ? "currentColor" : "none"} />
              <span className="pointer-events-none absolute -bottom-6 right-0 hidden whitespace-nowrap rounded-full border border-white/10 bg-black/70 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-white/70 opacity-0 transition group-hover/fav:opacity-100 sm:block">
                В избранное
              </span>
            </motion.button>
            <div className="flex flex-col items-center gap-2 opacity-100 transition-all duration-200 sm:opacity-0 sm:translate-y-2 sm:group-hover:translate-y-0 sm:group-hover:opacity-100">
              <button
                type="button"
                aria-label="В корзину"
                title="В корзину"
                className="group flex h-9 w-9 items-center justify-center rounded-full border border-[#2ED1FF]/60 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_12px_rgba(46,209,255,0.35)] transition hover:border-[#7FE7FF] hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  onAddToCart();
                }}
              >
                <ShoppingCart className="h-4 w-4" />
                <span className="sr-only">В корзину</span>
              </button>
              {product.formatKey === "digital" &&
                (product.rawModelUrl || product.paintedModelUrl) &&
                onOrderPrint && (
                <button
                  type="button"
                  aria-label="Заказать печать"
                  title="Заказать печать"
                  className="group flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 transition hover:border-[#2ED1FF]/60 hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOrderPrint();
                  }}
                >
                  <Printer className="h-4 w-4" />
                  <span className="sr-only">Заказать печать</span>
                </button>
              )}
            </div>
          </div>
        </div>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.26em] text-[#2ED1FF]/90 sm:text-xs sm:tracking-[0.3em]">
            {formatLabel}
          </p>
          <h4 className="mt-2 min-h-[2.4rem] text-base font-semibold leading-snug text-white sm:mt-3 sm:min-h-[3rem] sm:text-xl sm:leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
            {product.name}
          </h4>
          <p className="mt-1.5 truncate text-[12px] text-white/50 sm:mt-2 sm:text-sm">
            {product.tech}
          </p>
          <p className="mt-1 hidden text-[12px] text-white/45 sm:block sm:text-[13px] [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
            {materialDescription}
          </p>
        </div>
        {product.verified && (
          <CheckCircle2 className="h-4 w-4 text-[#D4AF37] sm:h-5 sm:w-5" />
        )}
      </div>
      <div className="mt-auto flex items-center justify-between pt-2 text-[12px] sm:pt-4 sm:text-sm">
        <span className="font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/35">
          PRICE
        </span>
        <span className="text-base font-semibold text-white shadow-[0_0_14px_rgba(46,209,255,0.25)] sm:text-xl">
          {product.price}
        </span>
      </div>
    </motion.article>
  );
}
