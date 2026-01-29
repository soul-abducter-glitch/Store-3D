"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { ChevronDown, Heart, Printer, ShoppingCart, Sparkles, User } from "lucide-react";
import { useFavorites } from "@/lib/favorites";

const HERO_PORTAL_IMAGE = "/backgrounds/prtal.png";
const HERO_PORTAL_MASK = "/backgrounds/portal_glow_mask_soft_score_blur.png";

const createSeededRandom = (seed: number) => {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
};

export default function Home() {
  const router = useRouter();
  const { favorites } = useFavorites();
  const [cartCount, setCartCount] = useState(0);
  const [userLabel, setUserLabel] = useState("ВХОД");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authStatus, setAuthStatus] = useState("AUTH_STATUS: GUEST");
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
    if (typeof window === "undefined") return;
    const readCart = () => {
      try {
        const raw = window.localStorage.getItem("store3d_cart");
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    };
    setCartCount(readCart());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "store3d_cart") {
        setCartCount(readCart());
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const fetchUser = async () => {
      try {
        const response = await fetch("/api/users/me", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          setIsAuthenticated(false);
          setUserLabel("ВХОД");
          setAuthStatus("AUTH_STATUS: GUEST");
          return;
        }
        const data = await response.json();
        if (!data?.id) {
          setIsAuthenticated(false);
          setUserLabel("ВХОД");
          setAuthStatus("AUTH_STATUS: GUEST");
          return;
        }
        const label =
          typeof data?.name === "string"
            ? data.name
            : typeof data?.email === "string"
              ? data.email.split("@")[0]
              : "NEO";
        setIsAuthenticated(true);
        setUserLabel(label.toUpperCase());
        setAuthStatus("AUTH_STATUS: NEO_LOGGED_IN");
      } catch {
        setIsAuthenticated(false);
        setUserLabel("ВХОД");
        setAuthStatus("AUTH_STATUS: GUEST");
      }
    };
    fetchUser();
    return () => controller.abort();
  }, []);

  const handleCartClick = useCallback(() => {
    if (cartCount > 0) {
      router.push("/checkout");
    } else {
      router.push("/store");
    }
  }, [cartCount, router]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050505] text-white font-[var(--font-inter)]">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-25" />
      <header className="fixed left-0 right-0 top-0 z-20">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => router.push("/store")}
            className="flex flex-col items-start gap-1 text-left"
          >
            <span className="text-[9px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.4em] text-white/60">
              [ {authStatus} ]
            </span>
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold uppercase tracking-[0.35em]">3D-STORE</span>
              <span className="hidden text-[10px] uppercase tracking-[0.35em] text-emerald-300/80 sm:inline">
                Система: online
              </span>
            </div>
          </button>
          <nav className="hidden items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.32em] text-white/70 md:flex">
            {[
              { label: "ЗАКАЗ_ПЕЧАТИ", href: "/services/print" },
              { label: "AI_ЛАБОРАТОРИЯ", href: "/ai-lab" },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => router.push(item.href)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 transition hover:border-[#2ED1FF]/60 hover:text-white"
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/favorites")}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[#D4AF37]/40 bg-white/5 text-[#D4AF37] transition hover:border-[#D4AF37] group"
              aria-label="Избранное"
            >
              <Heart className="h-4 w-4" />
              {favorites.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#D4AF37] px-1 text-[9px] font-semibold text-black">
                  {favorites.length}
                </span>
              )}
              <span className="hero-tooltip">Избранное</span>
            </button>
            <button
              type="button"
              onClick={handleCartClick}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 transition hover:border-[#2ED1FF]/70 hover:text-white group"
              aria-label="Корзина"
            >
              <ShoppingCart className="h-4 w-4" />
              {cartCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#2ED1FF] px-1 text-[9px] font-semibold text-[#00111a]">
                  {cartCount}
                </span>
              )}
              <span className="hero-tooltip">Корзина</span>
            </button>
            <button
              type="button"
              onClick={() => router.push("/profile")}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 transition hover:border-[#2ED1FF]/70 hover:text-white group"
              aria-label="Авторизация"
            >
              <User className="h-4 w-4" />
              <span className="hero-tooltip">{isAuthenticated ? "Профиль" : "Войти"}</span>
            </button>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1400px] items-center justify-center gap-2 px-4 pb-3 sm:hidden">
          <button
            type="button"
            onClick={() => router.push("/ai-lab")}
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[9px] uppercase tracking-[0.28em] text-white/70 transition hover:border-[#2ED1FF]/60 hover:text-white"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#2ED1FF]" />
            AI
          </button>
          <button
            type="button"
            onClick={() => router.push("/services/print")}
            className="flex items-center gap-1.5 rounded-full border border-[#2ED1FF] bg-[#0b1014] px-3 py-1.5 text-[9px] uppercase tracking-[0.28em] text-[#BFF4FF] shadow-[0_0_12px_rgba(46,209,255,0.4)] transition hover:border-[#7FE7FF] hover:text-white"
          >
            <Printer className="h-3.5 w-3.5" />
            ПЕЧАТЬ
          </button>
        </div>
      </header>

      <section
        className="relative z-10 flex min-h-screen items-center justify-center overflow-hidden px-4 pt-24 sm:px-6"
        onMouseMove={handleHeroParallax}
        onMouseLeave={resetHeroParallax}
      >
        <motion.img
          src={HERO_PORTAL_IMAGE}
          alt="Portal background"
          className="absolute inset-0 -z-10 h-full w-full object-cover"
          style={{ x: heroParallaxXSpring, y: heroParallaxYSpring }}
          animate={{ scale: [1.03, 1.18] }}
          transition={{ duration: 30, ease: "linear", repeat: Infinity, repeatType: "loop" }}
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
        <div className="pointer-events-none absolute inset-0 -z-10 hero-holo-arcs" />
        <div className="pointer-events-none absolute inset-0 -z-10 hero-vignette" />
        <div className="pointer-events-none absolute inset-0 -z-10 hero-warm-accent" />
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
        <div className="pointer-events-none absolute inset-6 z-10 hero-brackets">
          <span className="hero-bracket hero-bracket--tl" />
          <span className="hero-bracket hero-bracket--tr" />
          <span className="hero-bracket hero-bracket--bl" />
          <span className="hero-bracket hero-bracket--br" />
        </div>
        <div className="pointer-events-none absolute inset-0 -z-10 hero-scanline" />
        <div className="pointer-events-none absolute inset-0 -z-10 hero-data-tags">
          <span style={{ top: "34%", left: "18%" }}>[ SYSTEM_TYPE: ADAPTIVE_STORE ]</span>
          <span style={{ top: "50%", right: "18%" }}>[ DATA_SYNC: PAYLOAD_DB_v3 ]</span>
          <span style={{ top: "62%", left: "22%" }}>[ RENDER_ENGINE: WEBGL_CORE ]</span>
        </div>

        <div className="relative mx-auto flex max-w-4xl flex-col items-center text-center">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.55em] text-white/60"
          >
            3D STORE · COMMAND ENTRY
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 24, filter: "blur(18px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.9, ease: "easeOut", delay: 0.2 }}
            className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl"
          >
            МАТЕРИАЛИЗАЦИЯ ИДЕЙ
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
            className="mt-5 max-w-3xl rounded-2xl border border-white/10 bg-black/18 px-5 py-3 text-sm text-white/85 shadow-[0_6px_18px_rgba(0,0,0,0.28)] backdrop-blur-md sm:text-base"
          >
            Премиальный маркетплейс 3D-активов. Коллекционные изделия и цифровые файлы для печати. От концепта до физического объекта.
          </motion.p>
          <motion.button
            type="button"
            onClick={() => router.push("/store")}
            className="mt-10 flex flex-col items-center gap-2 text-xs uppercase tracking-[0.35em] text-white/70 transition hover:text-white"
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <span>В МАГАЗИН</span>
            <ChevronDown className="h-5 w-5 text-[#2ED1FF]" />
          </motion.button>
        </div>
      </section>
    </div>
  );
}

