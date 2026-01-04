"use client";

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Grid, OrbitControls, Stage } from "@react-three/drei";
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
import ModelView from "@/components/ModelView";

const CATEGORY_SHELL = [
  {
    title: "Персонажи",
    items: ["Мужчины", "Женщины", "Фэнтези"],
  },
  {
    title: "Настолки",
    items: ["Миниатюры", "Монстры", "Сцены"],
  },
  {
    title: "Дом",
    items: ["Декор", "Органайзеры", "Освещение"],
  },
  {
    title: "Хобби",
    items: ["Косплей", "Игрушки", "Аксессуары"],
  },
];

type TechMode = "sla" | "fdm";

type SidebarCategory = {
  title: string;
  items: string[];
};

type CategoryDoc = {
  id?: string;
  title?: string;
  parent?: string | { id?: string; title?: string } | null;
};

type MediaDoc = {
  id?: string;
  url?: string;
  filename?: string;
};

type ProductDoc = {
  id?: string;
  name?: string;
  slug?: string;
  sku?: string;
  format?: string;
  technology?: string;
  price?: number;
  isVerified?: boolean;
  isFeatured?: boolean;
  category?: CategoryDoc | string | null;
  categories?: CategoryDoc[] | string[] | null;
  rawModel?: MediaDoc | string | null;
  paintedModel?: MediaDoc | string | null;
};

const normalizeFormat = (value?: string) => {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("digital")) {
    return "digital";
  }
  if (normalized.includes("physical")) {
    return "physical";
  }
  return null;
};

const normalizeTechnology = (value?: string) => {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("sla")) {
    return "sla";
  }
  if (normalized.includes("fdm")) {
    return "fdm";
  }
  return null;
};

const formatPrice = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("ru-RU").format(value);
};

const resolveMediaUrl = (value?: MediaDoc | string | null) => {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value.url) {
    return value.url;
  }
  if (value.filename) {
    return `/media/${value.filename}`;
  }
  return null;
};

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
  const [technology, setTechnology] = useState<TechMode>("sla");
  const [activeCategory, setActiveCategory] = useState("");
  const [products, setProducts] = useState<ProductDoc[]>([]);
  const [categoriesData, setCategoriesData] = useState<CategoryDoc[]>([]);
  const [productsError, setProductsError] = useState(false);
  const [categoriesError, setCategoriesError] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const apiBase = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;
    const buildApiUrl = (path: string) => `${apiBase}${path}`;

    const fetchData = async () => {
      setDataLoading(true);
      setProductsError(false);
      setCategoriesError(false);

      const [categoriesResult, productsResult] = await Promise.allSettled([
        fetch(buildApiUrl("/api/categories?depth=1&limit=200"), {
          signal: controller.signal,
        }).then((res) => (res.ok ? res.json() : Promise.reject(res))),
        fetch(buildApiUrl("/api/products?depth=1&limit=200"), {
          signal: controller.signal,
        }).then((res) => (res.ok ? res.json() : Promise.reject(res))),
      ]);

      if (!isMounted) {
        return;
      }

      if (categoriesResult.status === "fulfilled") {
        setCategoriesData(categoriesResult.value?.docs ?? []);
      } else {
        setCategoriesData([]);
        setCategoriesError(true);
      }

      if (productsResult.status === "fulfilled") {
        setProducts(productsResult.value?.docs ?? []);
      } else {
        setProducts([]);
        setProductsError(true);
      }

      setDataLoading(false);
    };

    fetchData().catch(() => {
      if (!isMounted) {
        return;
      }
      setProductsError(true);
      setCategoriesError(true);
      setProducts([]);
      setCategoriesData([]);
      setDataLoading(false);
    });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [apiBase]);

  const categoriesById = useMemo(() => {
    const map = new Map<string, string>();
    categoriesData?.forEach((category) => {
      if (category?.id && category?.title) {
        map.set(String(category.id), category.title);
      }
    });
    return map;
  }, [categoriesData]);

  const sidebarCategories = useMemo<SidebarCategory[]>(() => {
    const baseTitles = new Set(CATEGORY_SHELL.map((category) => category.title));
    const childrenByParent = new Map<string, string[]>();

    categoriesData?.forEach((category) => {
      if (!category?.title) {
        return;
      }

      let parentTitle: string | null = null;
      const parent = category.parent;
      if (typeof parent === "string") {
        parentTitle = categoriesById.get(parent) ?? null;
      } else if (typeof parent === "object") {
        parentTitle =
          parent?.title ??
          (parent?.id ? categoriesById.get(String(parent.id)) ?? null : null);
      }

      if (parentTitle && baseTitles.has(parentTitle)) {
        const items = childrenByParent.get(parentTitle) ?? [];
        items.push(category.title);
        childrenByParent.set(parentTitle, items);
      }
    });

    const baseCategories = CATEGORY_SHELL.map((category) => {
      const items = childrenByParent.get(category.title);
      return {
        title: category.title,
        items: items && items.length > 0 ? items : category.items,
      };
    });

    const extraCategories =
      categoriesData
        ?.filter((category) => {
          if (!category?.title) {
            return false;
          }
          if (baseTitles.has(category.title)) {
            return false;
          }
          return !category.parent;
        })
        .map((category) => ({
          title: category.title ?? "",
          items: [],
        })) ?? [];

    return [...baseCategories, ...extraCategories.filter((category) => category.title)];
  }, [categoriesData, categoriesById]);

  const normalizedProducts = useMemo(() => {
    return (products ?? []).map((product) => {
      const categoryTitles: string[] = [];
      const addCategoryTitle = (value?: CategoryDoc | string | null) => {
        if (!value) {
          return;
        }
        if (typeof value === "string") {
          categoryTitles.push(categoriesById.get(value) ?? value);
          return;
        }
        if (value.title) {
          categoryTitles.push(value.title);
          return;
        }
        if (value.id) {
          const title = categoriesById.get(String(value.id));
          if (title) {
            categoryTitles.push(title);
          }
        }
      };

      addCategoryTitle(product.category ?? null);
      if (Array.isArray(product.categories)) {
        product.categories.forEach((category) => addCategoryTitle(category ?? null));
      }

      const formatKey = normalizeFormat(product.format);
      const techKey = normalizeTechnology(product.technology);
      const rawModelUrl = resolveMediaUrl(product.rawModel ?? null);
      const paintedModelUrl = resolveMediaUrl(product.paintedModel ?? null);
      const priceValue = typeof product.price === "number" ? product.price : null;
      const priceLabel = formatPrice(product.price);

      return {
        id: String(product.id ?? product.name ?? ""),
        name: product.name ?? "Untitled",
        slug: product.slug ?? "",
        sku: product.sku ?? "",
        type: product.format ?? (formatKey === "digital" ? "Digital STL" : "Physical Print"),
        tech: product.technology ?? (techKey === "sla" ? "SLA" : "FDM"),
        price: priceLabel,
        priceValue,
        verified: Boolean(product.isVerified),
        isFeatured: Boolean(product.isFeatured),
        formatKey,
        techKey,
        categoryTitles,
        rawModelUrl,
        paintedModelUrl,
      };
    });
  }, [products, categoriesById]);

  const filteredProducts = useMemo(() => {
    const activeGroup = sidebarCategories.find(
      (category) => category.title === activeCategory
    );
    const activeItems = activeGroup?.items ?? [];

    return normalizedProducts.filter((product) => {
      const matchesFormat = product.formatKey === format;
      const matchesTech = product.techKey === technology;
      const hasCategoryInfo = product.categoryTitles.length > 0;
      const matchesCategory = activeCategory
        ? !hasCategoryInfo ||
          product.categoryTitles.includes(activeCategory) ||
          (activeItems.length > 0 &&
            product.categoryTitles.some((title) => activeItems.includes(title)))
        : true;
      return matchesFormat && matchesTech && matchesCategory;
    });
  }, [normalizedProducts, format, technology, activeCategory, sidebarCategories]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    normalizedProducts.forEach((product) => {
      product.categoryTitles.forEach((title) => {
        counts.set(title, (counts.get(title) ?? 0) + 1);
      });
    });
    return counts;
  }, [normalizedProducts]);

  const featuredProduct = filteredProducts.find((product) => product.isFeatured);
  const heroProduct = featuredProduct ?? filteredProducts[0] ?? null;
  const heroName = heroProduct?.name ?? "ARCHANGEL";
  const heroSku = heroProduct?.sku || heroProduct?.slug || "ARC_V4_88";
  const heroPriceLabel =
    heroProduct?.priceValue != null ? `₽${heroProduct.price}` : "N/A";
  const showHeroStandby = productsError || dataLoading || !heroProduct;
  const heroStandbyMessage = productsError
    ? "System Standby: No Data"
    : dataLoading
      ? "Loading Data..."
      : "System Standby: No Product";

  const showSystemStandby = productsError || dataLoading || filteredProducts.length === 0;
  const standbyMessage = productsError
    ? "System Standby: No Data"
    : dataLoading
      ? "Loading Data..."
      : "System Standby: No Data";

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
          <Sidebar
            format={format}
            onFormatChange={setFormat}
            technology={technology}
            onTechnologyChange={setTechnology}
            categories={sidebarCategories}
            categoryCounts={categoryCounts}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
          />
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
                  {showHeroStandby ? (
                    <SystemStandbyPanel message={heroStandbyMessage} className="h-full" />
                  ) : (
                    <ErrorBoundary
                      fallback={<SystemStandbyPanel message="3D System Standby" className="h-full" />}
                    >
                      <Experience
                        autoRotate={autoRotate}
                        wireframe={wireframe}
                        finish={finish}
                        preview={preview}
                        rawModelUrl={heroProduct?.rawModelUrl ?? null}
                        paintedModelUrl={heroProduct?.paintedModelUrl ?? null}
                      />
                    </ErrorBoundary>
                  )}
                </div>
                <div className="absolute inset-x-8 bottom-8 flex flex-wrap items-end justify-between gap-4">
                  <div className="order-1 max-w-[420px]">
                  <p className="text-sm font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/60">
                    TECH_ID: {heroSku}
                  </p>
                  <h2 className="text-4xl font-bold italic tracking-wide text-white">
                    {heroName}
                  </h2>
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <span className="text-2xl font-semibold text-white">
                      {heroPriceLabel}
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
                  <div className="order-3 w-full flex items-center justify-center gap-3 rounded-full px-4 py-2 glass-dock">
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
                  <div className="order-2 flex items-center gap-2 rounded-full bg-white/5 px-3 py-2 font-[var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-white/70">
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

              <ErrorBoundary fallback={<SystemStandbyPanel message="System Standby: No Data" />}>
                {showSystemStandby ? (
                  <SystemStandbyPanel message={standbyMessage} className="min-h-[240px]" />
                ) : (
                  <motion.div
                    variants={containerVariants}
                    className="columns-1 gap-6 md:columns-2 xl:columns-3"
                  >
                    {filteredProducts?.map((card) => (
                      <motion.article
                        key={card.id}
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
                            PRICE
                          </span>
                          <span className="text-lg font-semibold text-white">
                            {card.price}
                          </span>
                        </div>
                      </motion.article>
                    ))}
                  </motion.div>
                )}
              </ErrorBoundary>
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
  technology: TechMode;
  onTechnologyChange: (value: TechMode) => void;
  categories: SidebarCategory[];
  categoryCounts: Map<string, number>;
  activeCategory: string;
  onCategoryChange: (value: string) => void;
};

function Sidebar({
  format,
  onFormatChange,
  technology,
  onTechnologyChange,
  categories,
  categoryCounts,
  activeCategory,
  onCategoryChange,
}: SidebarProps) {
  const [verified, setVerified] = useState(true);
  const [openCategory, setOpenCategory] = useState<string>(categories[0]?.title ?? "");

  useEffect(() => {
    if (categories.length === 0) {
      if (openCategory) {
        setOpenCategory("");
      }
      return;
    }

    if (!openCategory || !categories.some((category) => category.title === openCategory)) {
      setOpenCategory(categories[0].title);
    }
  }, [categories, openCategory]);

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
            onClick={() => onTechnologyChange("sla")}
          >
            SLA смола
          </button>
          <button
            className={`rounded-full px-3 py-2 text-xs uppercase tracking-[0.2em] ${
              technology === "fdm"
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white"
            }`}
            onClick={() => onTechnologyChange("fdm")}
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
          {categories?.map((category) => {
            const isOpen = openCategory === category.title;
            return (
              <div
                key={category.title}
                className="rounded-2xl bg-white/5 px-4 py-3"
              >
                <button
                  className="flex w-full items-center justify-between text-sm font-semibold text-white/80"
                  onClick={() => {
                    const nextOpen = isOpen ? "" : category.title;
                    setOpenCategory(nextOpen);
                    onCategoryChange(nextOpen);
                  }}
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
                    {category.items?.map((item) => {
                      const count = categoryCounts.get(item) ?? 0;
                      const isActive = activeCategory === item;
                      return (
                        <button
                          key={item}
                          type="button"
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition ${
                            isActive
                              ? "bg-white/10 text-white"
                              : "bg-white/5 text-white/60 hover:text-white"
                          }`}
                          onClick={() => onCategoryChange(item)}
                        >
                          <span>{item}</span>
                          <span className="text-xs font-[var(--font-jetbrains-mono)] uppercase text-white/40">
                            [{count}]
                          </span>
                        </button>
                      );
                    })}
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
  preview: PreviewMode;
  rawModelUrl?: string | null;
  paintedModelUrl?: string | null;
};

function Experience({
  autoRotate,
  wireframe,
  finish,
  preview,
  rawModelUrl,
  paintedModelUrl,
}: ExperienceProps) {
  const isAR = preview === "ar";
  const modelFinish = finish === "pro" ? "Painted" : "Raw";
  const modelUrl = rawModelUrl ?? "/models/DamagedHelmet.glb";

  return (
    <Canvas
      camera={{ position: [2.6, 2.1, 3.1], fov: 42 }}
      dpr={[1, 2]}
      className="h-full w-full"
      gl={{ antialias: true, alpha: isAR }}
    >
      {!isAR && <color attach="background" args={["#070707"]} />}
      <Stage environment={null} intensity={1} shadows={false} adjustCamera={false}>
        <group position={[0, -0.6, 0]} scale={2}>
          <ModelView
            rawModelUrl={modelUrl}
            paintedModelUrl={paintedModelUrl}
            finish={modelFinish}
            wireframe={wireframe}
          />
        </group>
      </Stage>
      {isAR ? (
        <>
          <Grid
            position={[0, -1.4, 0]}
            cellSize={0.3}
            cellThickness={0.6}
            cellColor="#2ED1FF"
            sectionSize={1.5}
            sectionThickness={1}
            sectionColor="#2ED1FF"
            fadeDistance={12}
            fadeStrength={1}
            infiniteGrid
          />
          <Environment preset="studio" />
        </>
      ) : (
        <Environment preset="city" />
      )}
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

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

type SystemStandbyPanelProps = {
  message: string;
  className?: string;
};

function SystemStandbyPanel({ message, className }: SystemStandbyPanelProps) {
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] px-6 py-10 text-center text-xs uppercase tracking-[0.3em] text-white/60 ${className ?? ""}`}
    >
      <div className="pointer-events-none absolute inset-0 cad-grid-pattern opacity-30" />
      <div className="relative">{message}</div>
    </div>
  );
}
