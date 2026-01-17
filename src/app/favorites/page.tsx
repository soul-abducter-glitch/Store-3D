"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Heart } from "lucide-react";
import { useFavorites } from "@/lib/favorites";

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function FavoritesPage() {
  const { favorites, toggleFavorite } = useFavorites();
  const hasFavorites = favorites.length > 0;

  return (
    <div className="relative min-h-screen bg-[#050505] text-white font-[var(--font-inter)]">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.18),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.14),transparent_70%)] blur-2xl" />
      </div>

      <header className="relative z-10 mx-auto max-w-[1200px] px-4 pt-10 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.35em] text-white/60 transition hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Назад в витрину
        </Link>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.35em] text-white/40">
              DARK LAB
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-[0.2em] text-white sm:text-4xl">
              Избранное
            </h1>
            <p className="mt-3 max-w-xl text-sm text-white/60">
              Коллекция моделей, которые вы хотите держать под рукой перед печатью.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] uppercase tracking-[0.35em] text-white/60">
            <Heart className="h-4 w-4 text-rose-200" />
            <span>{favorites.length} в избранном</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1200px] px-4 pb-16 pt-10 sm:px-6">
        {hasFavorites ? (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {favorites.map((item) => (
              <motion.div
                key={item.id}
                variants={cardVariants}
                className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl"
              >
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt={item.name}
                      loading="lazy"
                      className="h-40 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-40 w-full items-center justify-center text-xs uppercase tracking-[0.3em] text-white/40">
                      No Preview
                    </div>
                  )}
                  <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white shadow-[0_0_12px_rgba(0,0,0,0.4)]">
                    {item.formatLabel}
                  </span>
                  <button
                    type="button"
                    aria-label="Удалить из избранного"
                    className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-rose-400/60 bg-rose-500/20 text-rose-200 shadow-[0_0_14px_rgba(244,63,94,0.45)] transition hover:bg-rose-500/30"
                    onClick={() => toggleFavorite(item)}
                  >
                    <Heart className="h-4 w-4" fill="currentColor" />
                  </button>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{item.name}</h3>
                    <p className="mt-1 text-xs text-white/60">{item.tech}</p>
                  </div>
                  <span className="text-base font-semibold text-white">{item.priceLabel}</span>
                </div>
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <div className="flex min-h-[320px] items-center justify-center">
            <div className="relative w-full max-w-2xl overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
              <div className="pointer-events-none absolute inset-0 cad-grid-pattern opacity-20" />
              <div className="relative flex flex-col items-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-rose-400/40 bg-rose-500/10 text-rose-200 shadow-[0_0_16px_rgba(244,63,94,0.35)]">
                  <Heart className="h-5 w-5" />
                </div>
                <p className="mt-6 text-sm uppercase tracking-[0.2em] text-white/70">
                  Ваш список желаний пуст. Сохраните то, что планируете напечатать
                </p>
                <Link
                  href="/"
                  className="mt-6 inline-flex items-center gap-2 rounded-full border border-[#2ED1FF]/45 bg-[#0b1014] px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-[#BFF4FF] shadow-[0_0_18px_rgba(46,209,255,0.35)] transition hover:border-[#7FE7FF] hover:text-white"
                >
                  Вернуться в каталог
                </Link>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
