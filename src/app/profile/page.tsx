"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Download, LogOut, Package, Settings, User } from "lucide-react";
import AuthForm from "@/components/AuthForm";

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<"orders" | "downloads" | "settings">("orders");
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "";

  useEffect(() => {
    fetch(`${apiBase}/api/users/me`, {
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
    if (!user?.id) {
      setOrders([]);
      setOrdersError(null);
      setOrdersLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams();
    params.set("where[user][equals]", String(user.id));
    params.set("depth", "2");
    params.set("limit", "20");

    setOrdersLoading(true);
    setOrdersError(null);

    fetch(`${apiBase}/api/orders?${params.toString()}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        setOrders(Array.isArray(data?.docs) ? data.docs : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") {
          return;
        }
        setOrdersError("Unable to load orders.");
      })
      .finally(() => {
        setOrdersLoading(false);
      });

    return () => controller.abort();
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

  const formatDate = (value?: string) => {
    if (!value) {
      return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  };

  const formatFileSize = (bytes?: number) => {
    if (typeof bytes !== "number" || Number.isNaN(bytes)) {
      return "N/A";
    }

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
    if (order?.product && typeof order.product === "object") {
      return order.product;
    }

    return null;
  };

  const getOrderProductName = (order: any) => {
    const product = getOrderProduct(order);
    return product?.name || "Product";
  };

  const getOrderFormatLabel = (format?: string) => {
    if (format === "Digital") {
      return "Digital STL";
    }
    if (format === "Physical") {
      return "Physical Print";
    }

    return format || "Unknown";
  };

  const getOrderStatusLabel = (status?: string) => {
    return status || "Pending";
  };

  const getOrderStatusClass = (status?: string) => {
    if (status === "Shipped") {
      return "text-emerald-400";
    }
    if (status === "Printing") {
      return "text-[#2ED1FF]";
    }

    return "text-white/60";
  };

  const downloads = orders.reduce(
    (
      acc: {
        id: string;
        product: string;
        fileSize: string;
        downloadUrl: string;
        ready: boolean;
      }[],
      order: any
    ) => {
      if (order?.format !== "Digital") {
        return acc;
      }

      const product = getOrderProduct(order);
      const productName = product?.name || "Digital STL";
      const rawModel = product?.rawModel;
      const paintedModel = product?.paintedModel;
      const file =
        rawModel && typeof rawModel === "object"
          ? rawModel
          : paintedModel && typeof paintedModel === "object"
            ? paintedModel
            : null;
      const downloadUrl = typeof file?.url === "string" ? file.url : "";
      const fileSize =
        typeof file?.filesize === "number" ? formatFileSize(file.filesize) : formatFileSize();
      const id = String(order?.id || product?.id || productName);

      acc.push({
        id,
        product: productName,
        fileSize,
        downloadUrl,
        ready: Boolean(downloadUrl),
      });

      return acc;
    },
    []
  );

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

        <div className="mt-8 flex gap-3 border-b border-white/10">
          <button
            onClick={() => setActiveTab("orders")}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] transition ${
              activeTab === "orders"
                ? "border-b-2 border-[#2ED1FF] text-[#2ED1FF]"
                : "text-white/50 hover:text-white"
            }`}
          >
            <Package className="h-4 w-4" />
            Мои заказы
          </button>
          <button
            onClick={() => setActiveTab("downloads")}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] transition ${
              activeTab === "downloads"
                ? "border-b-2 border-[#2ED1FF] text-[#2ED1FF]"
                : "text-white/50 hover:text-white"
            }`}
          >
            <Download className="h-4 w-4" />
            Цифровая библиотека
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] transition ${
              activeTab === "settings"
                ? "border-b-2 border-[#2ED1FF] text-[#2ED1FF]"
                : "text-white/50 hover:text-white"
            }`}
          >
            <Settings className="h-4 w-4" />
            Настройки
          </button>
        </div>

        <div className="mt-8">
          {activeTab === "orders" && (
            <div className="space-y-4">
              {ordersLoading && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  Loading orders...
                </div>
              )}
              {!ordersLoading && ordersError && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-red-200 backdrop-blur-xl">
                  {ordersError}
                </div>
              )}
              {!ordersLoading && !ordersError && orders.length === 0 && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  No orders yet.
                </div>
              )}
              {!ordersLoading &&
                !ordersError &&
                orders.map((order) => (
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
                        <p className="mt-1 text-sm text-white/60">{getOrderFormatLabel(order.format)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                          {formatDate(order.createdAt || order.updatedAt)}
                        </p>
                        <p className={`mt-2 text-sm font-semibold ${getOrderStatusClass(order.status)}`}>
                          {getOrderStatusLabel(order.status)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
          {activeTab === "downloads" && (
            <div className="space-y-4">
              {ordersLoading && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  Loading library...
                </div>
              )}
              {!ordersLoading && ordersError && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-red-200 backdrop-blur-xl">
                  {ordersError}
                </div>
              )}
              {!ordersLoading && !ordersError && downloads.length === 0 && (
                <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 text-sm text-white/60 backdrop-blur-xl">
                  No downloads yet.
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
                      <div>
                        <h3 className="text-xl font-semibold text-white">{download.product}</h3>
                        <p className="mt-1 text-sm text-white/60">File size: {download.fileSize}</p>
                      </div>
                      {download.ready ? (
                        <a
                          href={download.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 rounded-full bg-[#2ED1FF]/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-[#2ED1FF] transition hover:bg-[#2ED1FF]/30"
                        >
                          <Download className="h-4 w-4" />
                          Download STL
                        </a>
                      ) : (
                        <span className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/40">
                          <Download className="h-4 w-4" />
                          Not ready
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
{activeTab === "settings" && (
            <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-8 backdrop-blur-xl">
              <form className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">Имя</label>
                  <input
                    type="text"
                    defaultValue="Демо пользователь"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">Email</label>
                  <input
                    type="email"
                    defaultValue="demo@example.com"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                    Адрес доставки
                  </label>
                  <textarea
                    defaultValue="Город, улица, дом, квартира"
                    className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                    Новый пароль
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                  />
                </div>

                <button
                  type="submit"
                  className="rounded-full bg-[#2ED1FF] px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-[#050505] transition hover:bg-[#8fe6ff]"
                >
                  Сохранить изменения
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
