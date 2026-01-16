"use client";

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Grid, OrbitControls, Stage } from "@react-three/drei";
import { AnimatePresence, motion } from "framer-motion";
import { Vector3 } from "three";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Menu,
  Palette,
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

const CATEGORY_SHELL = [
  {
    title: "Персонажи",
    items: ["Мужчины", "Женщины", "Фэнтези"],
  },
  {
    title: "Настолки",
    items: ["Миниатюры", "Монстры", "Сцены"],
  },
  {
    title: "Дом",
    items: ["Декор", "Органайзеры", "Освещение"],
  },
  {
    title: "Хобби",
    items: ["Косплей", "Игрушки", "Аксессуары"],
  },
];

type TechMode = "sla" | "fdm";
type ModelBounds = {
  size: number;
  boxSize: [number, number, number];
  radius: number;
};

type SidebarCategory = {
  title: string;
  items: string[];
};

type CategoryDoc = {
  id?: string;
  title?: string;
  parent?: string | { id?: string; title?: string } | null;
};

type MediaDoc = {
  id?: string;
  url?: string;
  filename?: string;
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
  category?: CategoryDoc | string | null;
  categories?: CategoryDoc[] | string[] | null;
  rawModel?: MediaDoc | string | null;
  paintedModel?: MediaDoc | string | null;
};

type CatalogProduct = {
  id: string;
  name: string;
  price: string;
  priceValue: number | null;
  formatKey: FormatMode | null;
  rawModelUrl: string | null;
  paintedModelUrl: string | null;
  modelScale: number | null;
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

const normalizeFormat = (value?: string) => {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("digital")) {
    return "digital";
  }
  if (normalized.includes("physical")) {
    return "physical";
  }
  return null;
};

const normalizeTechnology = (value?: unknown) => {
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
    return "sla";
  }
  if (
    normalized.includes("fdm") ||
    normalized.includes("plastic") ||
    normalized.includes("пласт")
  ) {
    return "fdm";
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

const extractFilename = (value: string) => {
  const normalized = value.split("?")[0] ?? value;
  const parts = normalized.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || null;
};

const buildProxyUrl = (filename: string) =>
  `/api/media-file/${encodeURIComponent(filename)}`;

const resolveMediaUrl = (value?: MediaDoc | string | null) => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    if (isModelAsset(value)) {
      const filename = extractFilename(value);
      return filename ? buildProxyUrl(filename) : value;
    }
    return value;
  }

  const filename = value.filename ?? null;
  if (filename && isModelAsset(filename)) {
    return buildProxyUrl(filename);
  }

  if (value.url) {
    return value.url;
  }
  if (filename) {
    return `/media/${filename}`;
  }
  return null;
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

const pickInteriorBackground = (categories?: string[] | null) => {
  const normalized = (categories ?? []).map((title) => title.toLowerCase());
  const matches = (targets: string[]) =>
    normalized.some((title) => targets.some((target) => title.includes(target)));

  if (matches(["персонажи", "сай-фай"])) {
    return interiorBackgrounds.lab;
  }
  if (matches(["дом и декор", "архитектура"])) {
    return interiorBackgrounds.home;
  }
  if (matches(["хобби и игрушки", "террейн"])) {
    return interiorBackgrounds.work;
  }
  return interiorBackgrounds.lab;
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
type LightingMode = "lab" | "warm" | "cyber";

const lightingPresets: Array<{ value: LightingMode; label: string }> = [
  { value: "lab", label: "ЛАБОРАТОРИЯ" },
  { value: "warm", label: "ТЕПЛЫЙ" },
  { value: "cyber", label: "КИБЕРПАНК" },
];

export default function Home() {
  const router = useRouter();
  const { toasts, showSuccess, removeToast } = useToast();
  const [autoRotate, setAutoRotate] = useState(true);
  const [renderMode, setRenderMode] = useState<RenderMode>("final");
  const [finish, setFinish] = useState<FinishMode>("raw");
  const [preview, setPreview] = useState<PreviewMode>("default");
  const [lightingMode, setLightingMode] = useState<LightingMode>("lab");
  const [activeColor, setActiveColor] = useState("#f3f4f6");
  const [format, setFormat] = useState<FormatMode>("digital");
  const [technology, setTechnology] = useState<TechMode>("sla");
  const [verified, setVerified] = useState(true);
  const [activeCategory, setActiveCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
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
  const [heroBounds, setHeroBounds] = useState<ModelBounds | null>(null);
  const controlsRef = useRef<any | null>(null);
  const previousRenderModeRef = useRef<RenderMode>("final");
  const zoomAnimationRef = useRef<number | null>(null);
  const apiBase = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

  const formatLabelForKey = (formatKey: FormatMode) =>
    formatKey === "physical" ? "Печатная модель" : "Цифровой STL";

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
    fetch(`${apiBase}/api/users/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const user = data?.user ?? data?.doc ?? null;
        setIsLoggedIn(Boolean(user?.id));
      })
      .catch(() => setIsLoggedIn(false));
  }, [apiBase]);

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;
    const buildApiUrl = (path: string) => `${apiBase}${path}`;

    const fetchData = async () => {
      setDataLoading(true);
      setProductsError(false);
      setCategoriesError(false);

      const [categoriesResult, productsResult] = await Promise.allSettled([
        fetch(buildApiUrl("/api/categories?depth=1&limit=200"), {
          signal: controller.signal,
        }).then((res) => (res.ok ? res.json() : Promise.reject(res))),
        fetch(buildApiUrl("/api/products?depth=1&limit=200"), {
          signal: controller.signal,
        }).then((res) => (res.ok ? res.json() : Promise.reject(res))),
      ]);

      if (!isMounted) {
        return;
      }

      if (categoriesResult.status === "fulfilled") {
        setCategoriesData(categoriesResult.value?.docs ?? []);
      } else {
        setCategoriesData([]);
        setCategoriesError(true);
      }

      if (productsResult.status === "fulfilled") {
        setProducts(productsResult.value?.docs ?? []);
      } else {
        setProducts([]);
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
      if (category?.id && category?.title) {
        map.set(String(category.id), category.title);
      }
    });
    return map;
  }, [categoriesData]);

  const sidebarCategories = useMemo<SidebarCategory[]>(() => {
    const baseTitles = new Set(CATEGORY_SHELL.map((category) => category.title));
    const childrenByParent = new Map<string, { items: string[]; seen: Set<string> }>();

    categoriesData?.forEach((category) => {
      if (!category?.title) {
        return;
      }

      let parentTitle: string | null = null;
      const parent = category.parent;
      if (typeof parent === "string") {
        parentTitle = categoriesById.get(parent) ?? null;
      } else if (typeof parent === "object") {
        parentTitle =
          parent?.title ??
          (parent?.id ? categoriesById.get(String(parent.id)) ?? null : null);
      }

      if (parentTitle && baseTitles.has(parentTitle)) {
        const entry =
          childrenByParent.get(parentTitle) ?? { items: [], seen: new Set<string>() };
        if (!entry.seen.has(category.title)) {
          entry.items.push(category.title);
          entry.seen.add(category.title);
        }
        childrenByParent.set(parentTitle, entry);
      }
    });

    const baseCategories = CATEGORY_SHELL.map((category) => {
      const items = childrenByParent.get(category.title)?.items;
      return {
        title: category.title,
        items: items && items.length > 0 ? items : Array.from(new Set(category.items)),
      };
    });

    const extraTitles = new Set<string>();
    const extraCategories =
      categoriesData
        ?.filter((category) => {
          if (!category?.title) {
            return false;
          }
          if (baseTitles.has(category.title)) {
            return false;
          }
          return !category.parent;
        })
        .reduce((acc, category) => {
          const title = category.title ?? "";
          if (!title || extraTitles.has(title)) {
            return acc;
          }
          extraTitles.add(title);
          acc.push({ title, items: [] });
          return acc;
        }, [] as SidebarCategory[]) ?? [];

    return [...baseCategories, ...extraCategories.filter((category) => category.title)];
  }, [categoriesData, categoriesById]);

  const normalizedProducts = useMemo(() => {
    return (products ?? []).map((product) => {
      const categoryTitles: string[] = [];
      const addCategoryTitle = (value?: CategoryDoc | string | null) => {
        if (!value) {
          return;
        }
        if (typeof value === "string") {
          categoryTitles.push(categoriesById.get(value) ?? value);
          return;
        }
        if (value.title) {
          categoryTitles.push(value.title);
          return;
        }
        if (value.id) {
          const title = categoriesById.get(String(value.id));
          if (title) {
            categoryTitles.push(title);
          }
        }
      };

      addCategoryTitle(product.category ?? null);
      if (Array.isArray(product.categories)) {
        product.categories.forEach((category) => addCategoryTitle(category ?? null));
      }

      const formatKey = normalizeFormat(product.format);
      const techKey = normalizeTechnology(product.technology);
      const rawModelUrl = resolveMediaUrl(product.rawModel ?? null);
      const paintedModelUrl = resolveMediaUrl(product.paintedModel ?? null);
      const priceValue = typeof product.price === "number" ? product.price : null;
      const priceLabel = formatCurrency(product.price);
      const polyCount = typeof product.polyCount === "number" ? product.polyCount : null;
      const modelScale =
        typeof product.modelScale === "number" ? product.modelScale : null;
      const printTime = product.printTime ?? null;
      const scale = product.scale ?? null;

      return {
        id: String(product.id ?? product.name ?? ""),
        name: product.name ?? "Untitled",
        slug: product.slug ?? "",
        sku: product.sku ?? "",
        type: product.format ?? (formatKey === "digital" ? "Digital STL" : "Physical Print"),
        tech: product.technology ?? (techKey === "sla" ? "SLA" : "FDM"),
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
        rawModelUrl,
        paintedModelUrl,
      };
    });
  }, [products, categoriesById]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredProducts = useMemo(() => {
    const activeGroup = sidebarCategories.find(
      (category) => category.title === activeCategory
    );
    const activeItems = activeGroup?.items ?? [];

      return normalizedProducts.filter((product) => {
        const matchesFormat = product.formatKey === format;
        const matchesTech = product.techKey === technology;
        const matchesVerified = !verified || product.verified;
        const matchesCategory = activeCategory
          ? product.categoryTitles.includes(activeCategory) ||
            (activeItems.length > 0 &&
              product.categoryTitles.some((title) => activeItems.includes(title)))
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
      sidebarCategories,
      normalizedQuery,
    ]);

    const countBasisProducts = useMemo(() => {
      return normalizedProducts.filter(
        (product) =>
          product.formatKey === format &&
          product.techKey === technology &&
          (!verified || product.verified) &&
          (!normalizedQuery ||
            [
              product.name,
              product.sku,
              product.slug,
              ...product.categoryTitles,
            ].some((value) => value && matchesQuery(String(value), normalizedQuery)))
      );
    }, [normalizedProducts, format, technology, verified, normalizedQuery]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    countBasisProducts.forEach((product) => {
      product.categoryTitles.forEach((title) => {
        counts.set(title, (counts.get(title) ?? 0) + 1);
      });
    });
    return counts;
  }, [countBasisProducts]);

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
    () => pickInteriorBackground(currentProduct?.categoryTitles),
    [currentProduct?.categoryTitles]
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
  }, [currentModelId]);

  const heroName = currentProduct?.name ?? "Нет модели";
  const heroSku = currentProduct?.sku || currentProduct?.slug || "-";
  const heroPriceLabel = formatCurrency(currentProduct?.priceValue ?? null);
  const heroPolyCount = currentProduct?.polyCount ?? null;
  const heroPrintTime = currentProduct?.printTime ?? null;
  const heroScale = currentProduct?.scale ?? null;
  const isInterior = preview === "interior";
  const heroDimensions =
    formatDimensions(heroBounds, currentProduct?.scale ?? null, currentProduct?.modelScale ?? null) ??
    "-";
  const isSlaProduct = currentProduct?.techKey === "sla";
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

  return (
    <div className="relative min-h-screen bg-[#050505] text-white font-[var(--font-inter)]">
      <ToastContainer toasts={toasts} onRemove={removeToast} position="top-right" />
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
                setIsLoggedIn(true);
                setAuthModalOpen(false);
                router.push("/profile");
              }}
              redirectOnSuccess={false}
            />
          </div>
        </div>
      )}
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.2),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
      </div>
      <GlobalHudMarkers />
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        cartCount={cartCount}
        onCartToggle={handleToggleCart}
        hasUnreadStatus={hasUnreadStatus}
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
                  categories={sidebarCategories}
                  categoryCounts={categoryCounts}
                  activeCategory={activeCategory}
                  onCategoryChange={setActiveCategory}
                  onRequestClose={() => setIsSidebarOpen(false)}
                className="h-full w-full overflow-y-auto rounded-none border-r border-white/10 pt-14"
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
                    {cartItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"
                      >
                        <img
                          src={item.thumbnailUrl}
                          alt={item.name}
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
                    ))}
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
      <div className="relative z-10 mx-auto max-w-[1400px] px-4 pb-16 sm:px-6 sm:pb-24">
        <div className="grid gap-6 lg:gap-8 md:grid-cols-[280px_1fr]">
            <Sidebar
              format={format}
              onFormatChange={setFormat}
              technology={technology}
              onTechnologyChange={setTechnology}
              verified={verified}
              onVerifiedChange={setVerified}
              categories={sidebarCategories}
              categoryCounts={categoryCounts}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              className="hidden md:flex"
          />
          <main className="space-y-8 lg:space-y-10">
            <motion.section
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="space-y-4 sm:space-y-6"
            >
              <motion.div
                variants={itemVariants}
                className="relative overflow-hidden rounded-[32px] border border-white/5 bg-white/[0.02] p-4 sm:p-6 rim-light"
              >
                <HUD
                  polyCount={heroPolyCount}
                  printTime={heroPrintTime}
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
                    ) : (
                      <ErrorBoundary
                        fallback={<SystemStandbyPanel message="3D System Standby" className="h-full" />}
                      >
                        <Experience
                          autoRotate={autoRotate}
                          renderMode={renderMode}
                          finish={finish}
                          preview={preview}
                          lightingMode={lightingMode}
                          accentColor={activeColor}
                          rawModelUrl={currentProduct?.rawModelUrl ?? null}
                          paintedModelUrl={currentProduct?.paintedModelUrl ?? null}
                          modelScale={currentProduct?.modelScale ?? null}
                          controlsRef={controlsRef}
                          onBounds={setHeroBounds}
                        />
                      </ErrorBoundary>
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
                  <div className="absolute inset-x-4 bottom-4 z-50 flex flex-wrap items-end justify-between gap-3 sm:inset-x-8 sm:bottom-8 sm:gap-4">
                  <div className="order-1 max-w-full sm:max-w-[420px]">
                  <p className="text-[11px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60 sm:text-sm">
                    TECH_ID: {heroSku}
                  </p>
                    <h2 className="text-2xl font-bold italic tracking-wide text-white sm:text-3xl lg:text-4xl">
                      {heroName}
                    </h2>
                  <div className="mt-3 flex flex-wrap items-center gap-3 sm:mt-4 sm:gap-4">
                    <span className="text-lg font-semibold text-white sm:text-xl lg:text-2xl">
                      {heroPriceLabel}
                    </span>
                    <button
                      type="button"
                      className="flex min-h-[44px] items-center gap-2 rounded-full bg-[#2ED1FF]/20 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[#2ED1FF] transition hover:bg-[#2ED1FF]/30 sm:min-h-0 sm:px-4 sm:text-[11px]"
                      onClick={() => currentProduct && addToCart(currentProduct)}
                    >
                      <ShoppingCart className="h-4 w-4" />
                      В корзину
                    </button>
                  </div>
                  </div>
                  <div className="order-3 w-full flex items-center justify-start gap-2 overflow-x-auto rounded-full px-3 py-2 glass-dock sm:flex-wrap sm:justify-center sm:overflow-visible sm:gap-3 sm:px-4">
                  <DockButton
                    active={autoRotate}
                    label="Авто-поворот"
                    icon={<RotateCw className="h-4 w-4" />}
                    onClick={() => setAutoRotate((prev) => !prev)}
                  />
                  <DockButton
                    active={false}
                    label="Zoom +"
                    icon={<ZoomIn className="h-4 w-4" />}
                    onClick={() => handleZoom("in")}
                  />
                  <DockButton
                    active={false}
                    label="Zoom -"
                    icon={<ZoomOut className="h-4 w-4" />}
                    onClick={() => handleZoom("out")}
                  />
                  <DockButton
                    active={preview === "interior"}
                    label="В интерьере"
                    icon={<Scan className="h-4 w-4" />}
                    onClick={() =>
                      setPreview((prev) => (prev === "interior" ? "default" : "interior"))
                    }
                  />
                  <DockButton
                    active={preview === "ar"}
                    label="AR-просмотр"
                    icon={<Sparkles className="h-4 w-4" />}
                    onClick={() =>
                      setPreview((prev) => (prev === "ar" ? "default" : "ar"))
                    }
                  />
                  </div>
                  <div className="order-2 relative flex flex-wrap items-center gap-2 rounded-full bg-white/5 px-3 py-2 font-[var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-white/70 sm:text-xs">
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
                                      } ${option.value === "lab" ? "col-span-2" : ""}`}
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

              <ErrorBoundary fallback={<SystemStandbyPanel message="System Standby: No Data" />}>
                {showSystemStandby ? (
                  <SystemStandbyPanel message={standbyMessage} className="min-h-[200px] sm:min-h-[240px]" />
                ) : (
                  <motion.div
                    variants={containerVariants}
                    className="columns-1 gap-4 md:columns-2 xl:columns-3 sm:gap-6"
                  >
                    {filteredProducts?.map((card) => {
                      const isSelected = card.id === currentModelId;
                      return (
                        <motion.button
                          key={card.id}
                          type="button"
                          variants={itemVariants}
                          aria-pressed={isSelected}
                          onClick={() => setCurrentModelId(card.id)}
                          className={`mb-4 w-full break-inside-avoid rounded-3xl bg-white/5 p-4 text-left backdrop-blur-xl light-sweep transition sm:mb-6 sm:p-6 ${
                            isSelected
                              ? "border border-[#2ED1FF]/50 shadow-[0_0_20px_rgba(46,209,255,0.2)]"
                              : "border border-transparent"
                          }`}
                        >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-[#2ED1FF]">
                              {card.type}
                            </p>
                            <h4 className="mt-3 text-lg font-semibold text-white sm:text-xl">
                              {card.name}
                            </h4>
                            <p className="mt-2 text-[13px] text-white/60 sm:text-sm">{card.tech}</p>
                          </div>
                          {card.verified && (
                            <CheckCircle2 className="h-4 w-4 text-[#D4AF37] sm:h-5 sm:w-5" />
                          )}
                        </div>
                        <div className="mt-4 flex items-center justify-between text-[13px] sm:mt-6 sm:text-sm">
                          <span className="font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/40">
                            PRICE
                          </span>
                          <span className="text-base font-semibold text-white sm:text-lg">
                            {card.price}
                          </span>
                        </div>
                        </motion.button>
                      );
                    })}
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
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  cartCount: number;
  onCartToggle: () => void;
  hasUnreadStatus: boolean;
};

function Header({
  searchQuery,
  onSearchChange,
  isSidebarOpen,
  onToggleSidebar,
  cartCount,
  onCartToggle,
  hasUnreadStatus,
}: HeaderProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchOpen) {
      inputRef.current?.focus();
    }
  }, [isSearchOpen]);

  const toggleSearch = () => {
    setIsSearchOpen((prev) => {
      if (prev) {
        onSearchChange("");
      }
      return !prev;
    });
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      onSearchChange("");
      setIsSearchOpen(false);
      event.currentTarget.blur();
    }
  };

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#050505]/80 backdrop-blur-xl">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-6"
      >
        <motion.div variants={itemVariants} className="flex items-center gap-3 sm:gap-4">
          <div>
            <a href="/" className="block transition hover:opacity-80">
              <h1 className="text-2xl font-bold tracking-[0.2em] text-white sm:text-3xl">
                3D-STORE
              </h1>
            </a>
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
            href="/services/print"
            className="rounded-full border border-[#2ED1FF] bg-[#0b1014] px-5 py-2 text-[10px] uppercase tracking-[0.35em] text-[#BFF4FF] shadow-[0_0_18px_rgba(46,209,255,0.45)] transition hover:border-[#7FE7FF] hover:text-white"
          >
            ПЕЧАТЬ НА ЗАКАЗ
          </a>
        </motion.nav>

        <motion.div
          variants={itemVariants}
          className="flex items-center gap-2 md:justify-end md:gap-3"
        >
          <a
            href="/services/print"
            className="hidden rounded-full border border-[#2ED1FF] bg-[#0b1014] px-3 py-2 text-[8px] uppercase tracking-[0.28em] text-[#BFF4FF] shadow-[0_0_12px_rgba(46,209,255,0.4)] transition hover:border-[#7FE7FF] sm:inline-flex md:hidden"
          >
            ПЕЧАТЬ НА ЗАКАЗ
          </a>
          <button
            type="button"
            aria-label="Toggle sidebar"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white md:hidden"
            onClick={onToggleSidebar}
          >
            {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          {isSearchOpen && (
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 md:flex">
              <input
                ref={inputRef}
                type="search"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Поиск: название, категория, артикул"
                className="w-52 bg-transparent text-xs uppercase tracking-[0.2em] text-white/80 placeholder:text-white/40 focus:outline-none"
              />
            </div>
          )}
          <button
            type="button"
            aria-label="Поиск"
            className="hidden h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white md:flex"
            onClick={toggleSearch}
          >
            {isSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
          <button
            type="button"
            aria-label="Корзина"
            className="relative flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white md:h-10 md:w-10"
            onClick={onCartToggle}
          >
            <ShoppingCart className="h-5 w-5" />
            {cartCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#2ED1FF] text-[10px] font-semibold text-[#050505]">
                {cartCount}
              </span>
            )}
          </button>
          <a
            href="/profile"
            aria-label="Профиль"
            className="relative hidden h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white md:flex"
          >
            <User className="h-5 w-5" />
            {hasUnreadStatus && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]" />
            )}
          </a>
        </motion.div>
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
    categories: SidebarCategory[];
    categoryCounts: Map<string, number>;
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
  categories,
  categoryCounts,
  activeCategory,
  onCategoryChange,
  onRequestClose,
  className,
}: SidebarProps) {
  const [openCategory, setOpenCategory] = useState<string>(categories[0]?.title ?? "");

  useEffect(() => {
    if (categories.length === 0) {
      if (openCategory) {
        setOpenCategory("");
      }
      return;
    }

    if (!openCategory || !categories.some((category) => category.title === openCategory)) {
      setOpenCategory(categories[0].title);
    }
  }, [categories, openCategory]);

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
            className={`rounded-full min-h-[44px] px-2.5 py-2 text-[10px] uppercase tracking-[0.2em] sm:min-h-0 sm:px-3 sm:text-xs ${
              technology === "sla"
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white"
            }`}
            onClick={() => onTechnologyChange("sla")}
          >
            SLA смола
          </button>
          <button
            type="button"
            className={`rounded-full min-h-[44px] px-2.5 py-2 text-[10px] uppercase tracking-[0.2em] sm:min-h-0 sm:px-3 sm:text-xs ${
              technology === "fdm"
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white"
            }`}
            onClick={() => onTechnologyChange("fdm")}
          >
            FDM пластик
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
            className={`rounded-2xl min-h-[44px] px-2.5 py-2 text-[10px] uppercase tracking-[0.2em] sm:min-h-0 sm:px-3 sm:text-xs ${
              format === "digital"
                ? "bg-[#2ED1FF]/20 text-[#2ED1FF]"
                : "bg-white/5 text-white/60 hover:text-white"
            }`}
            onClick={() => onFormatChange("digital")}
          >
            Цифровой STL
          </button>
          <button
            type="button"
            className={`rounded-2xl min-h-[44px] px-2.5 py-2 text-[10px] uppercase tracking-[0.2em] sm:min-h-0 sm:px-3 sm:text-xs ${
              format === "physical"
                ? "bg-[#2ED1FF]/20 text-[#2ED1FF]"
                : "bg-white/5 text-white/60 hover:text-white"
            }`}
            onClick={() => onFormatChange("physical")}
          >
            Печатная модель
          </button>
        </div>
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
                onCategoryChange("");
                onRequestClose?.();
              }}
            >
              <span>Все категории</span>
            </button>
            {categories?.map((category, categoryIndex) => {
              const isOpen = openCategory === category.title;
              return (
              <div
                key={`${category.title}-${categoryIndex}`}
                className="rounded-2xl bg-white/5 px-3 py-3 sm:px-4 sm:py-3"
              >
                <button
                  className="flex w-full items-center justify-between text-[13px] font-semibold text-white/80 sm:text-sm"
                  onClick={() => {
                    const nextOpen = isOpen ? "" : category.title;
                    setOpenCategory(nextOpen);
                    onCategoryChange(nextOpen);
                  }}
                >
                  <span>{category.title}</span>
                  <ChevronDown
                    className={`h-4 w-4 transition ${
                      isOpen ? "rotate-180 text-white" : "text-white/50"
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="mt-2.5 space-y-2 text-[13px] text-white/60 sm:mt-3 sm:text-sm">
                    {category.items?.map((item, itemIndex) => {
                      const count = categoryCounts.get(item) ?? 0;
                      const isActive = activeCategory === item;
                      return (
                        <button
                          key={`${category.title}-${item}-${itemIndex}`}
                          type="button"
                          className={`flex w-full min-h-[44px] items-center justify-between rounded-xl px-2.5 py-2 text-left transition sm:min-h-0 sm:px-3 ${
                            isActive
                              ? "bg-white/10 text-white"
                              : "bg-white/5 text-white/60 hover:text-white"
                          }`}
                          onClick={() => {
                            onCategoryChange(item);
                            onRequestClose?.();
                          }}
                        >
                          <span>{item}</span>
                          <span className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase text-white/40 sm:text-xs">
                            [{count}]
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
      </motion.div>

        <motion.div
          variants={itemVariants}
          className="mt-auto flex items-center justify-between gap-3 rounded-2xl bg-[#D4AF37]/10 px-3 py-2.5 sm:px-4 sm:py-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#D4AF37]/20 sm:h-9 sm:w-9">
              <ShieldCheck className="h-4 w-4 text-[#D4AF37] sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-[#D4AF37]/80">
                ПРОВЕРЕНО_ТОВАР
              </p>
              <p className="text-sm leading-snug text-white/70">
                Показывать только проверенные товары
              </p>
            </div>
          </div>
          <button
            className={`flex h-11 w-16 shrink-0 items-center rounded-full border border-[#D4AF37]/40 p-1 transition ${
              verified
                ? "bg-[#D4AF37]/40 shadow-[0_0_16px_rgba(212,175,55,0.5)]"
                : "bg-white/5"
            }`}
            onClick={() => onVerifiedChange(!verified)}
          >
          <span
            className={`block h-5 w-5 rounded-full bg-[#D4AF37] transition ${
              verified ? "translate-x-9" : "translate-x-0"
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
}: ExperienceProps) {
  const [isMobile, setIsMobile] = useState(false);
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
      case "warm":
        return { preset: "sunset" as const, intensity: 1.6 };
      case "cyber":
        return { preset: "night" as const, intensity: 2.2 };
      default:
        return { preset: "city" as const, intensity: 2 };
    }
  }, [lightingMode]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    if ("addEventListener" in media) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
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

  return (
    <Canvas
      camera={{ position: [5, 5, 5], fov: 42, near: 0.1, far: 1000 }}
      dpr={isMobile ? [1, 1.5] : [1, 2]}
      className="h-full w-full"
      gl={{ antialias: true, alpha: true }}
      style={{ touchAction: "none" }}
      onPointerDown={stopPropagation}
      onPointerMove={stopPropagation}
      onPointerUp={stopPropagation}
      onWheel={stopPropagation}
    >
      <CameraFitter
        bounds={modelBounds}
        url={modelUrl}
        scale={finalScale}
        controlsRef={controlsRef}
        cameraFitRef={cameraFitRef}
      />
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
          />
        </group>
      </Stage>
      <ContactShadows
        key={`shadow-${shadowScale}`}
        position={[0, shadowY, 0]}
        scale={shadowScale}
        opacity={0.6}
        blur={1.6}
        far={shadowScale * 0.8}
      />
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
        environmentIntensity={lightingConfig.intensity}
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
  const polyLabel = formatCount(polyCount) ?? "2,452,900";
  const printLabel = printTime || "14h 22m";
  const scaleLabel = scale || "1:1 REAL";
  const dimensionsLabel = dimensions || "-";

  return (
    <div className="absolute left-3 right-3 top-3 z-50 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 font-[var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.2em] text-white/70 sm:left-8 sm:right-auto sm:top-8 sm:grid-cols-1 sm:gap-2 sm:px-4 sm:py-3 sm:text-xs">
      <div className="col-span-3 text-[9px] tracking-[0.35em] text-white/40">
        ИНЖЕНЕРНЫЙ ВИД
      </div>
      <div className="flex flex-col gap-1 text-center text-[#2ED1FF] sm:flex-row sm:items-center sm:gap-2 sm:text-left">
        <span>ПОЛИГОНЫ:</span>
        <span className="text-white">{polyLabel}</span>
      </div>
      <div className="flex flex-col gap-1 text-center sm:mt-2 sm:flex-row sm:items-center sm:gap-2 sm:text-left">
        <span>ВРЕМЯ_ПЕЧАТИ:</span>
        <span className="text-white">{printLabel}</span>
      </div>
      <div className="flex flex-col gap-1 text-center sm:mt-2 sm:flex-row sm:items-center sm:gap-2 sm:text-left">
        <span>МАСШТАБ:</span>
        <span className="text-white">{scaleLabel}</span>
      </div>
      <div className="flex flex-col gap-1 text-center sm:mt-2 sm:flex-row sm:items-center sm:gap-2 sm:text-left">
        <span>ГАБАРИТЫ:</span>
        <span className="text-white">{dimensionsLabel}</span>
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
  icon: ReactNode;
  onClick: () => void;
};

function DockButton({ active, label, icon, onClick }: DockButtonProps) {
  return (
    <button
      className={`flex min-h-[44px] items-center gap-2 rounded-full px-3 py-2 text-[10px] uppercase tracking-[0.2em] transition sm:min-h-0 sm:px-3 sm:py-2 sm:text-xs ${
        active ? "bg-white/20 text-white" : "text-white/60 hover:text-white"
      }`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
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
};

function SystemStandbyPanel({ message, className }: SystemStandbyPanelProps) {
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-[10px] uppercase tracking-[0.3em] text-white/60 sm:px-6 sm:py-10 sm:text-xs ${className ?? ""}`}
    >
      <div className="pointer-events-none absolute inset-0 cad-grid-pattern opacity-30" />
      <div className="relative">{message}</div>
    </div>
  );
}
