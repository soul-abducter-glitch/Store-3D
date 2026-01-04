"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Package, Settings, User } from "lucide-react";

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<"orders" | "downloads" | "settings">("orders");

  // Mock data - will be replaced with real API calls
  const orders = [
    {
      id: "ORD-001",
      product: "Seraph Sentinel",
      format: "Physical Print",
      status: "Печатается",
      date: "03.01.2026",
    },
    {
      id: "ORD-002",
      product: "Gilded Wyvern",
      format: "Digital STL",
      status: "Завершен",
      date: "02.01.2026",
    },
  ];

  const downloads = [
    {
      id: "DL-001",
      product: "Gilded Wyvern",
      fileSize: "124 MB",
      downloadUrl: "#",
    },
    {
      id: "DL-002",
      product: "Warden of the Rift",
      fileSize: "98 MB",
      downloadUrl: "#",
    },
  ];

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
          <Link
            href="/"
            className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад в магазин
          </Link>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-white/[0.04] px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
              <User className="h-6 w-6 text-white/70" />
            </div>
            <div>
              <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                demo@example.com
              </p>
              <p className="mt-1 text-lg font-semibold text-white">Демо пользователь</p>
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
              {orders.map((order) => (
                <div
                  key={order.id}
                  className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                        {order.id}
                      </p>
                      <h3 className="mt-2 text-xl font-semibold text-white">{order.product}</h3>
                      <p className="mt-1 text-sm text-white/60">{order.format}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
                        {order.date}
                      </p>
                      <p
                        className={`mt-2 text-sm font-semibold ${
                          order.status === "Завершен" ? "text-emerald-400" : "text-[#2ED1FF]"
                        }`}
                      >
                        {order.status}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "downloads" && (
            <div className="space-y-4">
              {downloads.map((download) => (
                <div
                  key={download.id}
                  className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-semibold text-white">{download.product}</h3>
                      <p className="mt-1 text-sm text-white/60">Размер файла: {download.fileSize}</p>
                    </div>
                    <a
                      href={download.downloadUrl}
                      className="flex items-center gap-2 rounded-full bg-[#2ED1FF]/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-[#2ED1FF] transition hover:bg-[#2ED1FF]/30"
                    >
                      <Download className="h-4 w-4" />
                      Скачать STL
                    </a>
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
