"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls, Stage } from "@react-three/drei";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronDown,
  Layers,
  RotateCw,
  Scan,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Upload,
  User,
} from "lucide-react";

const categories = [
  {
    title: "Персонажи и люди",
    items: ["Мужчины", "Женщины", "Фэнтези-расы"],
  },
  {
    title: "Настолки и игры",
    items: ["Монстры", "Сценки", "Аксессуары"],
  },
  {
    title: "Дом и декор",
    items: ["Вазы", "Освещение", "Органайзеры"],
  },
  {
    title: "Хобби и игрушки",
    items: ["Флекси-игрушки", "Косплей"],
  },
];

const productCards = [
  {
    name: "Seraph Sentinel",
    type: "Цифровой STL",
    tech: "SLA смола",
    price: "₽2 800",
    verified: true,
  },
  {
    name: "Nebula Relic Vase",
    type: "Печатная модель",
    tech: "FDM пластик",
    price: "₽6 200",
    verified: true,
  },
  {
    name: "Warden of the Rift",
    type: "Цифровой STL",
    tech: "SLA смола",
    price: "₽3 200",
    verified: false,
  },
  {
    name: "Orbit Dock Organizer",
    type: "Печатная модель",
    tech: "FDM пластик",
    price: "₽4 400",
    verified: true,
  },
  {
    name: "Gilded Wyvern",
    type: "Цифровой STL",
    tech: "SLA смола",
    price: "₽4 000",
    verified: true,
  },
  {
    name: "Arcforge Diorama",
    type: "Печатная модель",
    tech: "FDM пластик",
    price: "₽7 500",
    verified: false,
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6 } },
};

type FinishMode = "raw" | "pro";
type PreviewMode = "interior" | "ar";
type FormatMode = "digital" | "physical";

export default function Home() {
  const [autoRotate, setAutoRotate] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [finish, setFinish] = useState<FinishMode>("raw");
  const [preview, setPreview] = useState<PreviewMode>("interior");
  const [format, setFormat] = useState<FormatMode>("digital");

  return (
    <div className="relative min-h-screen bg-[#050505] text-white font-[var(--font-inter)]">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.2),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
      </div>
      <GlobalHudMarkers />
      <Header onFormatChange={setFormat} />
      <div className="relative z-10 mx-auto max-w-[1400px] px-6 pb-24">
        <div className="grid gap-8 xl:grid-cols-[280px_1fr]">
          <Sidebar format={format} onFormatChange={setFormat} />
          <main className="space-y-10">
            <motion.section
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="space-y-6"
            >
              <motion.div
                variants={itemVariants}
                className="relative overflow-hidden rounded-[32px] border border-white/5 bg-white/[0.02] p-6 rim-light"
              >
                <HUD />
                <div className="relative h-[420px] w-full overflow-hidden rounded-3xl bg-[#070707] inner-depth">
                  <Experience autoRotate={autoRotate} wireframe={wireframe} finish={finish} />
                </div>
                <div className="absolute bottom-8 left-8">
                  <p className="text-sm font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
                    TECH_ID: ARC_V4_88
                  </p>
                  <h2 className="text-4xl font-bold italic tracking-wide text-white">
                    ARCHANGEL
                  </h2>
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <span className="text-2xl font-semibold text-white">
                      ₽24 900
                    </span>
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-full bg-[#2ED1FF]/20 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-[#2ED1FF] transition hover:bg-[#2ED1FF]/30"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      В корзину
                    </button>
                  </div>
                </div>
                <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 glass-dock">
                  <DockButton
                    active={autoRotate}
                    label="Авто-поворот"
                    icon={<RotateCw className="h-4 w-4" />}
                    onClick={() => setAutoRotate((prev) => !prev)}
                  />
                  <DockButton
                    active={wireframe}
                    label="Сетка"
                    icon={<Layers className="h-4 w-4" />}
                    onClick={() => setWireframe((prev) => !prev)}
                  />
                  <DockButton
                    active={preview === "interior"}
                    label="В интерьере"
                    icon={<Scan className="h-4 w-4" />}
                    onClick={() => setPreview("interior")}
                  />
                  <DockButton
                    active={preview === "ar"}
                    label="AR-просмотр"
                    icon={<Sparkles className="h-4 w-4" />}
                    onClick={() => setPreview("ar")}
                  />
                </div>
                <div className="absolute bottom-8 right-8 flex items-center gap-2 rounded-full bg-white/5 px-3 py-2 font-[var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-white/70">
                  <button
                    className={`rounded-full px-3 py-1 ${
                      finish === "raw"
                        ? "bg-white/15 text-white"
                        : "text-white/50 hover:text-white"
                    }`}
                    onClick={() => setFinish("raw")}
                  >
                    База (Серый)
                  </button>
                  <button
                    className={`rounded-full px-3 py-1 ${
                      finish === "pro"
                        ? "bg-white/15 text-white"
                        : "text-white/50 hover:text-white"
                    }`}
                    onClick={() => setFinish("pro")}
                  >
                    Мастерская покраска
                  </button>
                </div>
              </motion.div>
            </motion.section>

            <motion.section
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="space-y-5"
            >
              <motion.div variants={itemVariants} className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5">
                  <ShieldCheck className="h-5 w-5 text-[#D4AF37]" />
                </div>
                <div>
                  <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/40">
                    ПРОВЕРЕННЫЕ КОЛЛЕКЦИИ
                  </p>
                  <h3 className="text-2xl font-semibold text-white">
                    Отобранные подборки
                  </h3>
                </div>
              </motion.div>
              <motion.div
                variants={containerVariants}
                className="columns-1 gap-6 md:columns-2 xl:columns-3"
              >
                {productCards.map((card) => (
                  <motion.article
                    key={card.name}
                    variants={itemVariants}
                    className="mb-6 break-inside-avoid rounded-3xl bg-white/5 p-6 backdrop-blur-xl light-sweep"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-[#2ED1FF]">
                          {card.type}
                        </p>
                        <h4 className="mt-3 text-xl font-semibold text-white">
                          {card.name}
                        </h4>
                        <p className="mt-2 text-sm text-white/60">{card.tech}</p>
                      </div>
                      {card.verified && (
                        <CheckCircle2 className="h-5 w-5 text-[#D4AF37]" />
                      )}
                    </div>
                    <div className="mt-6 flex items-center justify-between text-sm">
                      <span className="font-[var(--font-jetbrains-mono)] uppercase tracking-[0.2em] text-white/40">
                        ПРЕМИУМ
                      </span>
                      <span className="text-lg font-semibold text-white">
                        {card.price}
                      </span>
                    </div>
                  </motion.article>
                ))}
              </motion.div>
            </motion.section>
          </main>
        </div>
      </div>
    </div>
  );
}

type HeaderProps = {
  onFormatChange: (value: FormatMode) => void;
};

function Header({ onFormatChange }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#050505]/80 backdrop-blur-xl">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="mx-auto grid max-w-[1400px] gap-6 px-6 py-5 lg:grid-cols-[1fr_auto_1fr] lg:items-center"
      >
        <motion.div variants={itemVariants} className="flex items-center gap-4">
          <div>
            <a href="/" className="block transition hover:opacity-80">
              <h1 className="text-3xl font-bold tracking-[0.2em] text-white">
                3D-STORE
              </h1>
            </a>
            <div className="mt-1 flex items-center gap-2 text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
              <span className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
              <span>СИСТЕМА: ONLINE</span>
            </div>
          </div>
        </motion.div>

        <motion.nav
          variants={itemVariants}
          className="flex flex-wrap items-center justify-center gap-4 text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em]"
        >
          <button
            type="button"
            className="text-white/60 transition hover:text-white"
            onClick={() => onFormatChange("physical")}
          >
            Физический магазин
          </button>
          <button
            type="button"
            className="text-white/60 transition hover:text-white"
            onClick={() => onFormatChange("digital")}
          >
            Цифровая библиотека
          </button>
          <div className="flex flex-wrap items-center justify-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2">
            <button
              type="button"
              className="text-white/60 transition hover:text-white"
              onClick={() => onFormatChange("physical")}
            >
              Услуги печати
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full bg-[#2ED1FF]/20 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[#2ED1FF] transition hover:bg-[#2ED1FF]/30"
            >
              <Upload className="h-3 w-3" />
              Загрузить файл
            </button>
          </div>
        </motion.nav>

        <motion.div
          variants={itemVariants}
          className="flex items-center justify-start gap-3 lg:justify-end"
        >
          <button
            type="button"
            aria-label="Поиск"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white"
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Корзина"
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white"
          >
            <ShoppingCart className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#2ED1FF] text-[10px] font-semibold text-[#050505]">
              3
            </span>
          </button>
          <a
            href="/profile"
            aria-label="Профиль"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:text-white"
          >
            <User className="h-5 w-5" />
          </a>
        </motion.div>
      </motion.div>
    </header>
  );
}

type SidebarProps = {
  format: FormatMode;
  onFormatChange: (value: FormatMode) => void;
};

function Sidebar({ format, onFormatChange }: SidebarProps) {
  const [technology, setTechnology] = useState<"sla" | "fdm">("sla");
  const [verified, setVerified] = useState(true);
  const [openCategory, setOpenCategory] = useState<string>(
    categories[0]?.title ?? ""
  );

  return (
    <motion.aside
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="flex flex-col space-y-6 rounded-[28px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl"
    >
      <motion.div variants={itemVariants} className="space-y-3">
        <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
          Технология
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-full bg-white/5 p-1">
          <button
            className={`rounded-full px-3 py-2 text-xs uppercase tracking-[0.2em] ${
              technology === "sla"
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white"
            }`}
            onClick={() => setTechnology("sla")}
          >
            SLA смола
          </button>
          <button
            className={`rounded-full px-3 py-2 text-xs uppercase tracking-[0.2em] ${
              technology === "fdm"
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white"
            }`}
            onClick={() => setTechnology("fdm")}
          >
            FDM пластик
          </button>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-3">
        <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
          Формат
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`rounded-2xl px-3 py-2 text-xs uppercase tracking-[0.2em] ${
              format === "digital"
                ? "bg-[#2ED1FF]/20 text-[#2ED1FF]"
                : "bg-white/5 text-white/60 hover:text-white"
            }`}
            onClick={() => onFormatChange("digital")}
          >
            Цифровой STL
          </button>
          <button
            className={`rounded-2xl px-3 py-2 text-xs uppercase tracking-[0.2em] ${
              format === "physical"
                ? "bg-[#2ED1FF]/20 text-[#2ED1FF]"
                : "bg-white/5 text-white/60 hover:text-white"
            }`}
            onClick={() => onFormatChange("physical")}
          >
            Печатная модель
          </button>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-3">
        <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
          Категории
        </p>
        <div className="space-y-2">
          {categories.map((category) => {
            const isOpen = openCategory === category.title;
            return (
              <div
                key={category.title}
                className="rounded-2xl bg-white/5 px-4 py-3"
              >
                <button
                  className="flex w-full items-center justify-between text-sm font-semibold text-white/80"
                  onClick={() =>
                    setOpenCategory(isOpen ? "" : category.title)
                  }
                >
                  <span>{category.title}</span>
                  <ChevronDown
                    className={`h-4 w-4 transition ${
                      isOpen ? "rotate-180 text-white" : "text-white/50"
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="mt-3 space-y-2 text-sm text-white/60">
                    {category.items.map((item) => (
                      <div
                        key={item}
                        className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2"
                      >
                        <span>{item}</span>
                        <span className="text-xs font-[var(--font-jetbrains-mono)] uppercase text-white/40">
                          18
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="mt-auto flex items-center justify-between rounded-2xl bg-[#D4AF37]/10 px-4 py-3"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#D4AF37]/20">
            <ShieldCheck className="h-5 w-5 text-[#D4AF37]" />
          </div>
          <div>
            <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-[#D4AF37]/80">
              ПРОВЕРЕНО_ГОТОВО
            </p>
            <p className="text-sm text-white/70">Только проверенные продавцы</p>
          </div>
        </div>
        <button
          className={`h-6 w-12 rounded-full border border-[#D4AF37]/40 p-1 transition ${
            verified
              ? "bg-[#D4AF37]/40 shadow-[0_0_16px_rgba(212,175,55,0.5)]"
              : "bg-white/5"
          }`}
          onClick={() => setVerified((prev) => !prev)}
        >
          <span
            className={`block h-4 w-4 rounded-full bg-[#D4AF37] transition ${
              verified ? "translate-x-6" : "translate-x-0"
            }`}
          />
        </button>
      </motion.div>
    </motion.aside>
  );
}

type ExperienceProps = {
  autoRotate: boolean;
  wireframe: boolean;
  finish: FinishMode;
};

function Experience({ autoRotate, wireframe, finish }: ExperienceProps) {
  const material = useMemo(
    () => ({
      color: finish === "pro" ? "#d7d0c7" : "#5c5c5c",
      metalness: finish === "pro" ? 0.7 : 0.2,
      roughness: finish === "pro" ? 0.25 : 0.65,
    }),
    [finish]
  );

  return (
    <Canvas
      camera={{ position: [2.6, 2.1, 3.1], fov: 42 }}
      dpr={[1, 2]}
      className="h-full w-full"
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#070707"]} />
      <Stage environment={null} intensity={1} shadows={false} adjustCamera={false}>
        <mesh castShadow receiveShadow>
          <torusKnotGeometry args={[0.9, 0.28, 300, 32]} />
          <meshStandardMaterial
            color={material.color}
            metalness={material.metalness}
            roughness={material.roughness}
            wireframe={wireframe}
          />
        </mesh>
      </Stage>
      <Environment preset="city" />
      <OrbitControls
        autoRotate={autoRotate}
        autoRotateSpeed={0.6}
        enablePan={false}
        minDistance={2.2}
        maxDistance={6}
      />
    </Canvas>
  );
}

function HUD() {
  return (
    <div className="absolute left-8 top-8 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 font-[var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-white/70">
      <div className="flex items-center gap-2 text-[#2ED1FF]">
        <span>ПОЛИГОНЫ:</span>
        <span className="text-white">2,452,900</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span>ВРЕМЯ_ПЕЧАТИ:</span>
        <span className="text-white">14h 22m</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span>МАСШТАБ:</span>
        <span className="text-white">1:1 REAL</span>
      </div>
    </div>
  );
}

function GlobalHudMarkers() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 font-[var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.3em] text-white/40">
      <div className="absolute left-6 top-6 flex items-center gap-3">
        <span className="text-[#2ED1FF]">X:128.4</span>
        <span>Y:42.9</span>
        <span>Z:88.1</span>
      </div>
      <div className="absolute right-6 top-6 flex items-center gap-3">
        <span>СИСТЕМА:НОРМА</span>
        <span>УЗЕЛ:07</span>
      </div>
      <div className="absolute bottom-6 left-6 flex items-center gap-3">
        <span>СЕТКА:ЗАФИКС</span>
        <span>ТРАССА:АКТИВНА</span>
      </div>
      <div className="absolute bottom-6 right-6 flex items-center gap-3">
        <span>СИГНАЛ:99%</span>
        <span>FPS:120</span>
      </div>
    </div>
  );
}

type DockButtonProps = {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
};

function DockButton({ active, label, icon, onClick }: DockButtonProps) {
  return (
    <button
      className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs uppercase tracking-[0.2em] transition ${
        active ? "bg-white/20 text-white" : "text-white/60 hover:text-white"
      }`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
