"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Minus, Plus, ShoppingCart, Trash2, Wrench } from "lucide-react";
import {
  getCartStorageKey,
  readCartStorage,
  writeCartStorage,
  writeCheckoutSelection,
} from "@/lib/cartStorage";

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
  sourceType?: "upload" | "store" | "recent";
  sourcePrice?: number;
  technology?: string;
  material?: string;
  color?: string;
  quality?: string;
  note?: string;
  packaging?: string;
  isHollow?: boolean;
  dimensions?: { x: number; y: number; z: number };
  volumeCm3?: number;
};

const formatPrice = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.round(value)));
};

const formatLabelForKey = (formatKey: "digital" | "physical") =>
  formatKey === "physical" ? "Печатная модель" : "Цифровой STL";

const buildCartThumbnail = (label: string) => {
  const shortLabel = label.trim().slice(0, 2).toUpperCase() || "3D";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#1f2937"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="160" height="120" rx="24" fill="url(#g)"/><circle cx="120" cy="24" r="28" fill="rgba(46,209,255,0.25)"/><text x="18" y="70" fill="#E2E8F0" font-family="Arial, sans-serif" font-size="28" font-weight="700">${shortLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const normalizeCustomPrint = (source: any): CustomPrintMeta | null => {
  if (!source || typeof source !== "object") return null;
  const raw = source.customPrint && typeof source.customPrint === "object" ? source.customPrint : source;
  const uploadId =
    typeof raw.uploadId === "string"
      ? raw.uploadId
      : typeof raw.customerUploadId === "string"
        ? raw.customerUploadId
        : null;
  if (!uploadId) return null;

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
    sourceType:
      raw.source === "store" || raw.source === "recent" || raw.source === "upload"
        ? raw.source
        : undefined,
    sourcePrice: typeof raw.sourcePrice === "number" ? raw.sourcePrice : undefined,
    technology: typeof raw.technology === "string" ? raw.technology : undefined,
    material: typeof raw.material === "string" ? raw.material : undefined,
    color: typeof raw.color === "string" ? raw.color : undefined,
    quality: typeof raw.quality === "string" ? raw.quality : undefined,
    note: typeof raw.note === "string" ? raw.note : undefined,
    packaging: typeof raw.packaging === "string" ? raw.packaging : undefined,
    isHollow: typeof raw.isHollow === "boolean" ? raw.isHollow : undefined,
    dimensions,
    volumeCm3: typeof raw.volumeCm3 === "number" ? raw.volumeCm3 : undefined,
  };
};

const normalizeStoredItem = (item: any): CartItem | null => {
  if (!item || typeof item !== "object") return null;

  const rawProduct =
    typeof item.productId !== "undefined" ? item.productId : typeof item.product !== "undefined" ? item.product : null;
  const resolvedProductId =
    typeof rawProduct === "string"
      ? rawProduct
      : typeof rawProduct === "number"
        ? String(rawProduct)
        : rawProduct && typeof rawProduct === "object"
          ? rawProduct.id || rawProduct.value || rawProduct._id || null
          : null;
  const productId =
    typeof resolvedProductId === "string"
      ? resolvedProductId
      : typeof item.id === "string"
        ? item.id
        : null;
  if (!productId) return null;

  const formatKey = item.formatKey === "physical" ? "physical" : "digital";
  const name = typeof item.name === "string" ? item.name : "Товар";
  const priceValue = typeof item.priceValue === "number" ? item.priceValue : 0;
  const quantityRaw = typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
  const quantity = formatKey === "digital" ? 1 : Math.max(1, Math.min(99, Math.round(quantityRaw)));
  const formatLabel =
    typeof item.formatLabel === "string" ? item.formatLabel : formatLabelForKey(formatKey);
  const priceLabel =
    typeof item.priceLabel === "string" ? item.priceLabel : `${formatPrice(priceValue)} ₽`;
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

const mapQualityToPrintParam = (quality?: string) => {
  const normalized = (quality || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("чернов")) return "draft";
  if (normalized.includes("0.05") || normalized.includes("pro")) return "pro";
  return "standard";
};

const buildPrintEditUrl = (item: CartItem) => {
  const custom = item.customPrint;
  if (!custom?.uploadUrl) return null;
  const params = new URLSearchParams();
  params.set("model", custom.uploadUrl);

  if (custom.uploadId) params.set("mediaId", custom.uploadId);
  if (custom.uploadName) params.set("name", custom.uploadName);
  if (custom.sourceType) params.set("source", custom.sourceType);
  if (custom.technology) params.set("tech", custom.technology);
  if (custom.material) params.set("material", custom.material);
  if (custom.color) params.set("color", custom.color);
  if (custom.note) params.set("note", custom.note);
  if (custom.packaging) params.set("packaging", custom.packaging);
  if (typeof custom.isHollow === "boolean") params.set("hollow", custom.isHollow ? "1" : "0");

  const quality = mapQualityToPrintParam(custom.quality);
  if (quality) params.set("quality", quality);
  if (item.quantity > 0) params.set("quantity", String(item.quantity));
  if (typeof custom.dimensions?.y === "number" && custom.dimensions.y > 0) {
    params.set("height", String(custom.dimensions.y));
  }
  if (item.thumbnailUrl) params.set("thumb", item.thumbnailUrl);

  return `/services/print?${params.toString()}`;
};

const getPrintIssues = (item: CartItem) => {
  const issues: string[] = [];
  const print = item.customPrint;
  if (!print?.uploadId) issues.push("Нет привязки к модели");
  if (!print?.uploadUrl) issues.push("Нет файла модели");
  if (!print?.technology) issues.push("Не выбрана технология");
  if (!print?.material) issues.push("Не выбран материал");
  if (!print?.quality) issues.push("Не выбрано качество");
  return issues;
};

export default function CartPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  const cartStorageKey = useMemo(() => getCartStorageKey(userId), [userId]);

  useEffect(() => {
    let active = true;
    fetch("/api/users/me?depth=0", { credentials: "include", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        const nextUserId =
          data?.user?.id || data?.doc?.id ? String(data?.user?.id || data?.doc?.id) : null;
        setUserId(nextUserId);
        setAuthResolved(true);
      })
      .catch(() => {
        if (!active) return;
        setUserId(null);
        setAuthResolved(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authResolved) return;
    setLoading(true);
    setError(null);
    const syncFromStorage = () => {
      try {
        const parsed = readCartStorage(cartStorageKey, { migrateLegacy: Boolean(userId) });
        const normalized = parsed
          .map((item) => normalizeStoredItem(item))
          .filter((item): item is CartItem => Boolean(item));
        setCartItems(normalized);
        setLoading(false);
      } catch {
        setError("Не удалось загрузить корзину.");
        setLoading(false);
      }
    };

    const syncFromApi = async () => {
      try {
        const response = await fetch("/api/cart", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("cart-fetch-failed");
        }
        const payload = await response.json().catch(() => null);
        const incoming = Array.isArray(payload?.cart?.items) ? payload.cart.items : [];
        writeCartStorage(cartStorageKey, incoming, { syncServer: false });
      } catch {
        // fallback to local cache if server cart is unavailable
      } finally {
        syncFromStorage();
      }
    };

    void syncFromApi();
    window.addEventListener("cart-updated", syncFromStorage);
    return () => window.removeEventListener("cart-updated", syncFromStorage);
  }, [authResolved, cartStorageKey, reloadKey, userId]);

  const persistItems = useCallback(
    (nextItems: CartItem[]) => {
      setCartItems(nextItems);
      writeCartStorage(cartStorageKey, nextItems);
    },
    [cartStorageKey]
  );

  const updateQuantity = useCallback(
    (itemId: string, delta: number) => {
      const target = cartItems.find((item) => item.id === itemId);
      if (!target || target.formatKey === "digital") return;
      const nextItems = cartItems.map((item) => {
        if (item.id !== itemId) return item;
        return { ...item, quantity: Math.max(1, Math.min(99, item.quantity + delta)) };
      });
      persistItems(nextItems);
    },
    [cartItems, persistItems]
  );

  const removeItem = useCallback(
    (itemId: string) => {
      const index = cartItems.findIndex((item) => item.id === itemId);
      if (index < 0) return;
      const removed = cartItems[index];
      const nextItems = cartItems.filter((item) => item.id !== itemId);
      persistItems(nextItems);
      toast.success("Удалено из корзины", {
        className: "sonner-toast",
        duration: 6500,
        action: {
          label: "Вернуть",
          onClick: () => {
            const restored = [...nextItems];
            restored.splice(index, 0, removed);
            persistItems(restored);
          },
        },
      });
    },
    [cartItems, persistItems]
  );

  const itemsSubtotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0),
    [cartItems]
  );
  const cartCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );

  const itemsWithValidation = useMemo(
    () =>
      cartItems.map((item) => {
        const isPrint = Boolean(item.customPrint?.uploadId) || String(item.productId).toLowerCase().includes("print");
        const printIssues = isPrint ? getPrintIssues(item) : [];
        const printReady = !isPrint || printIssues.length === 0;
        const isAvailable = Boolean(item.productId);
        const isValid = item.quantity > 0;
        const blockingReason = !isAvailable
          ? "Позиция недоступна"
          : !isValid
            ? "Некорректное количество"
            : !printReady
              ? `Требует подготовки: ${printIssues[0]}`
              : "";
        return {
          ...item,
          isPrint,
          printReady,
          printIssues,
          isAvailable,
          isValid,
          blockingReason,
          editPrintUrl: isPrint ? buildPrintEditUrl(item) : null,
        };
      }),
    [cartItems]
  );

  const blockingItems = useMemo(
    () =>
      itemsWithValidation.filter(
        (item) => !item.isAvailable || !item.isValid || (item.isPrint && !item.printReady)
      ),
    [itemsWithValidation]
  );
  const checkoutDisabled = cartItems.length === 0 || blockingItems.length > 0;

  const handleCheckout = useCallback(() => {
    if (checkoutDisabled) {
      const reason = blockingItems[0]?.blockingReason || "Добавьте товары в корзину.";
      toast.error(reason, { className: "sonner-toast" });
      return;
    }
    writeCheckoutSelection(
      cartStorageKey,
      itemsWithValidation.map((item) => item.id)
    );
    router.push("/checkout");
  }, [blockingItems, cartStorageKey, checkoutDisabled, itemsWithValidation, router]);

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.2),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1320px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
              3D-STORE
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Корзина</h1>
            <p className="mt-1 text-sm text-white/60">
              {cartCount > 0 ? `${cartCount} позиций` : "Корзина пуста"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/store"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-white/70 transition hover:border-white/35 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Каталог
            </Link>
            <Link
              href="/profile"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-white/70 transition hover:border-white/35 hover:text-white"
            >
              Профиль
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#2ED1FF]/40 bg-[#2ED1FF]/10 px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-[#BFF4FF]">
              <ShoppingCart className="h-4 w-4" />
              {cartCount}
            </span>
          </div>
        </header>

        {loading && (
          <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-28 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
              ))}
            </div>
            <div className="h-64 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
          </div>
        )}

        {!loading && error && (
          <div className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
            <p className="text-sm text-red-200">{error}</p>
            <button
              type="button"
              onClick={() => {
                setReloadKey((prev) => prev + 1);
              }}
              className="mt-3 rounded-full border border-red-300/35 bg-red-500/10 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-red-100 transition hover:border-red-300/60"
            >
              Повторить
            </button>
          </div>
        )}

        {!loading && !error && cartItems.length === 0 && (
          <div className="mt-8 rounded-[28px] border border-white/10 bg-white/[0.03] p-8 text-center">
            <p className="text-base text-white/80">Корзина пуста</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Link
                href="/store"
                className="rounded-full border border-[#2ED1FF]/45 bg-[#2ED1FF]/12 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-[#BFF4FF] transition hover:border-[#2ED1FF]/70 hover:text-white"
              >
                К каталогу
              </Link>
              <Link
                href="/ai-lab"
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-white/70 transition hover:border-white/35 hover:text-white"
              >
                В AI Lab
              </Link>
            </div>
          </div>
        )}

        {!loading && !error && cartItems.length > 0 && (
          <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-3">
              {itemsWithValidation.map((item) => {
                const lineTotal = item.priceValue * item.quantity;
                return (
                  <article
                    key={item.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <img
                          src={item.thumbnailUrl || buildCartThumbnail(item.name)}
                          alt={item.name}
                          className="h-16 w-16 rounded-xl border border-white/10 object-cover"
                          onError={(event) => {
                            const img = event.currentTarget;
                            img.onerror = null;
                            img.src = buildCartThumbnail(item.name);
                          }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold text-white">{item.name}</p>
                          <p className="mt-0.5 text-xs uppercase tracking-[0.18em] text-white/45">
                            {item.customPrint ? "Печать на заказ" : item.formatLabel}
                          </p>
                          {item.customPrint && (
                            <div className="mt-2 space-y-1 text-xs text-white/60">
                              <p>Технология: {item.customPrint.technology || "—"}</p>
                              <p>Материал: {item.customPrint.material || "—"}</p>
                              <p>Качество: {item.customPrint.quality || "—"}</p>
                            </div>
                          )}
                          {item.customPrint && !item.printReady && (
                            <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-amber-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-200">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Требует подготовки
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-col sm:items-end">
                        <p className="text-sm font-semibold text-white">{formatPrice(lineTotal)} ₽</p>
                        {!item.customPrint && item.formatKey !== "digital" && (
                          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1">
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, -1)}
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white/70 transition hover:text-white"
                              aria-label="Уменьшить количество"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="min-w-[22px] text-center text-xs font-semibold text-white">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, 1)}
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white/70 transition hover:text-white"
                              aria-label="Увеличить количество"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          {item.editPrintUrl && (
                            <button
                              type="button"
                              onClick={() => router.push(item.editPrintUrl || "/services/print")}
                              className="inline-flex items-center gap-1 rounded-full border border-[#2ED1FF]/35 bg-[#2ED1FF]/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-[#BFF4FF] transition hover:border-[#2ED1FF]/60 hover:text-white"
                            >
                              <Wrench className="h-3.5 w-3.5" />
                              {item.printReady ? "Изменить" : "Исправить"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-400/25 bg-transparent text-red-200/70 transition hover:border-red-300/45 hover:bg-red-500/10"
                            aria-label="Удалить позицию"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <aside className="h-fit rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:sticky lg:top-24">
              <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-white/85">Итого</h2>
              {blockingItems.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                  Исправьте {blockingItems.length} проблемных позиций перед оформлением.
                </div>
              )}
              <div className="mt-4 space-y-2 text-sm text-white/70">
                <div className="flex items-center justify-between">
                  <span>Товары</span>
                  <span>{formatPrice(itemsSubtotal)} ₽</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Доставка</span>
                  <span>на этапе оформления</span>
                </div>
                <div className="mt-2 border-t border-white/10 pt-2 text-base font-semibold text-white">
                  <div className="flex items-center justify-between">
                    <span>Итог</span>
                    <span>{formatPrice(itemsSubtotal)} ₽</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCheckout}
                disabled={checkoutDisabled}
                className={`mt-4 w-full rounded-full px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] transition ${
                  checkoutDisabled
                    ? "cursor-not-allowed border border-white/10 bg-white/5 text-white/40"
                    : "border border-[#2ED1FF]/50 bg-[#2ED1FF]/12 text-[#BFF4FF] hover:border-[#2ED1FF]/75 hover:text-white"
                }`}
              >
                Оформить заказ
              </button>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
