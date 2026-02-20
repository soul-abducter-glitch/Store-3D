"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  Cpu,
  Gift,
  LifeBuoy,
  LogOut,
  CreditCard,
  RotateCcw,
  X,
  Package,
  Save,
  Settings,
  ShoppingCart,
  Pencil,
  Trash2,
  User,
} from "lucide-react";
import AuthForm from "@/components/AuthForm";
import {
  getCartStorageKey,
  readCartStorage,
  writeCartStorage,
  writeCheckoutSelection,
} from "@/lib/cartStorage";
import {
  getCheckoutDraftKey,
  readCheckoutDraftRecords,
  removeCheckoutDraftRecord,
  type CheckoutDraftRecord,
} from "@/lib/checkoutDrafts";
import {
  ORDER_PROGRESS_STEPS,
  ORDER_STATUS_UNREAD_KEY,
  getOrderProgressStage,
  getOrderStatusLabel,
  getOrderStatusTone,
  normalizeOrderStatus,
} from "@/lib/orderStatus";
import { getPaymentProviderLabel, getPaymentStatusLabel } from "@/lib/paymentStatus";

type CartItem = {
  id: string;
  productId: string;
  name: string;
  formatKey: "digital" | "physical";
  formatLabel: string;
  priceLabel: string;
  priceValue: number;
  quantity: number;
  thumbnailUrl: string;
  customPrint?: CustomPrintMeta | null;
};

type CustomPrintMeta = {
  uploadId: string;
  uploadUrl?: string;
  uploadName?: string;
  sourcePrice?: number;
  technology?: string;
  material?: string;
  color?: string;
  quality?: string;
  note?: string;
  packaging?: string;
  isHollow?: boolean;
  infillPercent?: number;
  dimensions?: { x: number; y: number; z: number };
  volumeCm3?: number;
};

type DownloadEntry = {
  id: string;
  source: "entitlement" | "legacy";
  entitlementId?: string;
  orderId?: string | null;
  productId: string;
  product: string;
  format: string;
  fileSize: string;
  previewUrl: string;
  ready: boolean;
  status: "ACTIVE" | "REVOKED";
  blockedReason?: string;
  purchasedAt?: string | null;
};

type AiAssetEntry = {
  id: string;
  title: string;
  modelUrl: string;
  previewUrl: string;
  format: string;
  status: string;
  mediaId?: string | null;
  isInMedia?: boolean;
  jobId?: string | null;
  previousAssetId?: string | null;
  familyId?: string;
  version?: number;
  sourceType?: string;
  sourceUrl?: string;
  checks?: {
    topology?: {
      nonManifold?: boolean | "unknown";
      holes?: boolean | "unknown";
      selfIntersections?: boolean | "unknown";
      thinWallsRisk?: "low" | "medium" | "high";
      watertight?: "yes" | "no" | "unknown";
      fixAvailable?: boolean;
      riskScore?: number;
      modelBytes?: number | null;
      analyzedAt?: string;
      issues?: Array<{ code?: string; severity?: string; message?: string }>;
    };
    rollback?: {
      at?: string;
      fromAssetId?: string;
      fromVersion?: number;
      appliedToVersion?: number;
    };
  } | null;
  fixAvailable?: boolean;
  versionDiff?: {
    formatChanged?: boolean;
    sizeChanged?: boolean;
    checksChanged?: boolean;
    sourceChanged?: boolean;
    changedKeys?: string[];
  } | null;
  createdAt?: string;
  updatedAt?: string;
};

type PaymentAuditEvent = {
  id: string;
  code: string;
  label: string;
  at?: string;
  amountMinor?: number;
  currency?: string;
  status?: string;
  source?: string;
};

type PaymentAudit = {
  orderId: string;
  orderStatus: string;
  paymentStatus: string;
  paymentProvider: string;
  paymentIntentId?: string | null;
  amountMinor?: number;
  currency?: string;
  events: PaymentAuditEvent[];
};

const NAME_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'-]{1,49}$/;
const PASSWORD_REGEX = /^(?=.*[A-Za-zА-Яа-яЁё])(?=.*\d)(?=.*[^A-Za-zА-Яа-яЁё\d]).{8,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AI_ASSET_NAME_MIN = 2;
const AI_ASSET_NAME_MAX = 40;
const DEBUG_ERROR_EMAILS = (process.env.NEXT_PUBLIC_DEBUG_ERROR_EMAILS || "")
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

const formatPrice = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }
  return new Intl.NumberFormat("ru-RU").format(value);
};

const DIGITAL_CANCEL_WINDOW_MINUTES = 30;
const PHYSICAL_CANCEL_WINDOW_MINUTES = 12 * 60;
const PAYMENT_RESUME_WINDOW_MINUTES = 30;
const DELIVERY_COST_MAP: Record<string, number> = {
  cdek: 200,
  yandex: 150,
  ozon: 100,
  pochta: 250,
  pickup: 0,
};

const isWithinCancelWindow = (createdAt: unknown, windowMinutes: number) => {
  if (!createdAt) return false;
  const createdAtMs = new Date(String(createdAt)).getTime();
  if (!Number.isFinite(createdAtMs)) return false;
  return Date.now() - createdAtMs <= windowMinutes * 60 * 1000;
};

const buildCartThumbnail = (label: string) => {
  const shortLabel = label.trim().slice(0, 2).toUpperCase() || "3D";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#1f2937"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="160" height="120" rx="24" fill="url(#g)"/><circle cx="120" cy="24" r="28" fill="rgba(46,209,255,0.25)"/><text x="18" y="70" fill="#E2E8F0" font-family="Arial, sans-serif" font-size="28" font-weight="700">${shortLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const formatLabelForKey = (formatKey: CartItem["formatKey"]) =>
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
    color: typeof raw.color === "string" ? raw.color : undefined,
    quality: typeof raw.quality === "string" ? raw.quality : undefined,
    note: typeof raw.note === "string" ? raw.note : undefined,
    packaging: typeof raw.packaging === "string" ? raw.packaging : undefined,
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

  const formatKey: CartItem["formatKey"] = item.formatKey === "physical" ? "physical" : "digital";
  const name = typeof item.name === "string" ? item.name : "Товар";
  const priceValue = typeof item.priceValue === "number" ? item.priceValue : 0;
  const quantity = typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
  const formatLabel =
    typeof item.formatLabel === "string" ? item.formatLabel : formatLabelForKey(formatKey);
  const priceLabel =
    typeof item.priceLabel === "string" ? item.priceLabel : formatPrice(priceValue);
  const thumbnailUrl =
    typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : buildCartThumbnail(name);
  const id =
    typeof item.id === "string" && item.productId ? item.id : `${productId}:${formatKey}`;
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

const resolveMediaUrl = (value?: any) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.url === "string") return value.url;
  if (typeof value?.filename === "string") return `/media/${value.filename}`;
  return "";
};

const formatLegacyFileSize = (bytes?: number) => {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return "N/A";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const formatted = size < 10 && unitIndex > 0 ? size.toFixed(1) : Math.round(size).toString();
  return `${formatted} ${units[unitIndex]}`;
};

const mapLegacyPurchasedDownloads = (user: any): DownloadEntry[] => {
  const purchasedProducts = Array.isArray(user?.purchasedProducts) ? user.purchasedProducts : [];
  return purchasedProducts
    .map((product: any, index: number) => {
      if (!product) return null;
      const rawModel = product?.rawModel;
      const paintedModel = product?.paintedModel;
      const productId = String(
        product?.id || product?.value || product?._id || product?.slug || ""
      ).trim();
      if (!productId) return null;
      const previewUrl = resolveMediaUrl(paintedModel) || resolveMediaUrl(rawModel);
      const fileSize =
        typeof rawModel?.filesize === "number"
          ? formatLegacyFileSize(rawModel.filesize)
          : typeof paintedModel?.filesize === "number"
            ? formatLegacyFileSize(paintedModel.filesize)
            : "N/A";
      return {
        id: `legacy:${productId}:${index}`,
        source: "legacy",
        orderId: null,
        productId,
        product: String(product?.name || product?.slug || "Цифровой STL"),
        format: "Digital STL",
        fileSize,
        previewUrl,
        ready: true,
        status: "ACTIVE",
        blockedReason: undefined,
        purchasedAt: null,
      } satisfies DownloadEntry;
    })
    .filter((entry: DownloadEntry | null): entry is DownloadEntry => Boolean(entry));
};

export default function ProfilePage() {
  const router = useRouter();
  const [queryTab, setQueryTab] = useState<string>("");
  const [queryRenameAssetId, setQueryRenameAssetId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<
    "orders" | "downloads" | "ai-assets" | "drafts" | "settings"
  >("orders");
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    name: "",
    email: "",
    shippingAddress: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null);
  const [cancelingOrderItemKey, setCancelingOrderItemKey] = useState<string | null>(null);
  const [reorderingOrderId, setReorderingOrderId] = useState<string | null>(null);
  const [creatingGiftForId, setCreatingGiftForId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [downloadsLoading, setDownloadsLoading] = useState(false);
  const [downloadsError, setDownloadsError] = useState<string | null>(null);
  const [pendingPaymentNow, setPendingPaymentNow] = useState(() => Date.now());
  const [aiAssets, setAiAssets] = useState<AiAssetEntry[]>([]);
  const [aiAssetsLoading, setAiAssetsLoading] = useState(false);
  const [aiAssetsError, setAiAssetsError] = useState<string | null>(null);
  const [aiAssetsVersionsView, setAiAssetsVersionsView] = useState<"latest" | "all">("latest");
  const [deletingAiAssetId, setDeletingAiAssetId] = useState<string | null>(null);
  const [downloadingAiAssetId, setDownloadingAiAssetId] = useState<string | null>(null);
  const [preparingAiAssetId, setPreparingAiAssetId] = useState<string | null>(null);
  const [renamingAiAssetId, setRenamingAiAssetId] = useState<string | null>(null);
  const [editingAiAssetId, setEditingAiAssetId] = useState<string | null>(null);
  const [editingAiAssetDraft, setEditingAiAssetDraft] = useState("");
  const [checkoutDrafts, setCheckoutDrafts] = useState<CheckoutDraftRecord[]>([]);
  const [openingDraftId, setOpeningDraftId] = useState<string | null>(null);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [paymentAuditOpenOrderId, setPaymentAuditOpenOrderId] = useState<string | null>(null);
  const [paymentAuditLoadingOrderId, setPaymentAuditLoadingOrderId] = useState<string | null>(null);
  const [paymentAuditByOrderId, setPaymentAuditByOrderId] = useState<Record<string, PaymentAudit>>(
    {}
  );
  const [paymentAuditErrorsByOrderId, setPaymentAuditErrorsByOrderId] = useState<
    Record<string, string>
  >({});
  const apiBase = "";
  const aiAssetInputRef = useRef<HTMLInputElement | null>(null);
  const aiAssetCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cartStorageKey = useMemo(() => getCartStorageKey(user?.id ?? null), [user?.id]);
  const checkoutDraftKey = useMemo(() => getCheckoutDraftKey(user?.id ?? null), [user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncCart = () => {
      const parsed = readCartStorage(cartStorageKey, { migrateLegacy: Boolean(user?.id) });
      const normalized = parsed
        .map((item) => normalizeStoredItem(item))
        .filter((item): item is CartItem => Boolean(item));
      setCartItems(normalized);
    };

    syncCart();
    const handleCartUpdated = () => syncCart();
    window.addEventListener("cart-updated", handleCartUpdated);
    return () => window.removeEventListener("cart-updated", handleCartUpdated);
  }, [cartStorageKey, user?.id]);

  const refreshCheckoutDrafts = useCallback(() => {
    setCheckoutDrafts(readCheckoutDraftRecords(user?.id ?? null));
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    refreshCheckoutDrafts();

    const handleStorage = (event: StorageEvent) => {
      const key = event.key || "";
      if (!key) return;
      if (key.includes("checkout:drafts:v1") || key === checkoutDraftKey) {
        refreshCheckoutDrafts();
      }
    };

    const handleFocus = () => refreshCheckoutDrafts();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
    };
  }, [checkoutDraftKey, refreshCheckoutDrafts]);

  const handleOpenCheckoutDraft = async (draft: CheckoutDraftRecord) => {
    if (typeof window === "undefined") {
      return;
    }
    setOpeningDraftId(draft.id);
    try {
      const payload = {
        form: draft.form || {},
        paymentMethod: draft.paymentMethod || "card",
        promoCodeInput: draft.promoCodeInput || "",
        savedAt: draft.updatedAt || new Date().toISOString(),
      };
      window.localStorage.setItem(checkoutDraftKey, JSON.stringify(payload));

      if (Array.isArray(draft.selectedItemIds) && draft.selectedItemIds.length > 0) {
        writeCheckoutSelection(cartStorageKey, draft.selectedItemIds);
      }

      toast.success("Черновик открыт.");
      router.push("/checkout");
    } catch {
      toast.error("Не удалось открыть черновик.");
    } finally {
      setOpeningDraftId(null);
    }
  };

  const handleDeleteCheckoutDraft = async (draftId: string) => {
    setDeletingDraftId(draftId);
    try {
      removeCheckoutDraftRecord(user?.id ?? null, draftId);
      refreshCheckoutDrafts();
      toast.success("Черновик удален.");
    } catch {
      toast.error("Не удалось удалить черновик.");
    } finally {
      setDeletingDraftId(null);
    }
  };

  useEffect(() => {
    if (activeTab !== "orders") {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ORDER_STATUS_UNREAD_KEY, "0");
    window.dispatchEvent(new Event("order-status-unread"));
  }, [activeTab]);

  useEffect(() => {
    fetch(`${apiBase}/api/users/me?depth=2`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setUser(data?.user || data?.doc || null);
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });
  }, [apiBase]);

  useEffect(() => {
    if (!user) {
      return;
    }
    setSettingsForm((prev) => ({
      ...prev,
      name: typeof user.name === "string" ? user.name : "",
      email: typeof user.email === "string" ? user.email : "",
      shippingAddress: typeof user.shippingAddress === "string" ? user.shippingAddress : "",
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    }));
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;
    fetch(`${apiBase}/api/digital/claim-email`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    }).catch(() => null);
  }, [apiBase, user?.id]);

  useEffect(() => {
    const refetchUser = () => {
      fetch(`${apiBase}/api/users/me?depth=2`, { credentials: "include", cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setUser(data?.user || data?.doc || null))
        .catch(() => null);
    };
    window.addEventListener("orders-updated", refetchUser);
    return () => window.removeEventListener("orders-updated", refetchUser);
  }, [apiBase]);

  useEffect(() => {
    if (!user?.email) {
      setOrders([]);
      setOrdersError(null);
      setOrdersLoading(false);
      return;
    }

    let active = true;
    let currentController: AbortController | null = null;
    const params = new URLSearchParams();
    const normalizedEmail = user?.email ? String(user.email).toLowerCase() : "";
    if (user?.id && normalizedEmail) {
      params.set("where[or][0][user][equals]", String(user.id));
      params.set("where[or][1][customer.email][equals]", normalizedEmail);
    } else if (user?.id) {
      params.set("where[user][equals]", String(user.id));
    } else if (normalizedEmail) {
      params.set("where[customer.email][equals]", normalizedEmail);
    }
    params.set("depth", "2");
    params.set("limit", "20");

    const fetchOrders = () => {
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;

      setOrdersLoading(true);
      setOrdersError(null);

      fetch(`${apiBase}/api/orders?${params.toString()}`, {
        credentials: "include",
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((data) => {
          if (!active) return;
          setOrders(Array.isArray(data?.docs) ? data.docs : []);
        })
        .catch((err) => {
          if (!active || err?.name === "AbortError") {
            return;
          }
          setOrdersError("Не удалось загрузить заказы.");
        })
        .finally(() => {
          if (!active || controller.signal.aborted) {
            return;
          }
          setOrdersLoading(false);
        });
    };

    fetchOrders();
    const handleOrdersUpdated = () => fetchOrders();
    window.addEventListener("orders-updated", handleOrdersUpdated);

    return () => {
      active = false;
      currentController?.abort();
      window.removeEventListener("orders-updated", handleOrdersUpdated);
    };
  }, [user, apiBase]);

  const fetchDownloads = useCallback(async () => {
    if (!user?.id) {
      setDownloads([]);
      setDownloadsError(null);
      setDownloadsLoading(false);
      return;
    }

    setDownloadsLoading(true);
    setDownloadsError(null);
    try {
      const response = await fetch(`${apiBase}/api/digital/library`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось загрузить цифровую библиотеку.");
      }

      const docs = Array.isArray(data?.items) ? data.items : [];
      const entitlementDownloads: DownloadEntry[] = docs
        .map((entry: any) => {
          const productId = String(entry?.productId || "").trim();
          const entitlementId = String(entry?.entitlementId || "").trim();
          if (!productId || !entitlementId) return null;
          const ready = Boolean(entry?.canDownload);
          return {
            id: String(entry?.id || entitlementId),
            source: "entitlement",
            entitlementId,
            orderId:
              entry?.orderId !== null && entry?.orderId !== undefined
                ? String(entry.orderId).trim() || null
                : null,
            productId,
            product: String(entry?.title || "Цифровой файл"),
            format: String(entry?.format || "Digital STL"),
            fileSize: String(entry?.fileSize || "N/A"),
            previewUrl: typeof entry?.previewUrl === "string" ? entry.previewUrl : "",
            ready,
            status: String(entry?.status || "").toUpperCase() === "REVOKED" ? "REVOKED" : "ACTIVE",
            blockedReason:
              typeof entry?.blockedReason === "string" && entry.blockedReason.trim()
                ? entry.blockedReason.trim()
                : undefined,
            purchasedAt: typeof entry?.purchasedAt === "string" ? entry.purchasedAt : null,
          } satisfies DownloadEntry;
        })
        .filter((entry: DownloadEntry | null): entry is DownloadEntry => Boolean(entry));

      const legacyDownloads = mapLegacyPurchasedDownloads(user);
      const mergedByProductId = new Map<string, DownloadEntry>();
      for (const legacy of legacyDownloads) {
        mergedByProductId.set(legacy.productId, legacy);
      }
      for (const entitlement of entitlementDownloads) {
        const existing = mergedByProductId.get(entitlement.productId);
        if (!existing) {
          mergedByProductId.set(entitlement.productId, entitlement);
          continue;
        }
        if (!existing.ready && entitlement.ready) {
          mergedByProductId.set(entitlement.productId, entitlement);
          continue;
        }
        const existingTime = existing.purchasedAt ? new Date(existing.purchasedAt).getTime() : 0;
        const nextTime = entitlement.purchasedAt ? new Date(entitlement.purchasedAt).getTime() : 0;
        if (nextTime >= existingTime) {
          mergedByProductId.set(entitlement.productId, entitlement);
        }
      }
      const merged = Array.from(mergedByProductId.values()).sort((a, b) => {
        const aTime = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
        const bTime = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
        return bTime - aTime;
      });

      setDownloads(merged);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось загрузить цифровую библиотеку.";
      setDownloadsError(message);
    } finally {
      setDownloadsLoading(false);
    }
  }, [apiBase, user]);

  useEffect(() => {
    if (activeTab !== "downloads") return;
    void fetchDownloads();
  }, [activeTab, fetchDownloads]);

  useEffect(() => {
    const handleOrdersUpdated = () => {
      if (activeTab === "downloads") {
        void fetchDownloads();
      }
    };
    window.addEventListener("orders-updated", handleOrdersUpdated);
    return () => window.removeEventListener("orders-updated", handleOrdersUpdated);
  }, [activeTab, fetchDownloads]);

  const fetchAiAssets = useCallback(async () => {
    if (!user?.id) {
      setAiAssets([]);
      setAiAssetsError(null);
      setAiAssetsLoading(false);
      return;
    }

    setAiAssetsLoading(true);
    setAiAssetsError(null);
    try {
      const response = await fetch(
        `${apiBase}/api/ai/assets?limit=60&versions=${aiAssetsVersionsView === "all" ? "all" : "latest"}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Не удалось загрузить AI-библиотеку.");
      }
      setAiAssets(Array.isArray(data?.assets) ? data.assets : []);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось загрузить AI-библиотеку.";
      setAiAssetsError(message);
    } finally {
      setAiAssetsLoading(false);
    }
  }, [aiAssetsVersionsView, apiBase, user?.id]);

  useEffect(() => {
    void fetchAiAssets();
  }, [fetchAiAssets]);

  useEffect(() => {
    const handleAiAssetsUpdated = () => {
      void fetchAiAssets();
    };
    window.addEventListener("ai-assets-updated", handleAiAssetsUpdated);
    return () => window.removeEventListener("ai-assets-updated", handleAiAssetsUpdated);
  }, [fetchAiAssets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const applyQuery = () => {
      const params = new URLSearchParams(window.location.search || "");
      setQueryTab((params.get("tab") || "").trim());
      setQueryRenameAssetId((params.get("renameAssetId") || "").trim());
    };

    applyQuery();
    window.addEventListener("popstate", applyQuery);
    return () => window.removeEventListener("popstate", applyQuery);
  }, []);

  useEffect(() => {
    const tab = queryTab;
    if (tab === "orders" || tab === "downloads" || tab === "ai-assets" || tab === "drafts" || tab === "settings") {
      setActiveTab(tab);
    }
  }, [queryTab]);

  useEffect(() => {
    if (!editingAiAssetId || !aiAssetInputRef.current) return;
    aiAssetInputRef.current.focus();
    aiAssetInputRef.current.select();
  }, [editingAiAssetId]);

  const openAiAssetRename = useCallback((asset: AiAssetEntry) => {
    setEditingAiAssetId(asset.id);
    setEditingAiAssetDraft(asset.title || "");
  }, []);

  const closeAiAssetRename = useCallback(() => {
    setEditingAiAssetId(null);
    setEditingAiAssetDraft("");
  }, []);

  const saveAiAssetName = useCallback(
    async (assetId: string, rawName: string) => {
      const normalized = rawName.replace(/\s+/g, " ").trim();
      if (!normalized) {
        toast.error("Введите название.", { className: "sonner-toast" });
        return;
      }
      if (normalized.length < AI_ASSET_NAME_MIN) {
        toast.error(`Название должно быть не короче ${AI_ASSET_NAME_MIN} символов.`, {
          className: "sonner-toast",
        });
        return;
      }
      if (normalized.length > AI_ASSET_NAME_MAX) {
        toast.error(`Название должно быть не длиннее ${AI_ASSET_NAME_MAX} символов.`, {
          className: "sonner-toast",
        });
        return;
      }

      const prev = aiAssets.find((entry) => entry.id === assetId);
      if (!prev) {
        closeAiAssetRename();
        return;
      }
      if (prev.title === normalized) {
        closeAiAssetRename();
        return;
      }

      closeAiAssetRename();
      setRenamingAiAssetId(assetId);
      setAiAssets((current) =>
        current.map((entry) => (entry.id === assetId ? { ...entry, title: normalized } : entry))
      );

      try {
        const response = await fetch(`${apiBase}/api/ai/assets/${encodeURIComponent(assetId)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: normalized }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "Не удалось сохранить название."
          );
        }
      } catch (error) {
        setAiAssets((current) =>
          current.map((entry) => (entry.id === assetId ? { ...entry, title: prev.title } : entry))
        );
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Не удалось сохранить. Повторить?";
        toast.error(message, {
          className: "sonner-toast",
          action: {
            label: "Повторить",
            onClick: () => {
              void saveAiAssetName(assetId, normalized);
            },
          },
        });
      } finally {
        setRenamingAiAssetId((current) => (current === assetId ? null : current));
      }
    },
    [aiAssets, apiBase, closeAiAssetRename]
  );

  useEffect(() => {
    const renameAssetId = queryRenameAssetId;
    if (!renameAssetId) return;
    if (activeTab !== "ai-assets") return;
    if (aiAssetsLoading) return;
    const asset = aiAssets.find((entry) => entry.id === renameAssetId);
    if (!asset) return;

    openAiAssetRename(asset);
    const targetNode = aiAssetCardRefs.current[renameAssetId];
    targetNode?.scrollIntoView({ block: "center", behavior: "smooth" });

    setQueryRenameAssetId("");
    if (typeof window !== "undefined") {
      const nextParams = new URLSearchParams(window.location.search || "");
      nextParams.delete("renameAssetId");
      const query = nextParams.toString();
      const nextUrl = `/profile${query ? `?${query}` : ""}`;
      window.history.replaceState(null, "", nextUrl);
    }
  }, [activeTab, aiAssets, aiAssetsLoading, openAiAssetRename, queryRenameAssetId]);

  const handleLogout = async () => {
    try {
      const response = await fetch(`${apiBase}/api/users/logout`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Logout failed: ${response.status}`);
      }
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
        });
      } catch {
        // ignore secondary logout errors
      }
      setUser(null);
      setLoading(false);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("auth-updated"));
      }
      router.push("/");
    }
  };

  const handleSettingsChange =
    (field: keyof typeof settingsForm) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setSettingsForm((prev) => ({ ...prev, [field]: value }));
      setSettingsError(null);
      setSettingsSuccess(null);
    };

  const getErrorMessage = async (response: Response, email?: string | null) => {
    try {
      const data = await response.json();
      console.error("Profile update error:", data);
      const showDetails =
        process.env.NEXT_PUBLIC_DEBUG_ERRORS === "true" ||
        (email ? DEBUG_ERROR_EMAILS.includes(email.toLowerCase()) : false);
      if (showDetails) {
        return (
          data?.errors?.[0]?.data?.errors?.[0]?.message ||
          data?.errors?.[0]?.message ||
          data?.message ||
          "Request failed."
        );
      }
    } catch {
      // ignore parsing errors
    }
    return "Не удалось сохранить изменения. Проверьте данные и попробуйте снова.";
  };

  const handleSettingsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (settingsSaving || !user?.id) {
      return;
    }

    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSuccess(null);

    const trimmedName = settingsForm.name.trim();
    const trimmedEmail = settingsForm.email.trim();
    const trimmedAddress = settingsForm.shippingAddress.trim();
    const currentPassword = settingsForm.currentPassword;
    const newPassword = settingsForm.newPassword;
    const confirmPassword = settingsForm.confirmPassword;

    try {
      if (!trimmedName) {
        throw new Error("Имя обязательно.");
      }
      if (!NAME_REGEX.test(trimmedName)) {
        throw new Error("Имя: только буквы, пробелы, дефис или апостроф.");
      }
      if (!trimmedEmail) {
        throw new Error("Email обязателен.");
      }

      if (newPassword || confirmPassword || currentPassword) {
        if (!currentPassword) {
          throw new Error("Введите текущий пароль.");
        }
        if (!newPassword) {
          throw new Error("Введите новый пароль.");
        }
        if (newPassword !== confirmPassword) {
          throw new Error("Пароли не совпадают.");
        }
        if (!PASSWORD_REGEX.test(newPassword)) {
          throw new Error("Пароль: минимум 8 символов, буквы, цифры и спецсимвол.");
        }

        const verifyResponse = await fetch(`${apiBase}/api/users/login`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail, password: currentPassword }),
        });
        if (!verifyResponse.ok) {
          throw new Error("Текущий пароль неверный.");
        }
      }

      const payload: Record<string, any> = {
        name: trimmedName,
        email: trimmedEmail,
        shippingAddress: trimmedAddress,
      };
      if (newPassword) {
        payload.password = newPassword;
      }

      const response = await fetch(`${apiBase}/api/users/${encodeURIComponent(String(user.id))}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = await getErrorMessage(response, trimmedEmail);
        throw new Error(message);
      }

      const data = await response.json();
      const updatedUser = data?.doc ?? data ?? null;
      if (updatedUser) {
        setUser(updatedUser);
      }
      setSettingsForm((prev) => ({
        ...prev,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      }));
      setSettingsSuccess("Данные профиля обновлены.");
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Не удалось сохранить изменения.";
      setSettingsError(message);
    } finally {
      setSettingsSaving(false);
    }
  };

  const formatDate = (value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  };

  const formatDateTime = (value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  };

  const formatShortDateTime = (value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}.${month} ${hours}:${minutes}`;
  };

  const formatMinorAmount = (amountMinor?: number, currency?: string) => {
    if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor)) return "";
    const major = amountMinor / 100;
    const code = (currency || "rub").toUpperCase();
    if (code === "RUB") {
      return `${formatPrice(major)} ₽`;
    }
    return `${formatPrice(major)} ${code}`;
  };

  const formatAuditStatusLabel = (status?: string) => {
    if (!status) return "";
    const raw = status.trim().toLowerCase();
    if (
      raw === "pending" ||
      raw === "paid" ||
      raw === "failed" ||
      raw === "error" ||
      raw === "refunded" ||
      raw === "refund" ||
      raw === "success"
    ) {
      return getPaymentStatusLabel(raw);
    }
    if (raw === "succeeded") return "Оплачено";
    if (raw === "processing") return "В обработке";
    if (raw === "requires_payment_method") return "Требуется способ оплаты";
    if (raw === "requires_action") return "Требуется действие";
    if (raw === "requires_confirmation") return "Требуется подтверждение";
    if (raw === "canceled" || raw === "cancelled") return "Отменено";
    return status;
  };

  const getOrderItems = (order: any) => (Array.isArray(order?.items) ? order.items : []);

  const getOrderProduct = (order: any) => {
    const items = getOrderItems(order);
    const firstItem = items[0];
    const product = firstItem?.product ?? order?.product;
    if (product && typeof product === "object") {
      return product;
    }
    if (typeof product === "string") {
      return { name: product };
    }
    return null;
  };

  const getOrderProductName = (order: any) => {
    const product = getOrderProduct(order);
    return product?.name || "Товар";
  };

  const getOrderFormatLabel = (format?: string) => {
    if (format === "Digital") return "Цифровой STL";
    if (format === "Physical") return "Печатная модель";
    return format || "Не указано";
  };

  const getOrderPrimaryFormat = (order: any) => {
    const items = getOrderItems(order);
    return getOrderFormatLabel(items[0]?.format);
  };

  const getOrderPrintInfo = (order: any) => {
    const items = getOrderItems(order);
    const printItem =
      items.find(
        (item: { printSpecs?: unknown; customerUpload?: unknown }) =>
          item?.printSpecs || item?.customerUpload
      ) ?? (items.length > 0 ? items[0] : null);
    const upload = printItem?.customerUpload ?? order?.customFile ?? null;
    const filename =
      (typeof upload?.alt === "string" && upload.alt) ||
      (typeof upload?.filename === "string" ? upload.filename : null);
    const technology =
      typeof printItem?.printSpecs?.technology === "string"
        ? printItem.printSpecs.technology
        : null;
    const material =
      typeof printItem?.printSpecs?.material === "string"
        ? printItem.printSpecs.material
        : null;
    const color =
      typeof printItem?.printSpecs?.color === "string" ? printItem.printSpecs.color : null;
    const quality =
      typeof printItem?.printSpecs?.quality === "string"
        ? printItem.printSpecs.quality
        : null;
    const packaging =
      typeof printItem?.printSpecs?.packaging === "string"
        ? printItem.printSpecs.packaging
        : null;
    const note =
      typeof printItem?.printSpecs?.note === "string" ? printItem.printSpecs.note : null;
    const isHollow =
      typeof printItem?.printSpecs?.isHollow === "boolean"
        ? printItem.printSpecs.isHollow
        : null;
    return { filename, technology, material, color, quality, packaging, note, isHollow };
  };

  const getOrderStatusClass = (status?: string) => getOrderStatusTone(status);

  const isDigitalOrder = (order: any) => {
    const items = getOrderItems(order);
    return items.some((item: { format?: string }) => item?.format === "Digital");
  };

  const resolveCancelWindowForItem = (item: any) =>
    item?.format === "Physical" ? PHYSICAL_CANCEL_WINDOW_MINUTES : DIGITAL_CANCEL_WINDOW_MINUTES;

  const resolveCancelWindowForOrder = (order: any) => {
    const items = getOrderItems(order);
    if (!items.length) {
      return DIGITAL_CANCEL_WINDOW_MINUTES;
    }
    const hasPhysical = items.some((item: { format?: string }) => item?.format === "Physical");
    const hasDigital = items.some((item: { format?: string }) => item?.format !== "Physical");
    if (hasPhysical && !hasDigital) {
      return PHYSICAL_CANCEL_WINDOW_MINUTES;
    }
    return DIGITAL_CANCEL_WINDOW_MINUTES;
  };

  const canCancelByStatus = (order: any) => {
    const key = normalizeOrderStatus(order?.status);
    if (key === "ready" || key === "completed" || key === "cancelled") {
      return false;
    }
    return true;
  };

  const canCancelOrder = (order: any) => {
    if (!canCancelByStatus(order)) {
      return false;
    }
    const items = getOrderItems(order);
    if (!items.length) {
      return false;
    }
    return isWithinCancelWindow(order?.createdAt, resolveCancelWindowForOrder(order));
  };

  const canCancelOrderItem = (order: any, item: any) => {
    if (!canCancelByStatus(order)) {
      return false;
    }
    return isWithinCancelWindow(order?.createdAt, resolveCancelWindowForItem(item));
  };

  const getOrderItemKey = (item: any, index: number) =>
    typeof item?.id === "string" && item.id.trim() ? item.id : `idx:${index}`;

  const getOrderItemProductName = (item: any) => {
    const product = item?.product;
    if (product && typeof product === "object" && typeof product?.name === "string") {
      return product.name;
    }
    if (typeof product === "string" && product.trim()) {
      return product;
    }
    return "Товар";
  };

  const getOrderItemTotalLabel = (item: any) => {
    const quantity = typeof item?.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
    const unitPrice = typeof item?.unitPrice === "number" && item.unitPrice >= 0 ? item.unitPrice : 0;
    return {
      quantity,
      unitPrice,
      lineTotal: formatPrice(quantity * unitPrice),
      unitPriceLabel: formatPrice(unitPrice),
    };
  };

  const resolveOrderDeliveryCost = (order: any) => {
    const shippingMethod =
      typeof order?.shipping?.method === "string" ? order.shipping.method.trim().toLowerCase() : "";
    if (!shippingMethod) return 0;
    return DELIVERY_COST_MAP[shippingMethod] ?? 0;
  };

  const getOrderPricingSummary = (order: any) => {
    const items = getOrderItems(order);
    const subtotal = items.reduce((sum: number, item: any) => {
      const quantity = typeof item?.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
      const unitPrice =
        typeof item?.unitPrice === "number" && item.unitPrice >= 0 ? item.unitPrice : 0;
      return sum + quantity * unitPrice;
    }, 0);
    const deliveryCost = resolveOrderDeliveryCost(order);
    return {
      subtotal,
      deliveryCost,
      total: subtotal + deliveryCost,
    };
  };

  const resolveRelationshipId = (value: unknown) => {
    const raw =
      value && typeof value === "object"
        ? (value as { id?: unknown; value?: unknown; _id?: unknown }).id ??
          (value as { id?: unknown; value?: unknown; _id?: unknown }).value ??
          (value as { id?: unknown; value?: unknown; _id?: unknown })._id
        : value;
    if (raw === null || raw === undefined) {
      return null;
    }
    const normalized = String(raw).split(":")[0].trim();
    if (!normalized || /\s/.test(normalized)) {
      return null;
    }
    return normalized;
  };

  const handleRepeatOrder = (order: any) => {
    const orderId = String(order?.id ?? "");
    if (!orderId || reorderingOrderId) {
      return;
    }

    const sourceItems = Array.isArray(order?.items) ? order.items : [];
    if (!sourceItems.length) {
      toast.error("В заказе нет позиций для повтора.", { className: "sonner-toast" });
      return;
    }

    if (
      typeof window !== "undefined" &&
      cartItems.length > 0 &&
      !window.confirm(`В корзине уже есть товары. Заменить корзину заказом №${orderId}?`)
    ) {
      return;
    }

    setReorderingOrderId(orderId);

    try {
      const rebuiltItems: CartItem[] = sourceItems
        .map((item: any): CartItem | null => {
          const product = item?.product;
          const productId = resolveRelationshipId(product);
          if (!productId) {
            return null;
          }

          const formatKey: CartItem["formatKey"] = item?.format === "Physical" ? "physical" : "digital";
          const quantity =
            typeof item?.quantity === "number" && item.quantity > 0 ? Math.floor(item.quantity) : 1;
          const unitPrice = typeof item?.unitPrice === "number" && item.unitPrice >= 0 ? item.unitPrice : 0;
          const productName =
            product && typeof product === "object" && typeof product?.name === "string" && product.name.trim()
              ? product.name.trim()
              : getOrderProductName(order);
          const thumbnailUrl =
            resolveMediaUrl(product?.paintedModel) ||
            resolveMediaUrl(product?.rawModel) ||
            buildCartThumbnail(productName);

          const upload = item?.customerUpload;
          const uploadId = resolveRelationshipId(upload);
          const dimensions =
            item?.printSpecs?.dimensions && typeof item.printSpecs.dimensions === "object"
              ? {
                  x: Number(item.printSpecs.dimensions.x) || 0,
                  y: Number(item.printSpecs.dimensions.y) || 0,
                  z: Number(item.printSpecs.dimensions.z) || 0,
                }
              : undefined;

          const customPrint: CustomPrintMeta | null =
            formatKey === "physical" && uploadId
              ? {
                  uploadId,
                  uploadUrl: resolveMediaUrl(upload),
                  uploadName:
                    (typeof upload?.alt === "string" && upload.alt) ||
                    (typeof upload?.filename === "string" && upload.filename) ||
                    undefined,
                  sourcePrice: unitPrice,
                  technology:
                    typeof item?.printSpecs?.technology === "string"
                      ? item.printSpecs.technology
                      : undefined,
                  material:
                    typeof item?.printSpecs?.material === "string" ? item.printSpecs.material : undefined,
                  color:
                    typeof item?.printSpecs?.color === "string" ? item.printSpecs.color : undefined,
                  quality:
                    typeof item?.printSpecs?.quality === "string" ? item.printSpecs.quality : undefined,
                  note:
                    typeof item?.printSpecs?.note === "string" ? item.printSpecs.note : undefined,
                  packaging:
                    typeof item?.printSpecs?.packaging === "string"
                      ? item.printSpecs.packaging
                      : undefined,
                  isHollow:
                    typeof item?.printSpecs?.isHollow === "boolean"
                      ? item.printSpecs.isHollow
                      : undefined,
                  infillPercent:
                    typeof item?.printSpecs?.infillPercent === "number"
                      ? item.printSpecs.infillPercent
                      : undefined,
                  dimensions,
                  volumeCm3:
                    typeof item?.printSpecs?.volumeCm3 === "number"
                      ? item.printSpecs.volumeCm3
                      : undefined,
                }
              : null;

          return {
            id: customPrint?.uploadId ? `custom-print:${customPrint.uploadId}` : `${productId}:${formatKey}`,
            productId,
            name: productName,
            formatKey,
            formatLabel: getOrderFormatLabel(item?.format),
            priceLabel: formatPrice(unitPrice),
            priceValue: unitPrice,
            quantity,
            thumbnailUrl,
            customPrint,
          };
        })
        .filter((item: CartItem | null): item is CartItem => Boolean(item));

      if (!rebuiltItems.length) {
        throw new Error("Не удалось собрать товары для повтора.");
      }

      const mergedItems = rebuiltItems.reduce<CartItem[]>((acc, item) => {
        const existingIndex = acc.findIndex((entry) => entry.id === item.id);
        if (existingIndex >= 0) {
          const existing = acc[existingIndex];
          acc[existingIndex] = {
            ...existing,
            quantity: existing.quantity + item.quantity,
          };
          return acc;
        }
        acc.push(item);
        return acc;
      }, []);

      writeCartStorage(cartStorageKey, mergedItems);
      setCartItems(mergedItems);
      toast.success(`Заказ №${orderId} добавлен в корзину.`, { className: "sonner-toast" });
      router.push("/checkout");
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось повторить заказ. Попробуйте снова.";
      toast.error(message, { className: "sonner-toast" });
    } finally {
      setReorderingOrderId(null);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (cancelingOrderId) {
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Отменить заказ? Эта операция необратима.");
      if (!confirmed) {
        return;
      }
    }

    setCancelingOrderId(orderId);
    setOrdersError(null);

    try {
      const response = await fetch(`${apiBase}/api/orders/${orderId}/cancel`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const errorMessage =
          errorBody?.errors?.[0]?.message ||
          errorBody?.message ||
          errorBody?.error ||
          "Не удалось отменить заказ.";
        throw new Error(errorMessage);
      }

      const data = await response.json().catch(() => null);
      setOrders((prev) =>
        prev.map((order) =>
          String(order.id) === orderId ? { ...order, status: "cancelled" } : order
        )
      );
      const refundMinor =
        typeof data?.refund?.amountMinor === "number" ? data.refund.amountMinor : 0;
      const refundAmount = refundMinor > 0 ? refundMinor / 100 : 0;
      if (data?.refund?.refunded && refundAmount > 0) {
        toast.success(`Заказ отменен. Возврат: ${formatPrice(refundAmount)} ₽`, {
          className: "sonner-toast",
        });
      } else {
        toast.success("Заказ отменен.", { className: "sonner-toast" });
      }
      window.dispatchEvent(new Event("orders-updated"));
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось отменить заказ. Проверьте лимит времени отмены (digital 30 минут, physical 12 часов).";
      toast.error(message, { className: "sonner-toast" });
      setOrdersError(null);
    } finally {
      setCancelingOrderId(null);
    }
  };

  const handleCancelOrderItem = async (orderId: string, itemKey: string, itemIndex: number) => {
    if (cancelingOrderItemKey || cancelingOrderId) {
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Отменить выбранную позицию в заказе?");
      if (!confirmed) {
        return;
      }
    }

    const requestKey = `${orderId}:${itemKey}`;
    setCancelingOrderItemKey(requestKey);
    setOrdersError(null);

    try {
      const response = await fetch(`${apiBase}/api/orders/${orderId}/cancel`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          itemId: itemKey.startsWith("idx:") ? undefined : itemKey,
          itemIndex,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const errorMessage =
          errorBody?.errors?.[0]?.message ||
          errorBody?.message ||
          errorBody?.error ||
          "Не удалось отменить позицию заказа.";
        throw new Error(errorMessage);
      }

      const data = await response.json().catch(() => null);
      const updatedDoc = data?.doc ?? null;
      if (updatedDoc?.id) {
        setOrders((prev) =>
          prev.map((order) =>
            String(order.id) === String(updatedDoc.id) ? updatedDoc : order
          )
        );
      } else {
        window.dispatchEvent(new Event("orders-updated"));
      }
      const refundMinor =
        typeof data?.refund?.amountMinor === "number" ? data.refund.amountMinor : 0;
      const refundAmount = refundMinor > 0 ? refundMinor / 100 : 0;
      if (data?.refund?.refunded && refundAmount > 0) {
        toast.success(`Позиция отменена. Возврат: ${formatPrice(refundAmount)} ₽`, {
          className: "sonner-toast",
        });
      } else {
        toast.success("Позиция отменена.", { className: "sonner-toast" });
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось отменить позицию. Проверьте лимит времени отмены (digital 30 минут, physical 12 часов).";
      toast.error(message, { className: "sonner-toast" });
      setOrdersError(null);
    } finally {
      setCancelingOrderItemKey(null);
    }
  };

  const handleTogglePaymentAudit = async (orderId: string) => {
    if (paymentAuditOpenOrderId === orderId) {
      setPaymentAuditOpenOrderId(null);
      return;
    }

    setPaymentAuditOpenOrderId(orderId);
    if (paymentAuditByOrderId[orderId] || paymentAuditLoadingOrderId === orderId) {
      return;
    }

    setPaymentAuditLoadingOrderId(orderId);
    setPaymentAuditErrorsByOrderId((prev) => {
      const next = { ...prev };
      delete next[orderId];
      return next;
    });

    try {
      const response = await fetch(`${apiBase}/api/orders/${orderId}/payment-audit`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success || !data?.audit) {
        throw new Error(data?.error || "Не удалось загрузить детали оплаты.");
      }

      setPaymentAuditByOrderId((prev) => ({
        ...prev,
        [orderId]: data.audit as PaymentAudit,
      }));
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось загрузить детали оплаты.";
      setPaymentAuditErrorsByOrderId((prev) => ({ ...prev, [orderId]: message }));
    } finally {
      setPaymentAuditLoadingOrderId((prev) => (prev === orderId ? null : prev));
    }
  };

  const handleOpenOrderReceiptPrint = (orderId: string) => {
    if (typeof window === "undefined") return;
    const url = `${apiBase}/api/orders/${orderId}/receipt?print=1`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleCreateGiftLink = async (item: { id: string; product: string; productId?: string }) => {
    if (!item.productId) {
      toast.error("Не удалось определить модель для подарка.", { className: "sonner-toast" });
      return;
    }

    const recipientEmail = window.prompt("Введите email получателя подарка:")?.trim().toLowerCase();
    if (!recipientEmail) {
      return;
    }
    if (!EMAIL_REGEX.test(recipientEmail)) {
      toast.error("Некорректный email получателя.", { className: "sonner-toast" });
      return;
    }

    setCreatingGiftForId(item.id);
    try {
      const response = await fetch(`${apiBase}/api/gift/create`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: item.productId,
          recipientEmail,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success || typeof data?.giftUrl !== "string") {
        throw new Error(data?.error || "Не удалось создать подарочную ссылку.");
      }

      const link = data.giftUrl;
      let copied = false;
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(link);
          copied = true;
        } catch {
          copied = false;
        }
      }

      if (!copied) {
        window.prompt("Скопируйте ссылку вручную:", link);
      }

      toast.success(
        copied
          ? `Подарочная ссылка для "${item.product}" скопирована.`
          : `Подарочная ссылка для "${item.product}" создана.`,
        { className: "sonner-toast" }
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось создать подарочную ссылку.";
      toast.error(message, { className: "sonner-toast" });
    } finally {
      setCreatingGiftForId(null);
    }
  };

  const canResumeDownloadPayment = (item: DownloadEntry) => {
    if (item.ready) return false;
    if (!item.orderId) return false;
    const reason = String(item.blockedReason || "").trim().toLowerCase();
    return reason.includes("покупка не подтверждена");
  };

  const formatPaymentCountdown = (remainingMs: number) => {
    const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
        seconds
      ).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const getResumePaymentMeta = (item: DownloadEntry) => {
    if (!canResumeDownloadPayment(item)) return null;
    const createdAtMs = item.purchasedAt ? new Date(item.purchasedAt).getTime() : Number.NaN;
    if (!Number.isFinite(createdAtMs)) {
      return {
        badge: "Ожидает оплату",
        text: "Можно завершить оплату и сразу получить доступ к файлу.",
        expired: false,
      };
    }

    const deadlineMs = createdAtMs + PAYMENT_RESUME_WINDOW_MINUTES * 60 * 1000;
    const remainingMs = deadlineMs - pendingPaymentNow;
    if (remainingMs <= 0) {
      return {
        badge: "Окно истекло",
        text: "Время быстрой оплаты истекло, но можно повторно запустить оплату.",
        expired: true,
      };
    }

    return {
      badge: "Ожидает оплату",
      text: `Окно быстрой оплаты: ${formatPaymentCountdown(remainingMs)}`,
      expired: false,
    };
  };

  const handleResumeDownloadPayment = (item: DownloadEntry) => {
    const orderId = typeof item.orderId === "string" ? item.orderId.trim() : "";
    if (!orderId) {
      toast.error("Номер заказа не найден.", { className: "sonner-toast" });
      return;
    }
    router.push(`/checkout?orderId=${encodeURIComponent(orderId)}&resume=1`);
  };

  useEffect(() => {
    if (activeTab !== "downloads") return;
    if (typeof window === "undefined") return;

    const hasPending = downloads.some((item) => canResumeDownloadPayment(item));
    if (!hasPending) return;

    setPendingPaymentNow(Date.now());
    const timerId = window.setInterval(() => {
      setPendingPaymentNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [activeTab, downloads]);

  const handleDownloadFile = async (item: DownloadEntry) => {
    if (!item.productId) {
      toast.error("Не удалось определить модель для скачивания.", { className: "sonner-toast" });
      return;
    }
    setDownloadingId(item.id);
    try {
      const response =
        item.source === "legacy" || !item.entitlementId
          ? await fetch(`${apiBase}/api/download-token/${encodeURIComponent(item.productId)}`, {
              method: "GET",
              credentials: "include",
              cache: "no-store",
            })
          : await fetch(`${apiBase}/api/downloads/createLink`, {
              method: "POST",
              credentials: "include",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                entitlementId: item.entitlementId,
                productId: item.productId,
              }),
            });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success || typeof data?.downloadUrl !== "string") {
        throw new Error(data?.error || "Не удалось подготовить ссылку для скачивания.");
      }

      const link = document.createElement("a");
      link.href = data.downloadUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setDownloads((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, ready: true, blockedReason: undefined } : entry
        )
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось скачать файл. Попробуйте снова.";
      toast.error(message, { className: "sonner-toast" });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadAiAsset = async (asset: AiAssetEntry) => {
    if (!asset?.modelUrl) {
      toast.error("Файл модели недоступен.", { className: "sonner-toast" });
      return;
    }

    setDownloadingAiAssetId(asset.id);
    try {
      const safeName = (asset.title || "ai-model")
        .trim()
        .replace(/[\\/:*?"<>|]+/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 80);
      const ext = ["glb", "gltf", "obj", "stl"].includes(asset.format) ? asset.format : "glb";
      const link = document.createElement("a");
      link.href = asset.modelUrl;
      link.download = `${safeName || "ai-model"}.${ext}`;
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      toast.error("Не удалось скачать AI-модель.", { className: "sonner-toast" });
    } finally {
      setDownloadingAiAssetId(null);
    }
  };

  const handlePrintAiAsset = async (asset: AiAssetEntry) => {
    if (!asset?.modelUrl) {
      toast.error("Нет ссылки на модель для печати.", { className: "sonner-toast" });
      return;
    }

    setPreparingAiAssetId(asset.id);
    try {
      let mediaId = typeof asset.mediaId === "string" ? asset.mediaId : "";
      let modelUrl = asset.modelUrl;

      const prepareResponse = await fetch(
        `${apiBase}/api/ai/assets/${encodeURIComponent(asset.id)}/prepare-print`,
        {
          method: "POST",
          credentials: "include",
        }
      );
      const prepareData = await prepareResponse.json().catch(() => null);
      if (!prepareResponse.ok || !prepareData?.success) {
        throw new Error(prepareData?.error || "Не удалось подготовить модель к печати.");
      }

      const precheck = prepareData?.precheck as
        | {
            status?: "ok" | "risk" | "critical";
            summary?: string;
            modelBytes?: number | null;
          }
        | undefined;
      if (precheck?.status === "risk") {
        const sizeMb =
          typeof precheck.modelBytes === "number" && Number.isFinite(precheck.modelBytes)
            ? ` (~${(precheck.modelBytes / (1024 * 1024)).toFixed(1)} MB)`
            : "";
        toast.warning(`${precheck.summary || "Есть риск печати."}${sizeMb}`, {
          className: "sonner-toast",
        });
      }

      if (prepareData?.media?.id) {
        mediaId = String(prepareData.media.id);
      }
      if (typeof prepareData?.media?.url === "string" && prepareData.media.url.trim()) {
        modelUrl = prepareData.media.url.trim();
      }

      if (mediaId) {
        setAiAssets((prev) =>
          prev.map((entry) =>
            entry.id === asset.id ? { ...entry, mediaId, isInMedia: true } : entry
          )
        );
      }

      const params = new URLSearchParams();
      params.set("model", modelUrl);
      params.set("name", asset.title || "AI Model");
      if (asset.previewUrl) {
        params.set("thumb", asset.previewUrl);
      }
      if (mediaId) {
        params.set("mediaId", mediaId);
      }
      params.set("tech", "sla");
      router.push(`/services/print?${params.toString()}`);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось подготовить модель к печати.";
      toast.error(message, { className: "sonner-toast" });
    } finally {
      setPreparingAiAssetId(null);
    }
  };

  const handleDeleteAiAsset = async (asset: AiAssetEntry) => {
    if (!asset?.id) return;
    setDeletingAiAssetId(asset.id);
    try {
      const deleteWithConfirm = async (confirmChainDelete: boolean) => {
        const url = `${apiBase}/api/ai/assets/${encodeURIComponent(asset.id)}${
          confirmChainDelete ? "?confirmChainDelete=1" : ""
        }`;
        const response = await fetch(url, {
          method: "DELETE",
          credentials: "include",
        });
        const data = await response.json().catch(() => null);
        return { response, data };
      };

      let { response, data } = await deleteWithConfirm(false);
      if (!response.ok && data?.code === "chain_confirmation_required") {
        const descendants =
          typeof data?.descendants === "number" && data.descendants > 0
            ? data.descendants
            : null;
        const confirmationText = descendants
          ? `Эта версия является родителем для ${descendants} следующих версий. Удалить и перелинковать цепочку?`
          : "Эта версия является родителем в цепочке. Удалить и перелинковать цепочку?";
        const confirmed =
          typeof window !== "undefined" ? window.confirm(confirmationText) : false;
        if (!confirmed) {
          return;
        }
        ({ response, data } = await deleteWithConfirm(true));
      }

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось удалить AI-модель.");
      }
      setAiAssets((prev) => prev.filter((item) => item.id !== asset.id));
      toast.success(
        typeof data?.chainRelinked === "number" && data.chainRelinked > 0
          ? `AI-модель удалена. Перелинковано версий: ${data.chainRelinked}.`
          : "AI-модель удалена.",
        { className: "sonner-toast" }
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Не удалось удалить AI-модель.";
      toast.error(message, { className: "sonner-toast" });
    } finally {
      setDeletingAiAssetId(null);
    }
  };

  const cartItemCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );
  const cartTotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0),
    [cartItems]
  );
  const cartTotalLabel = formatPrice(cartTotal);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white">
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-xs uppercase tracking-[0.3em] text-white/60">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] text-white">
        <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
        <div className="pointer-events-none fixed inset-0">
          <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.2),transparent_70%)] blur-2xl" />
          <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
        </div>

        <div className="relative z-10 mx-auto max-w-[600px] px-4 py-16 sm:px-6 sm:py-24">
          <div className="mb-8 flex items-center justify-between">
            <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
              Доступ к системе
            </p>
            <Link
              href="/"
              className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              На главную
            </Link>
          </div>

          <div className="rounded-[32px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl sm:p-8">
            <AuthForm />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.2),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1200px] px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
              Личный кабинет
            </p>
            <Link
              href="/store"
              aria-label="Перейти в магазин"
              className="mt-2 inline-flex text-2xl font-semibold text-white transition hover:text-cyan-100 sm:mt-3 sm:text-3xl"
            >
              Профиль 3D-STORE
            </Link>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:gap-3">
            <Link
              href="/cart"
              className="relative flex items-center gap-2 rounded-full border border-[#2ED1FF]/35 bg-[#2ED1FF]/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[#BFF4FF] transition hover:border-[#2ED1FF]/60 hover:text-white sm:px-4 sm:text-xs sm:tracking-[0.3em]"
            >
              <ShoppingCart className="h-4 w-4" />
              Корзина
              {cartItemCount > 0 && (
                <span className="rounded-full bg-[#2ED1FF] px-2 py-0.5 text-[9px] font-semibold tracking-[0.2em] text-[#050505]">
                  {cartItemCount}
                </span>
              )}
            </Link>
            <Link
              href="/help"
              className="flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-cyan-200 transition hover:border-cyan-300/60 hover:text-cyan-100 sm:px-4 sm:text-xs sm:tracking-[0.3em]"
            >
              <LifeBuoy className="h-4 w-4" />
              Поддержка
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-red-500/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-red-400 transition hover:bg-red-500/20 hover:text-red-300 sm:px-4 sm:text-xs sm:tracking-[0.3em]"
            >
              <LogOut className="h-4 w-4" />
              Выход
            </button>
            <Link
              href="/store"
              className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/60 transition hover:text-white sm:px-4 sm:text-xs sm:tracking-[0.3em]"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад в магазин
            </Link>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-white/[0.04] px-4 py-4 sm:mt-10 sm:px-6 sm:py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
              <User className="h-6 w-6 text-white/70" />
            </div>
            <div>
              <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                {user.email}
              </p>
              <p className="mt-1 text-lg font-semibold text-white">{user.name || "Пользователь"}</p>
            </div>
          </div>
        </div>

        {cartItems.length > 0 && (
          <div className="mt-5 rounded-[20px] border border-[#2ED1FF]/25 bg-[#2ED1FF]/8 px-4 py-3 sm:mt-6 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.24em] text-[#BFF4FF]">
                В корзине: {cartItemCount} • Итог: {cartTotalLabel} ₽
              </p>
              <Link
                href="/cart"
                className="inline-flex items-center gap-2 rounded-full border border-[#2ED1FF]/45 bg-[#2ED1FF]/15 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-[#BFF4FF] transition hover:border-[#2ED1FF]/70 hover:text-white"
              >
                <ShoppingCart className="h-4 w-4" />
                Перейти в корзину
              </Link>
            </div>
          </div>
        )}

        <div className="mt-8 flex gap-2 overflow-x-auto border-b border-white/10 pb-1 sm:gap-3">
          <button
            onClick={() => setActiveTab("orders")}
            className={`relative flex items-center gap-2 whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition sm:px-4 sm:py-3 sm:text-sm ${
              activeTab === "orders" ? "text-[#BFF4FF]" : "text-white/50 hover:text-white"
            }`}
          >
            <Package className="h-4 w-4" />
            Мои заказы
            {activeTab === "orders" && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 -bottom-px h-px rounded-full bg-[#BFF4FF] shadow-[0_0_8px_rgba(191,244,255,0.7)]"
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab("downloads")}
            className={`relative flex items-center gap-2 whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition sm:px-4 sm:py-3 sm:text-sm ${
              activeTab === "downloads" ? "text-[#BFF4FF]" : "text-white/50 hover:text-white"
            }`}
          >
            <Download className="h-4 w-4" />
            Цифровая библиотека
            {activeTab === "downloads" && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 -bottom-px h-px rounded-full bg-[#BFF4FF] shadow-[0_0_8px_rgba(191,244,255,0.7)]"
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab("ai-assets")}
            className={`relative flex items-center gap-2 whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition sm:px-4 sm:py-3 sm:text-sm ${
              activeTab === "ai-assets" ? "text-[#BFF4FF]" : "text-white/50 hover:text-white"
            }`}
          >
            <Cpu className="h-4 w-4" />
            AI библиотека
            {activeTab === "ai-assets" && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 -bottom-px h-px rounded-full bg-[#BFF4FF] shadow-[0_0_8px_rgba(191,244,255,0.7)]"
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab("drafts")}
            className={`relative flex items-center gap-2 whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition sm:px-4 sm:py-3 sm:text-sm ${
              activeTab === "drafts" ? "text-[#BFF4FF]" : "text-white/50 hover:text-white"
            }`}
          >
            <Save className="h-4 w-4" />
            Черновики
            {activeTab === "drafts" && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 -bottom-px h-px rounded-full bg-[#BFF4FF] shadow-[0_0_8px_rgba(191,244,255,0.7)]"
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`relative flex items-center gap-2 whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition sm:px-4 sm:py-3 sm:text-sm ${
              activeTab === "settings" ? "text-[#BFF4FF]" : "text-white/50 hover:text-white"
            }`}
          >
            <Settings className="h-4 w-4" />
            Настройки
            {activeTab === "settings" && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 -bottom-px h-px rounded-full bg-[#BFF4FF] shadow-[0_0_8px_rgba(191,244,255,0.7)]"
              />
            )}
          </button>
        </div>

        <div className="mt-8">
          {activeTab === "orders" && (
            <div className="space-y-4">
              {ordersLoading && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  Загружаем заказы...
                </div>
              )}
              {!ordersLoading && ordersError && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-red-200 backdrop-blur-xl">
                  {ordersError}
                </div>
              )}
              {!ordersLoading && !ordersError && orders.length === 0 && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  Заказы не найдены.
                </div>
              )}
              {!ordersLoading &&
                !ordersError &&
                orders.map((order) => {
                  const orderItems = getOrderItems(order);
                  const orderItemsCount = orderItems.reduce((sum: number, item: any) => {
                    const qty =
                      typeof item?.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
                    return sum + qty;
                  }, 0);
                  const pricingSummary = getOrderPricingSummary(order);
                  const progressStage = getOrderProgressStage(order.status);
                  const statusKey = normalizeOrderStatus(order.status);
                  const isDigital = isDigitalOrder(order);
                  const canCancel = canCancelOrder(order);
                  const orderId = String(order.id);
                  const printInfo = getOrderPrintInfo(order);
                  const statusLabel =
                    isDigital && (statusKey === "paid" || statusKey === "completed")
                      ? "Оплачено"
                      : getOrderStatusLabel(order.status);
                  const paymentAudit = paymentAuditByOrderId[orderId];
                  const paymentAuditError = paymentAuditErrorsByOrderId[orderId];
                  const isPaymentAuditOpen = paymentAuditOpenOrderId === orderId;
                  const isPaymentAuditLoading = paymentAuditLoadingOrderId === orderId;
                  return (
                    <div
                      key={order.id}
                      className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                            {order.id}
                          </p>
                          <h3 className="mt-2 text-xl font-semibold text-white">
                            {getOrderProductName(order)}
                          </h3>
                          <p className="mt-1 text-sm text-white/60">
                            {orderItems.length > 1
                              ? `${orderItems.length} позиций • ${orderItemsCount} шт.`
                              : getOrderPrimaryFormat(order)}
                          </p>
                          {printInfo.filename && (
                            <p className="mt-2 text-xs text-white/50">Файл: {printInfo.filename}</p>
                          )}
                          {printInfo.technology && (
                            <p className="text-xs text-white/50">
                              Технология: {printInfo.technology}
                            </p>
                          )}
                          {printInfo.material && (
                            <p className="text-xs text-white/50">Материал: {printInfo.material}</p>
                          )}
                          {printInfo.color && (
                            <p className="text-xs text-white/50">Цвет: {printInfo.color}</p>
                          )}
                          {printInfo.quality && (
                            <p className="text-xs text-white/50">Качество: {printInfo.quality}</p>
                          )}
                          {typeof printInfo.isHollow === "boolean" && (
                            <p className="text-xs text-white/50">
                              Полая модель: {printInfo.isHollow ? "Да" : "Нет"}
                            </p>
                          )}
                          {printInfo.packaging && (
                            <p className="text-xs text-white/50">Упаковка: {printInfo.packaging}</p>
                          )}
                          {printInfo.note && (
                            <p className="text-xs text-white/50">Комментарий: {printInfo.note}</p>
                          )}
                        </div>
                        <div className="w-full text-left lg:w-[420px] lg:max-w-[50%] lg:text-right">
                          <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                            {formatDate(order.createdAt || order.updatedAt)}
                          </p>
                          <p className={`mt-2 text-sm font-semibold ${getOrderStatusClass(order.status)}`}>
                            {statusLabel}
                          </p>
                          {!isDigital && (
                            <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                              <div className="grid grid-cols-3 gap-2 text-center text-[9px] uppercase tracking-[0.12em] text-white/40 sm:text-[10px]">
                                {ORDER_PROGRESS_STEPS.map((step, index) => (
                                  <span
                                    key={step}
                                    className={
                                      index <= progressStage ? "text-[#2ED1FF]" : "text-white/30"
                                    }
                                  >
                                    {step}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-2 grid grid-cols-3 gap-1.5 sm:gap-2">
                                {ORDER_PROGRESS_STEPS.map((step, index) => (
                                  <div
                                    key={`${step}-bar`}
                                    className={`h-1.5 rounded-full ${
                                      index <= progressStage
                                        ? "bg-[#2ED1FF] shadow-[0_0_10px_rgba(46,209,255,0.6)]"
                                        : "bg-white/10"
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                          <p className="mt-1 text-sm text-white/60">
                            Товары: {formatPrice(pricingSummary.subtotal)} ₽
                          </p>
                          {pricingSummary.deliveryCost > 0 && (
                            <p className="mt-1 text-sm text-white/60">
                              Доставка: {formatPrice(pricingSummary.deliveryCost)} ₽
                            </p>
                          )}
                          <p className="mt-1 text-sm font-semibold text-white">
                            Итого: {formatPrice(pricingSummary.total)} ₽
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2 lg:justify-end">
                            <button
                              type="button"
                              onClick={() => handleRepeatOrder(order)}
                              disabled={reorderingOrderId === orderId}
                              aria-disabled={reorderingOrderId === orderId}
                              aria-label={reorderingOrderId === orderId ? "Собираем заказ" : "Повторить заказ"}
                              title="Повторить заказ"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#2ED1FF]/30 bg-[#2ED1FF]/10 text-[#BFF4FF] transition hover:border-[#2ED1FF]/60 hover:bg-[#2ED1FF]/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <RotateCcw
                                className={`h-4 w-4 ${reorderingOrderId === orderId ? "animate-spin" : ""}`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTogglePaymentAudit(orderId)}
                              disabled={isPaymentAuditLoading}
                              aria-label={isPaymentAuditOpen ? "Скрыть оплату" : "Детали оплаты"}
                              title={isPaymentAuditOpen ? "Скрыть оплату" : "Детали оплаты"}
                              className={`inline-flex h-9 w-9 items-center justify-center rounded-full border bg-white/5 transition hover:border-white/40 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                                isPaymentAuditOpen
                                  ? "border-[#2ED1FF]/40 text-[#BFF4FF]"
                                  : "border-white/20 text-white/70"
                              }`}
                            >
                              {isPaymentAuditOpen ? <X className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenOrderReceiptPrint(orderId)}
                              aria-label="Чек / PDF"
                              title="Чек / PDF"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/70 transition hover:border-white/40 hover:bg-white/10 hover:text-white"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                            {canCancel && (
                              <button
                                type="button"
                                disabled={cancelingOrderId === orderId}
                                aria-disabled={cancelingOrderId === orderId}
                                onClick={() => handleCancelOrder(orderId)}
                                aria-label={cancelingOrderId === orderId ? "Отменяем заказ" : "Отменить весь заказ"}
                                title="Отменить весь заказ"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-400/20 bg-transparent text-red-200/70 transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Trash2
                                  className={`h-4 w-4 ${cancelingOrderId === orderId ? "animate-pulse" : ""}`}
                                />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      {isPaymentAuditOpen && (
                        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                          <p className="text-[10px] uppercase tracking-[0.3em] text-white/50">
                            Детали оплаты
                          </p>
                          {isPaymentAuditLoading && (
                            <p className="mt-3 text-xs text-white/60">Загружаем события оплаты...</p>
                          )}
                          {!isPaymentAuditLoading && paymentAuditError && (
                            <p className="mt-3 text-xs text-red-300">{paymentAuditError}</p>
                          )}
                          {!isPaymentAuditLoading && !paymentAuditError && paymentAudit && (
                            <div className="mt-3 space-y-3">
                              <div className="grid grid-cols-1 gap-2 text-xs text-white/70 sm:grid-cols-2">
                                <p>
                                  Провайдер:{" "}
                                  <span className="text-white">
                                    {getPaymentProviderLabel(paymentAudit.paymentProvider)}
                                  </span>
                                </p>
                                <p>
                                  Статус оплаты:{" "}
                                  <span className="text-white">
                                    {getPaymentStatusLabel(paymentAudit.paymentStatus)}
                                  </span>
                                </p>
                                <p>
                                  Статус заказа:{" "}
                                  <span className="text-white">
                                    {getOrderStatusLabel(paymentAudit.orderStatus)}
                                  </span>
                                </p>
                                <p>
                                  Сумма:{" "}
                                  <span className="text-white">
                                    {formatMinorAmount(paymentAudit.amountMinor, paymentAudit.currency)}
                                  </span>
                                </p>
                                {paymentAudit.paymentIntentId && (
                                  <p className="sm:col-span-2">
                                    Intent: <span className="font-mono text-white">{paymentAudit.paymentIntentId}</span>
                                  </p>
                                )}
                              </div>
                              <div className="space-y-2">
                                {paymentAudit.events.map((event) => (
                                  <div
                                    key={event.id}
                                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <p className="text-xs text-white">{event.label}</p>
                                      {event.amountMinor !== undefined && (
                                        <p className="text-xs font-semibold text-[#BFF4FF]">
                                          {formatMinorAmount(event.amountMinor, event.currency)}
                                        </p>
                                      )}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-white/45">
                                      {event.at && <span>{formatDateTime(event.at)}</span>}
                                      {event.status && <span>{formatAuditStatusLabel(event.status)}</span>}
                                      {event.source && <span>{event.source}</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {orderItems.length > 0 && (
                        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                          <p className="text-[10px] uppercase tracking-[0.3em] text-white/50">
                            Состав заказа
                          </p>
                          <div className="mt-3 space-y-2">
                            {orderItems.map((item: any, itemIndex: number) => {
                              const itemKey = getOrderItemKey(item, itemIndex);
                              const actionKey = `${orderId}:${itemKey}`;
                              const totals = getOrderItemTotalLabel(item);
                              const itemFormat = getOrderFormatLabel(item?.format);
                              const canCancelItem = canCancelOrderItem(order, item);
                              return (
                                <div
                                  key={actionKey}
                                  className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div>
                                    <p className="text-sm font-semibold text-white">
                                      {getOrderItemProductName(item)}
                                    </p>
                                    <p className="text-xs text-white/60">
                                      {itemFormat} • {totals.quantity} x {totals.unitPriceLabel} ₽
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 sm:justify-end">
                                    <p className="text-sm font-semibold text-white">{totals.lineTotal} ₽</p>
                                    {canCancelItem && (
                                      <button
                                        type="button"
                                        onClick={() => handleCancelOrderItem(orderId, itemKey, itemIndex)}
                                        disabled={cancelingOrderItemKey === actionKey}
                                        aria-disabled={cancelingOrderItemKey === actionKey}
                                        className="rounded-full border border-red-400/20 bg-transparent px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-red-200/70 transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {cancelingOrderItemKey === actionKey
                                          ? "Отменяем..."
                                          : "Отменить позицию"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-4 border-t border-white/10 pt-3 text-sm text-white/70">
                            <div className="flex items-center justify-between">
                              <span>Подытог</span>
                              <span>{formatPrice(pricingSummary.subtotal)} ₽</span>
                            </div>
                            {pricingSummary.deliveryCost > 0 && (
                              <div className="mt-1 flex items-center justify-between">
                                <span>Доставка</span>
                                <span>{formatPrice(pricingSummary.deliveryCost)} ₽</span>
                              </div>
                            )}
                            <div className="mt-2 flex items-center justify-between text-base font-semibold text-white">
                              <span>Итого</span>
                              <span>{formatPrice(pricingSummary.total)} ₽</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
          {activeTab === "downloads" && (
            <div className="space-y-4">
              {downloadsLoading && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  Загружаем библиотеку...
                </div>
              )}
              {!downloadsLoading && downloadsError && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-red-200 backdrop-blur-xl">
                  {downloadsError}
                </div>
              )}
              {!downloadsLoading && !downloadsError && downloads.length === 0 && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  Цифровая библиотека пуста.
                </div>
              )}
              {!downloadsLoading &&
                !downloadsError &&
                downloads.map((download) => {
                  const resumePaymentMeta = getResumePaymentMeta(download);
                  return (
                    <div
                      key={download.id}
                      className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          {download.previewUrl ? (
                            <img
                              src={download.previewUrl}
                              alt={download.product}
                              className="h-12 w-12 rounded-xl object-cover"
                            />
                          ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-white/50">
                            <Download className="h-5 w-5" />
                          </div>
                        )}
                        <div>
                          <h3 className="text-xl font-semibold text-white">{download.product}</h3>
                          <p className="mt-1 text-sm text-white/60">
                            {download.format} • Размер файла: {download.fileSize}
                          </p>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-white/40">
                            {download.source === "legacy" ? "Legacy доступ" : "Новый доступ"}
                          </p>
                          {download.purchasedAt && (
                            <p className="mt-1 text-xs text-white/45">
                              Куплено: {formatDate(download.purchasedAt)}
                            </p>
                          )}
                          {download.blockedReason && (
                            <p className="mt-1 text-xs text-amber-200">{download.blockedReason}</p>
                          )}
                          {resumePaymentMeta && (
                            <>
                              <span
                                className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${
                                  resumePaymentMeta.expired
                                    ? "border-amber-400/45 bg-amber-500/10 text-amber-100"
                                    : "border-cyan-400/40 bg-cyan-500/10 text-cyan-100"
                                }`}
                              >
                                {resumePaymentMeta.badge}
                              </span>
                              <p className="mt-1 text-xs text-white/65">{resumePaymentMeta.text}</p>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                        {download.ready ? (
                          <button
                            type="button"
                            onClick={() => handleDownloadFile(download)}
                            disabled={downloadingId === download.id}
                            className="flex w-full items-center justify-center gap-2 rounded-full bg-[#2ED1FF]/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-[#2ED1FF] transition hover:bg-[#2ED1FF]/30 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                          >
                            <Download className="h-4 w-4" />
                            {downloadingId === download.id ? "Готовим..." : "Скачать"}
                          </button>
                        ) : (
                          <span className="flex w-full items-center justify-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/40 sm:w-auto">
                            <Download className="h-4 w-4" />
                            Недоступно
                          </span>
                        )}
                        {canResumeDownloadPayment(download) && (
                          <button
                            type="button"
                            onClick={() => handleResumeDownloadPayment(download)}
                            className="flex w-full items-center justify-center gap-2 rounded-full border border-[#2ED1FF]/40 bg-[#2ED1FF]/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-[#BFF4FF] transition hover:border-[#2ED1FF]/70 hover:bg-[#2ED1FF]/20 hover:text-white sm:w-auto"
                          >
                            Завершить оплату
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleCreateGiftLink(download)}
                          disabled={!download.productId || creatingGiftForId === download.id}
                          className="flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-[#2ED1FF]/50 hover:text-[#BFF4FF] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                        >
                          <Gift className="h-4 w-4" />
                          {creatingGiftForId === download.id ? "Создаем..." : "Подарить"}
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
            </div>
          )}
          {activeTab === "ai-assets" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-white/5 bg-white/[0.03] px-4 py-3 backdrop-blur-xl">
                <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/55">
                  Версии библиотеки
                </p>
                <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-1">
                  <button
                    type="button"
                    onClick={() => setAiAssetsVersionsView("latest")}
                    className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.22em] transition ${
                      aiAssetsVersionsView === "latest"
                        ? "border border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                        : "text-white/55 hover:text-white"
                    }`}
                  >
                    latest only
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiAssetsVersionsView("all")}
                    className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.22em] transition ${
                      aiAssetsVersionsView === "all"
                        ? "border border-cyan-300/60 bg-cyan-500/15 text-cyan-100"
                        : "text-white/55 hover:text-white"
                    }`}
                  >
                    all versions
                  </button>
                </div>
              </div>
              {aiAssetsLoading && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  Загружаем AI-библиотеку...
                </div>
              )}
              {!aiAssetsLoading && aiAssetsError && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-red-200 backdrop-blur-xl">
                  {aiAssetsError}
                </div>
              )}
              {!aiAssetsLoading && !aiAssetsError && aiAssets.length === 0 && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  AI-библиотека пуста. Создайте модель в AI лаборатории и сохраните в профиль.
                </div>
              )}
              {!aiAssetsLoading &&
                !aiAssetsError &&
                aiAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl"
                  >
                    {(() => {
                      const editing = editingAiAssetId === asset.id;
                      const createdLabel = formatShortDateTime(asset.createdAt || asset.updatedAt);
                      const metaLabel = `${(asset.format || "unknown").toUpperCase()} • ${
                        asset.status === "archived" ? "Архив" : "Готово"
                      }${createdLabel ? ` • ${createdLabel}` : ""}`;
                      const titleLabel = (asset.title || "").trim() || "Новая модель";
                      return (
                    <div
                      className="group flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                      ref={(node) => {
                        aiAssetCardRefs.current[asset.id] = node;
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {asset.previewUrl ? (
                          <img
                            src={asset.previewUrl}
                            alt={asset.title}
                            className="h-12 w-12 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-white/50">
                            <Cpu className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          {editing ? (
                            <input
                              ref={aiAssetInputRef}
                              value={editingAiAssetDraft}
                              onChange={(event) =>
                                setEditingAiAssetDraft(event.target.value.slice(0, AI_ASSET_NAME_MAX))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void saveAiAssetName(asset.id, editingAiAssetDraft);
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  closeAiAssetRename();
                                }
                              }}
                              onBlur={() => closeAiAssetRename()}
                              maxLength={AI_ASSET_NAME_MAX}
                              className="w-full rounded-lg border border-cyan-300/45 bg-white/5 px-2.5 py-1.5 text-xl font-semibold text-white outline-none transition focus:border-cyan-200"
                              aria-label="Название модели"
                            />
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openAiAssetRename(asset)}
                                className="truncate text-left text-xl font-semibold text-white transition hover:text-cyan-100"
                                title={titleLabel}
                              >
                                {titleLabel}
                              </button>
                              <button
                                type="button"
                                onClick={() => openAiAssetRename(asset)}
                                className="rounded-full border border-white/20 bg-white/5 p-1 text-white/65 opacity-0 transition hover:border-cyan-300/45 hover:text-cyan-100 group-hover:opacity-100"
                                aria-label="Переименовать модель"
                                title="Переименовать"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                          <p className="mt-1 text-sm text-white/55">{metaLabel}</p>
                          {editing && (
                            <p className="mt-1 text-[11px] text-white/45">
                              Enter - сохранить, Esc - отмена
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                        <button
                          type="button"
                          onClick={() => void handlePrintAiAsset(asset)}
                          disabled={preparingAiAssetId === asset.id}
                          title="В печать"
                          aria-label="В печать"
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:border-[#2ED1FF]/50 hover:text-[#BFF4FF] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {preparingAiAssetId === asset.id ? (
                            <span className="text-[10px] font-[var(--font-jetbrains-mono)]">...</span>
                          ) : (
                            <ShoppingCart className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadAiAsset(asset)}
                          disabled={downloadingAiAssetId === asset.id}
                          title="Скачать модель"
                          aria-label="Скачать модель"
                          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2ED1FF]/20 text-[#2ED1FF] transition hover:bg-[#2ED1FF]/30 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {downloadingAiAssetId === asset.id ? (
                            <span className="text-[10px] font-[var(--font-jetbrains-mono)]">...</span>
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteAiAsset(asset)}
                          disabled={deletingAiAssetId === asset.id || renamingAiAssetId === asset.id}
                          title="Удалить модель"
                          aria-label="Удалить модель"
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-red-400/20 bg-transparent text-red-200/80 transition hover:border-red-400/40 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingAiAssetId === asset.id ? (
                            <span className="text-[10px] font-[var(--font-jetbrains-mono)]">...</span>
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                      );
                    })()}
                  </div>
                ))}
            </div>
          )}
          {activeTab === "drafts" && (
            <div className="space-y-4">
              {checkoutDrafts.length === 0 && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  Черновиков пока нет. На странице оформления нажмите «Сохранить черновик».
                </div>
              )}
              {checkoutDrafts.map((draft) => {
                const itemCount =
                  typeof draft.itemCount === "number" && draft.itemCount > 0
                    ? draft.itemCount
                    : Array.isArray(draft.selectedItemIds)
                      ? draft.selectedItemIds.length
                      : 0;
                const subtotalLabel =
                  typeof draft.subtotal === "number" && draft.subtotal > 0
                    ? `${formatPrice(draft.subtotal)} ₽`
                    : "N/A";
                const namesPreview =
                  Array.isArray(draft.itemNames) && draft.itemNames.length > 0
                    ? draft.itemNames.slice(0, 2).join(", ")
                    : "Состав будет восстановлен из корзины";
                return (
                  <div
                    key={draft.id}
                    className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                          Черновик
                        </p>
                        <h3 className="mt-2 text-xl font-semibold text-white">{namesPreview}</h3>
                        <p className="mt-1 text-sm text-white/60">
                          {itemCount} поз. • Сумма: {subtotalLabel}
                        </p>
                        <p className="mt-2 text-xs text-white/50">
                          Обновлен: {formatDate(draft.updatedAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenCheckoutDraft(draft)}
                          disabled={openingDraftId === draft.id}
                          className="rounded-full border border-[#2ED1FF]/30 bg-[#2ED1FF]/10 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-[#BFF4FF] transition hover:border-[#2ED1FF]/60 hover:bg-[#2ED1FF]/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {openingDraftId === draft.id ? "Открываем..." : "Открыть"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCheckoutDraft(draft.id)}
                          disabled={deletingDraftId === draft.id}
                          className="rounded-full border border-red-400/20 bg-transparent px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-red-200/70 transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingDraftId === draft.id ? "Удаляем..." : "Удалить"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {activeTab === "settings" && (
            <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-8 backdrop-blur-xl">
              <div className="space-y-6">
                <form className="space-y-6" onSubmit={handleSettingsSubmit}>
                {settingsError && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {settingsError}
                  </div>
                )}
                {settingsSuccess && (
                  <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                    {settingsSuccess}
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">Имя</label>
                  <input
                    type="text"
                    value={settingsForm.name}
                    onChange={handleSettingsChange("name")}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">Email</label>
                  <input
                    type="email"
                    value={settingsForm.email}
                    onChange={handleSettingsChange("email")}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                    Адрес доставки
                  </label>
                  <textarea
                    value={settingsForm.shippingAddress}
                    onChange={handleSettingsChange("shippingAddress")}
                    className="min-h[90px] w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                    Текущий пароль
                  </label>
                  <input
                    type="password"
                    placeholder="Введите текущий пароль"
                    value={settingsForm.currentPassword}
                    onChange={handleSettingsChange("currentPassword")}
                    autoComplete="current-password"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                    Новый пароль
                  </label>
                  <input
                    type="password"
                    placeholder="Введите новый пароль"
                    value={settingsForm.newPassword}
                    onChange={handleSettingsChange("newPassword")}
                    autoComplete="new-password"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                  <p className="text-[11px] text-white/40">
                    Минимум 8 символов, буквы, цифры и спецсимвол.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                    Повторите пароль
                  </label>
                  <input
                    type="password"
                    placeholder="Повторите новый пароль"
                    value={settingsForm.confirmPassword}
                    onChange={handleSettingsChange("confirmPassword")}
                    autoComplete="new-password"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>

                <button
                  type="submit"
                  disabled={settingsSaving}
                  className={`rounded-full px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] transition ${
                    settingsSaving
                      ? "bg-white/10 text-white/60"
                      : "bg-[#2ED1FF] text-[#050505] hover:bg-[#8fe6ff]"
                  }`}
                >
                  {settingsSaving ? "Сохраняем..." : "Сохранить изменения"}
                </button>
                </form>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}


