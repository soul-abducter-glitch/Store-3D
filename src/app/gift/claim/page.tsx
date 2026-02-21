"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Gift, Loader2 } from "lucide-react";

type ClaimState = "idle" | "loading" | "success" | "error" | "unauthorized";

const GiftClaimPage = () => {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<ClaimState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [productName, setProductName] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token")?.trim() || "");
  }, []);

  const handleClaim = useCallback(async () => {
    if (!token) {
      setStatus("error");
      setMessage("Ссылка подарка некорректна.");
      return;
    }
    setStatus("loading");
    setMessage(null);
    try {
      const response = await fetch("/api/gift/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        setStatus("unauthorized");
        setMessage("Войдите в профиль, чтобы принять подарок.");
        return;
      }
      if (!response.ok || !data?.success) {
        setStatus("error");
        setMessage(data?.error || "Не удалось принять подарок.");
        return;
      }
      setStatus("success");
      setProductName(typeof data?.productName === "string" ? data.productName : null);
      setMessage(
        data?.alreadyOwned
          ? "У вас уже есть доступ к этой модели. Подарок отмечен как принятый."
          : "Подарок принят. Модель добавлена в цифровую библиотеку."
      );
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("orders-updated"));
      }
    } catch {
      setStatus("error");
      setMessage("Ошибка сети. Попробуйте снова.");
    }
  }, [token]);

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="relative z-10 mx-auto max-w-[760px] px-6 py-24">
        <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-8 backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#2ED1FF]/40 bg-[#2ED1FF]/10 text-[#BFF4FF]">
            <Gift className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-center text-3xl font-semibold text-white">Принять подарок</h1>
          <p className="mt-2 text-center text-sm text-white/60">
            {productName
              ? `Модель: ${productName}`
              : "Подарок передает право на скачивание модели в вашу библиотеку."}
          </p>

          {message && (
            <div
              className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
                status === "success"
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                  : status === "unauthorized"
                    ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
                    : "border-red-400/30 bg-red-500/10 text-red-100"
              }`}
            >
              {message}
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {status !== "success" && status !== "loading" && (
              <button
                type="button"
                onClick={handleClaim}
                className="inline-flex items-center gap-2 rounded-full border border-[#2ED1FF]/50 bg-[#0b1014] px-6 py-3 text-xs uppercase tracking-[0.3em] text-[#BFF4FF] transition hover:border-[#7FE7FF] hover:text-white"
              >
                <CheckCircle2 className="h-4 w-4" />
                Принять подарок
              </button>
            )}
            {status === "loading" && (
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-xs uppercase tracking-[0.3em] text-white/70"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Проверяем...
              </button>
            )}
            {status === "unauthorized" && (
              <Link
                href="/profile"
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-xs uppercase tracking-[0.3em] text-white/80 transition hover:text-white"
              >
                Войти в профиль
              </Link>
            )}
            {status === "success" && (
              <Link
                href="/profile?tab=downloads"
                className="inline-flex items-center gap-2 rounded-full border border-[#2ED1FF]/50 bg-[#2ED1FF]/10 px-6 py-3 text-xs uppercase tracking-[0.3em] text-[#BFF4FF] transition hover:border-[#7FE7FF] hover:text-white"
              >
                Открыть библиотеку
              </Link>
            )}
            <Link
              href="/store"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:text-white"
            >
              В каталог
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GiftClaimPage;
