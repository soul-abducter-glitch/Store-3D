"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type DigitalLibraryItem = {
  id: string;
  entitlementId: string;
  productId: string;
  title: string;
  format: string;
  fileSize: string;
  previewUrl: string;
  canDownload: boolean;
  blockedReason?: string;
  purchasedAt?: string | null;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export default function DigitalLibraryPage() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<DigitalLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search || "");
    setToken((params.get("token") || "").trim());
  }, []);

  const apiBase = "";
  const libraryUrl = useMemo(() => {
    if (!token) return `${apiBase}/api/digital/library`;
    return `${apiBase}/api/digital/library?token=${encodeURIComponent(token)}`;
  }, [apiBase, token]);

  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(libraryUrl, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось загрузить цифровую библиотеку.");
      }
      const docs = Array.isArray(data?.items) ? data.items : [];
      const mapped: DigitalLibraryItem[] = docs
        .map((entry: any) => {
          const entitlementId = String(entry?.entitlementId || "").trim();
          const productId = String(entry?.productId || "").trim();
          if (!entitlementId || !productId) return null;
          return {
            id: String(entry?.id || entitlementId),
            entitlementId,
            productId,
            title: String(entry?.title || "Цифровой файл"),
            format: String(entry?.format || "Digital STL"),
            fileSize: String(entry?.fileSize || "N/A"),
            previewUrl: typeof entry?.previewUrl === "string" ? entry.previewUrl : "",
            canDownload: Boolean(entry?.canDownload),
            blockedReason:
              typeof entry?.blockedReason === "string" && entry.blockedReason.trim()
                ? entry.blockedReason.trim()
                : undefined,
            purchasedAt: typeof entry?.purchasedAt === "string" ? entry.purchasedAt : null,
          } satisfies DigitalLibraryItem;
        })
        .filter((entry: DigitalLibraryItem | null): entry is DigitalLibraryItem => Boolean(entry));
      setItems(mapped);
    } catch (error) {
      setError(
        error instanceof Error && error.message
          ? error.message
          : "Не удалось загрузить цифровую библиотеку."
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [libraryUrl]);

  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  const handleDownload = useCallback(
    async (item: DigitalLibraryItem) => {
      setDownloadingId(item.id);
      try {
        const response = await fetch(`${apiBase}/api/downloads/createLink`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entitlementId: item.entitlementId,
            productId: item.productId,
            ...(token ? { guestToken: token } : {}),
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
      } catch (error) {
        setError(
          error instanceof Error && error.message
            ? error.message
            : "Не удалось скачать файл. Попробуйте снова."
        );
      } finally {
        setDownloadingId(null);
      }
    },
    [apiBase, token]
  );

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-white/50">
              Digital Library
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white">Цифровые файлы</h1>
          </div>
          <div className="flex gap-2">
            <Link
              href="/profile?tab=downloads"
              className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-300/70"
            >
              Войти в профиль
            </Link>
            <button
              type="button"
              onClick={() => void fetchLibrary()}
              className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
            >
              Обновить
            </button>
          </div>
        </div>

        {token ? (
          <p className="mb-4 text-xs text-cyan-100/80">Гостевой доступ по email-ссылке активен.</p>
        ) : (
          <p className="mb-4 text-xs text-white/55">
            Если вы гость, откройте страницу по ссылке из письма после покупки.
          </p>
        )}

        {loading && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-white/70">
            Загружаем библиотеку...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-5 text-sm text-red-100">
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-white/70">
            Файлы не найдены.
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  {item.previewUrl ? (
                    <img
                      src={item.previewUrl}
                      alt={item.title}
                      className="h-14 w-14 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-xl bg-white/10" />
                  )}
                  <div>
                    <p className="text-lg font-semibold text-white">{item.title}</p>
                    <p className="text-sm text-white/60">
                      {item.format} • {item.fileSize}
                    </p>
                    {item.purchasedAt && (
                      <p className="text-xs text-white/45">
                        Покупка: {formatDateTime(item.purchasedAt)}
                      </p>
                    )}
                    {item.blockedReason && (
                      <p className="text-xs text-amber-200">{item.blockedReason}</p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!item.canDownload || downloadingId === item.id}
                  onClick={() => void handleDownload(item)}
                  className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {downloadingId === item.id ? "Готовим..." : "Скачать"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
