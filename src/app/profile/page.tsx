"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Download, LogOut, Package, Settings, ShoppingCart, Trash2, User } from "lucide-react";
import AuthForm from "@/components/AuthForm";
import {
  ORDER_PROGRESS_STEPS,
  ORDER_STATUS_UNREAD_KEY,
  getOrderProgressStage,
  getOrderStatusLabel,
  getOrderStatusTone,
  normalizeOrderStatus,
} from "@/lib/orderStatus";

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
  technology?: string;
  material?: string;
  quality?: string;
  dimensions?: { x: number; y: number; z: number };
  volumeCm3?: number;
};

type PurchasedProduct = {
  id?: string;
  name?: string;
  rawModel?: any;
  paintedModel?: any;
  slug?: string;
};

const formatPrice = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }
  return new Intl.NumberFormat("ru-RU").format(value);
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

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<"orders" | "downloads" | "settings">("orders");
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartItemCount, setCartItemCount] = useState(0);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncCart = () => {
      const stored = window.localStorage.getItem("store3d_cart");
      if (!stored) {
        setCartItems([]);
        return;
      }

      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const normalized = parsed
            .map((item) => normalizeStoredItem(item))
            .filter((item): item is CartItem => Boolean(item));
          setCartItems(normalized);
          return;
        }
      } catch {
        setCartItems([]);
      }
    };

    syncCart();
    const handleCartUpdated = () => syncCart();
    window.addEventListener("cart-updated", handleCartUpdated);
    return () => window.removeEventListener("cart-updated", handleCartUpdated);
  }, []);

  const removeFromCart = (id: string) => {
    setCartItems((prev) => {
      const next = prev.filter((item) => item.id !== id);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("store3d_cart", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("cart-updated"));
      }
      return next;
    });
  };

  useEffect(() => {
    const count = cartItems.reduce((sum, item) => sum + item.quantity, 0);
    setCartItemCount(count);
  }, [cartItems]);

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
    const refetchUser = () => {
      fetch(`${apiBase}/api/users/me?depth=2`, { credentials: "include" })
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

  const handleLogout = async () => {
    try {
      await fetch(`${apiBase}/api/users/logout`, {
        method: "POST",
        credentials: "include",
      });
      window.location.reload();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleSettingsSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSettingsSaving(true);
    setTimeout(() => setSettingsSaving(false), 900);
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

  const formatFileSize = (bytes?: number) => {
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

  const getOrderProduct = (order: any) => {
    const items = Array.isArray(order?.items) ? order.items : [];
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
    const items = Array.isArray(order?.items) ? order.items : [];
    return getOrderFormatLabel(items[0]?.format);
  };

  const getOrderStatusClass = (status?: string) => getOrderStatusTone(status);

  const canCancelOrder = (status?: string | null) => {
    const key = normalizeOrderStatus(status);
    return key !== "ready" && key !== "completed" && key !== "cancelled";
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
      const response = await fetch(`${apiBase}/api/orders/${orderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ status: "cancelled" }),
      });

      if (!response.ok) {
        throw new Error("Failed to cancel order");
      }

      setOrders((prev) =>
        prev.map((order) =>
          String(order.id) === orderId ? { ...order, status: "cancelled" } : order
        )
      );
      window.dispatchEvent(new Event("orders-updated"));
    } catch {
      setOrdersError("Не удалось отменить заказ.");
    } finally {
      setCancelingOrderId(null);
    }
  };

  const purchasedProducts: PurchasedProduct[] = Array.isArray(user?.purchasedProducts)
    ? user.purchasedProducts
    : [];

  const downloads =
    purchasedProducts
      .map((product) => {
        if (!product) return null;
        const rawModel = (product as any)?.rawModel;
        const paintedModel = (product as any)?.paintedModel;
        const downloadUrl = resolveMediaUrl(rawModel) || resolveMediaUrl(paintedModel);
        const previewUrl = resolveMediaUrl(paintedModel) || resolveMediaUrl(rawModel);
        const fileSize =
          typeof rawModel?.filesize === "number"
            ? formatFileSize(rawModel.filesize)
            : typeof paintedModel?.filesize === "number"
              ? formatFileSize(paintedModel.filesize)
              : "N/A";

        return {
          id: String(product.id || product.slug || product.name),
          product: product.name || "Цифровой STL",
          fileSize,
          downloadUrl,
          previewUrl,
          ready: Boolean(downloadUrl),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)) ?? [];

  const cartTotal = cartItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0);
  const cartTotalLabel = formatPrice(cartTotal);
  const canCheckout = cartItems.length > 0;

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

        <div className="relative z-10 mx-auto max-w-[600px] px-6 py-24">
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

          <div className="rounded-[32px] border border-white/5 bg-white/[0.03] p-8 backdrop-blur-xl">
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

      <div className="relative z-10 mx-auto max-w-[1200px] px-6 pb-24 pt-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
              Личный кабинет
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-white">Профиль 3D-STORE</h1>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-red-500/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-red-400 transition hover:bg-red-500/20 hover:text-red-300"
            >
              <LogOut className="h-4 w-4" />
              Выход
            </button>
            <Link
              href="/"
              className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад в магазин
            </Link>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-white/[0.04] px-6 py-5">
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

        <div className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.04] px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2ED1FF]/15 text-[#2ED1FF]">
                <ShoppingCart className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                  Корзина
                </p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {cartItemCount > 0 ? `${cartItemCount} позиций` : "Корзина пуста"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={canCheckout ? "/checkout" : "#"}
                aria-disabled={!canCheckout}
                onClick={(event) => {
                  if (!canCheckout) {
                    event.preventDefault();
                  }
                }}
                className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.3em] transition ${
                  canCheckout
                    ? "border border-[#2ED1FF]/40 bg-[#2ED1FF]/10 text-[#2ED1FF] hover:border-[#2ED1FF]/70 hover:bg-[#2ED1FF]/20"
                    : "cursor-not-allowed border border-white/10 bg-white/5 text-white/40"
                }`}
              >
                Оформить заказ
              </Link>
              <Link
                href="/"
                className="rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/20 hover:text-white"
              >
                К каталогу
              </Link>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {cartItems.length === 0 ? (
              <p className="text-sm text-white/60">Добавьте товары, чтобы оформить заказ.</p>
            ) : (
              cartItems.map((item) => {
                const lineTotal = formatPrice(item.priceValue * item.quantity);
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-white">{item.name}</p>
                      <p className="text-xs text-white/60">
                        {item.formatLabel} x{item.quantity}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white">{lineTotal} ₽</p>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                        {item.priceLabel} ₽
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Remove item"
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white"
                      onClick={() => removeFromCart(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
          {cartItems.length > 0 && (
            <div className="mt-3 flex items-center justify-between text-sm text-white/70">
              <span className="uppercase tracking-[0.2em] text-white/50">Итого</span>
              <span className="text-base font-semibold text-white">{cartTotalLabel} ₽</span>
            </div>
          )}
        </div>

        <div className="mt-8 flex gap-3 border-b border-white/10">
          <button
            onClick={() => setActiveTab("orders")}
            className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] transition ${
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
            className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] transition ${
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
            onClick={() => setActiveTab("settings")}
            className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] transition ${
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
                  const totalLabel = typeof order.total === "number" ? formatPrice(order.total) : null;
                  const progressStage = getOrderProgressStage(order.status);
                  const statusKey = normalizeOrderStatus(order.status);
                  const canCancel = canCancelOrder(statusKey);
                  const orderId = String(order.id);
                  return (
                    <div
                      key={order.id}
                      className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                            {order.id}
                          </p>
                          <h3 className="mt-2 text-xl font-semibold text-white">
                            {getOrderProductName(order)}
                          </h3>
                          <p className="mt-1 text-sm text-white/60">
                            {getOrderPrimaryFormat(order)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                            {formatDate(order.createdAt || order.updatedAt)}
                          </p>
                          <p className={`mt-2 text-sm font-semibold ${getOrderStatusClass(order.status)}`}>
                            {getOrderStatusLabel(order.status)}
                          </p>
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-white/40">
                              {ORDER_PROGRESS_STEPS.map((step, index) => (
                                <span
                                  key={step}
                                  className={index <= progressStage ? "text-[#2ED1FF]" : "text-white/30"}
                                >
                                  {step}
                                </span>
                              ))}
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-2">
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
                          {totalLabel && (
                            <p className="mt-1 text-sm text-white/70">Итого: {totalLabel} ₽</p>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              disabled={cancelingOrderId === orderId}
                              aria-disabled={cancelingOrderId === orderId}
                              onClick={() => handleCancelOrder(orderId)}
                              className="mt-3 rounded-full border border-red-400/20 bg-transparent px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-red-200/70 transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {cancelingOrderId === orderId ? "Отменяем..." : "Отменить заказ"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
          {activeTab === "downloads" && (
            <div className="space-y-4">
              {ordersLoading && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  Загружаем библиотеку...
                </div>
              )}
              {!ordersLoading && ordersError && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-red-200 backdrop-blur-xl">
                  {ordersError}
                </div>
              )}
              {!ordersLoading && !ordersError && downloads.length === 0 && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  Цифровая библиотека пуста.
                </div>
              )}
              {!ordersLoading &&
                !ordersError &&
                downloads.map((download) => (
                  <div
                    key={download.id}
                    className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
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
                          <p className="mt-1 text-sm text-white/60">Размер файла: {download.fileSize}</p>
                        </div>
                      </div>
                      {download.ready ? (
                        <a
                          href={download.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          download
                          className="flex items-center gap-2 rounded-full bg-[#2ED1FF]/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-[#2ED1FF] transition hover:bg-[#2ED1FF]/30"
                        >
                          <Download className="h-4 w-4" />
                          Скачать .STL
                        </a>
                      ) : (
                        <span className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/40">
                          <Download className="h-4 w-4" />
                          Готовится
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
          {activeTab === "settings" && (
            <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-8 backdrop-blur-xl">
              <form className="space-y-6" onSubmit={handleSettingsSubmit}>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">Имя</label>
                  <input
                    type="text"
                    defaultValue={user.name || "Демо пользователь"}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">Email</label>
                  <input
                    type="email"
                    defaultValue={user.email || "demo@example.com"}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                    Адрес доставки
                  </label>
                  <textarea
                    defaultValue={user.shippingAddress || "Город, улица, дом, квартира"}
                    className="min-h[90px] w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                    Новый пароль
                  </label>
                  <input
                    type="password"
                    placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
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
          )}
        </div>
      </div>
    </div>
  );
}


