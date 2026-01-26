"use client";

import { useCallback, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { ChevronDown } from "lucide-react";

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

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050505] text-white font-[var(--font-inter)]">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-25" />
      <header className="fixed left-0 right-0 top-0 z-20">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => router.push("/store")}
            className="flex items-center gap-3 text-left"
          >
            <span className="text-lg font-semibold uppercase tracking-[0.35em]">3D-STORE</span>
            <span className="hidden text-[10px] uppercase tracking-[0.35em] text-emerald-300/80 sm:inline">
              Система: online
            </span>
          </button>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-white/70" />
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
          animate={{ scale: [1.05, 1.1, 1.05] }}
          transition={{ duration: 18, ease: "easeInOut", repeat: Infinity }}
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
        <div className="pointer-events-none absolute inset-0 -z-10 hero-vignette" />
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

        <div className="relative mx-auto flex max-w-4xl flex-col items-center text-center">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.55em] text-white/60"
          >
            3D STORE · LAB ENTRY
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 24, filter: "blur(18px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.9, ease: "easeOut", delay: 0.2 }}
            className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl"
          >
            СОВЕРШЕНСТВО В КАЖДОМ АТОМЕ
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
            className="mt-4 max-w-2xl text-sm text-white/70 sm:text-base"
          >
            От идеи до физического объекта: цифровые модели, печать и визуализация в единой лаборатории точности.
          </motion.p>
          <motion.button
            type="button"
            onClick={() => router.push("/store")}
            className="mt-10 flex flex-col items-center gap-2 text-xs uppercase tracking-[0.35em] text-white/70 transition hover:text-white"
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <span>В магазин</span>
            <ChevronDown className="h-5 w-5 text-[#2ED1FF]" />
          </motion.button>
        </div>
      </section>
    </div>
  );
}

