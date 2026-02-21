"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { Heart, ShoppingCart, User } from "lucide-react";
import { useFavorites } from "@/lib/favorites";
import { LEGACY_CART_KEY, getCartStorageKey, readCartStorage } from "@/lib/cartStorage";

const HERO_PORTAL_IMAGE = "/backgrounds/prtal.png";
const HERO_PORTAL_MASK = "/backgrounds/portal_glow_mask_soft_score_blur.png";
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

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
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const heroParallaxX = useMotionValue(0);
  const heroParallaxY = useMotionValue(0);
  const heroParallaxXSpring = useSpring(heroParallaxX, { stiffness: 80, damping: 18, mass: 0.4 });
  const heroParallaxYSpring = useSpring(heroParallaxY, { stiffness: 80, damping: 18, mass: 0.4 });
  const cartStorageKey = useMemo(() => getCartStorageKey(userId), [userId]);
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
    if (!authReady) return;
    const readCart = () => {
      const parsed = readCartStorage(cartStorageKey, { migrateLegacy: true });
      return Array.isArray(parsed) ? parsed.length : 0;
    };
    setCartCount(readCart());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === cartStorageKey || event.key === LEGACY_CART_KEY) {
        setCartCount(readCart());
      }
    };
    const handleCartUpdated = () => setCartCount(readCart());
    window.addEventListener("storage", handleStorage);
    window.addEventListener("cart-updated", handleCartUpdated);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("cart-updated", handleCartUpdated);
    };
  }, [authReady, cartStorageKey]);

  const fetchUser = useCallback(() => {
    const controller = new AbortController();
    const run = async () => {
      try {
        const response = await fetch("/api/users/me", {
          signal: controller.signal,
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) {
          setIsAuthenticated(false);
          setUserLabel("ВХОД");
          setAuthStatus("AUTH_STATUS: GUEST");
          setUserId(null);
          setAuthReady(true);
          return;
        }
        const data = await response.json();
        const user = data?.user ?? data?.doc ?? data ?? null;
        if (!user?.id) {
          setIsAuthenticated(false);
          setUserLabel("ВХОД");
          setAuthStatus("AUTH_STATUS: GUEST");
          setUserId(null);
          setAuthReady(true);
          return;
        }
        const label =
          typeof user?.name === "string"
            ? user.name
            : typeof user?.email === "string"
              ? user.email.split("@")[0]
              : "NEO";
        setIsAuthenticated(true);
        setUserLabel(label.toUpperCase());
        setAuthStatus("AUTH_STATUS: AUTHENTICATED");
        setUserId(String(user.id));
        setAuthReady(true);
      } catch {
        setIsAuthenticated(false);
        setUserLabel("ВХОД");
        setAuthStatus("AUTH_STATUS: GUEST");
        setUserId(null);
        setAuthReady(true);
      }
    };
    run();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const cleanup = fetchUser();
    const handleAuthUpdate = () => {
      fetchUser();
    };
    window.addEventListener("auth-updated", handleAuthUpdate);
    return () => {
      cleanup?.();
      window.removeEventListener("auth-updated", handleAuthUpdate);
    };
  }, [fetchUser]);

  const handleCartClick = useCallback(() => {
    if (isAuthenticated) {
      router.push("/profile");
      return;
    }
    router.push("/profile?from=checkout");
  }, [isAuthenticated, router]);

  const profileButtonClass = isAuthenticated
    ? "relative flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-white/80 transition hover:border-[#2ED1FF]/70 hover:text-white group"
    : "relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 transition hover:border-[#2ED1FF]/70 hover:text-white group";

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "3D-STORE",
      url: siteUrl,
      logo: `${siteUrl}/icon.svg`,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "3D-STORE",
      url: siteUrl,
      potentialAction: {
        "@type": "SearchAction",
        target: `${siteUrl}/store?query={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ];
  const heroPrimaryActions = [
    { label: "ПЕЧАТЬ НА ЗАКАЗ", href: "/services/print" },
    { label: "СОЗДАТЬ 3D", href: "/ai-lab" },
  ] as const;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050505] text-white font-[var(--font-inter)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
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
              className={profileButtonClass}
              aria-label="Авторизация"
            >
              <User className="h-4 w-4" />
              {isAuthenticated && (
                <span className="hidden text-[9px] uppercase tracking-[0.3em] text-white/70 sm:inline">
                  {userLabel}
                </span>
              )}
              <span className="hero-tooltip">{isAuthenticated ? "Профиль" : "Войти"}</span>
            </button>
          </div>
        </div>
      </header>

      <section
        className="relative z-10 flex min-h-screen items-center justify-center overflow-hidden px-4 pb-20 pt-28 sm:px-6 sm:pt-32"
        onMouseMove={handleHeroParallax}
        onMouseLeave={resetHeroParallax}
      >
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.15 }}
          className="absolute left-1/2 top-[88px] z-20 flex w-full max-w-[640px] -translate-x-1/2 flex-wrap items-center justify-center gap-2 px-4 sm:top-[96px] sm:gap-3"
        >
          {heroPrimaryActions.map((action) => (
            <Link key={`hero-top-${action.label}`} href={action.href} className="hero-top-pill">
              {action.label}
            </Link>
          ))}
        </motion.div>

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
        <div className="pointer-events-none absolute inset-x-[4%] bottom-[12%] top-[16%] -z-10 hero-copy-safe" />

        <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center text-center">
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
            className="mt-4 max-w-4xl text-3xl font-bold tracking-tight text-white drop-shadow-[0_10px_28px_rgba(0,0,0,0.65)] sm:text-5xl lg:text-6xl"
          >
            МАТЕРИАЛИЗАЦИЯ ИДЕЙ
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
            className="mt-5 max-w-3xl rounded-2xl border border-white/12 bg-black/28 px-5 py-3 text-sm text-white/90 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md sm:text-base"
          >
            Премиальный маркетплейс 3D-активов. Коллекционные изделия и цифровые файлы для печати. От концепта до физического объекта.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.62 }}
            className="mt-7 flex justify-center"
          >
            <Link href="/store" className="hero-entry-center">
              В КАТАЛОГ
            </Link>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

