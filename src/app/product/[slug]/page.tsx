import type { Metadata } from "next";
import { notFound } from "next/navigation";

type MediaDoc = {
  url?: string;
  filename?: string;
};

type ProductDoc = {
  id?: string | number;
  name?: string;
  slug?: string;
  sku?: string;
  price?: number;
  format?: string;
  technology?: string;
  description?: unknown;
  thumbnail?: MediaDoc | string | null;
};

type ProductResponse = {
  docs?: ProductDoc[];
};

type CatalogProduct = {
  id?: string | number;
  name?: string;
  slug?: string;
  price?: number;
  format?: string;
  technology?: string;
  isFeatured?: boolean;
  thumbnail?: MediaDoc | string | null;
};

type CatalogResponse = {
  products?: CatalogProduct[];
};

const siteUrl =
  (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
const apiBase =
  (process.env.NEXT_PUBLIC_SERVER_URL || process.env.NEXT_PUBLIC_SITE_URL || siteUrl).replace(
    /\/$/,
    ""
  );

const isImageUrl = (value: string) => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(value);

const resolveImageUrl = (value?: MediaDoc | string | null) => {
  if (!value) return null;
  if (typeof value === "string") {
    return isImageUrl(value) ? value : null;
  }
  if (value.url && isImageUrl(value.url)) {
    return value.url;
  }
  if (value.filename && isImageUrl(value.filename)) {
    return `/media/${value.filename}`;
  }
  return null;
};

const normalizeFormatKey = (value?: string) => {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("digital")) return "digital";
  if (normalized.includes("physical")) return "physical";
  return "";
};

const normalizeTechKey = (value?: string) => {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("sla") || normalized.includes("resin")) return "sla";
  if (normalized.includes("fdm") || normalized.includes("plastic")) return "fdm";
  return "";
};

const formatPriceValue = (value?: number) => {
  if (typeof value !== "number") return null;
  return new Intl.NumberFormat("ru-RU").format(value);
};

const clampDescription = (value: string, maxLength = 160) => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
};

const buildSeoDescription = (product: ProductDoc) => {
  const base = richTextToPlain(product.description).trim();
  if (base) {
    return clampDescription(base);
  }

  const title = product.name ?? "3D‑модель";
  const format = product.format ?? "Цифровой STL";
  const tech = product.technology ? `, технология: ${product.technology}` : "";
  const price = typeof product.price === "number" ? ` Цена: ₽${product.price}.` : "";
  const fallback = `${title} — ${format}${tech}.${price}`.trim();
  return clampDescription(fallback);
};

const richTextToPlain = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => richTextToPlain(entry)).join(" ");
  }
  if (typeof value === "object") {
    const asAny = value as { text?: string; children?: unknown[]; root?: { children?: unknown[] } };
    if (asAny.text) return asAny.text;
    if (Array.isArray(asAny.children)) {
      return asAny.children.map((entry) => richTextToPlain(entry)).join(" ");
    }
    if (asAny.root && Array.isArray(asAny.root.children)) {
      return asAny.root.children.map((entry) => richTextToPlain(entry)).join(" ");
    }
  }
  return "";
};

const fetchProduct = async (slug: string): Promise<ProductDoc | null> => {
  try {
    const res = await fetch(
      `${apiBase}/api/products?depth=2&limit=1&where[slug][equals]=${encodeURIComponent(slug)}`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as ProductResponse;
    return data?.docs?.[0] ?? null;
  } catch {
    return null;
  }
};

const fetchCatalog = async (): Promise<CatalogProduct[]> => {
  try {
    const res = await fetch(`${apiBase}/api/catalog`, { next: { revalidate: 300 } });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as CatalogResponse;
    return Array.isArray(data?.products) ? data.products : [];
  } catch {
    return [];
  }
};

const selectRelatedProducts = (product: ProductDoc, catalog: CatalogProduct[]) => {
  const formatKey = normalizeFormatKey(product.format);
  const techKey = normalizeTechKey(product.technology);
  const currentSlug = product.slug ?? "";

  const scored = catalog
    .filter((item) => item?.slug && item.slug !== currentSlug)
    .map((item) => {
      let score = 0;
      if (formatKey && normalizeFormatKey(item.format) === formatKey) score += 2;
      if (techKey && normalizeTechKey(item.technology) === techKey) score += 1;
      if (item.isFeatured) score += 1;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);

  return scored.slice(0, 4);
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const resolvedParams = await params;
  const product = await fetchProduct(resolvedParams.slug);
  if (!product) {
    return {
      title: "Product not found",
      description: "Requested product is not available.",
      robots: { index: false, follow: false },
    };
  }

  const title = product.name ?? "3D-STORE";
  const description = buildSeoDescription(product);
  const imageUrl = resolveImageUrl(product.thumbnail) ?? "/backgrounds/bg_lab.png";
  const canonical = `/product/${product.slug ?? resolvedParams.slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: `${siteUrl}${canonical}`,
      type: "website",
      images: [{ url: imageUrl }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = await params;
  const product = await fetchProduct(resolvedParams.slug);
  if (!product) {
    notFound();
  }

  const catalog = await fetchCatalog();
  const relatedProducts = selectRelatedProducts(product, catalog).filter(
    (item): item is CatalogProduct & { slug: string } => Boolean(item.slug)
  );
  const description = richTextToPlain(product.description).trim();
  const imageUrl = resolveImageUrl(product.thumbnail);
  const priceLabel = formatPriceValue(product.price);
  const productUrl = `${siteUrl}/product/${product.slug ?? resolvedParams.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name ?? "3D Model",
    sku: product.sku,
    image: imageUrl ? [imageUrl] : undefined,
    description: description || undefined,
    brand: {
      "@type": "Brand",
      name: "3D-STORE",
    },
    offers: {
      "@type": "Offer",
      priceCurrency: "RUB",
      price: typeof product.price === "number" ? product.price : undefined,
      availability: "https://schema.org/InStock",
      url: productUrl,
    },
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-16 pt-24 sm:px-6 sm:pt-28">
        <div className="space-y-2">
          <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/40">
            {product.sku || product.slug}
          </p>
          <h1 className="text-2xl font-semibold text-white sm:text-3xl">{product.name}</h1>
          {priceLabel && (
            <p className="text-lg font-semibold text-[#2ED1FF] sm:text-xl">{`₽${priceLabel}`}</p>
          )}
          <p className="text-sm text-white/60">
            {product.technology || "3D Technology"} · {product.format || "Digital STL"}
          </p>
        </div>
        {imageUrl && (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
            <img
              src={imageUrl}
              alt={product.name ?? "3D model"}
              loading="eager"
              decoding="async"
              fetchPriority="high"
              className="w-full object-cover"
            />
          </div>
        )}
        {description && <p className="text-base leading-relaxed text-white/70">{description}</p>}
        {relatedProducts.length > 0 && (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/40">
                Похожие модели
              </p>
              <h2 className="text-lg font-semibold text-white">Рекомендации по теме</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {relatedProducts.map((item) => {
                const relatedImage = resolveImageUrl(item.thumbnail);
                const relatedPrice = formatPriceValue(item.price);
                const relatedMeta = [item.technology, item.format]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <a
                    key={item.slug ?? item.id}
                    href={`/product/${item.slug}`}
                    className="group rounded-2xl border border-white/10 bg-white/5 p-3 transition hover:border-[#2ED1FF]/50 hover:bg-white/10"
                  >
                    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
                      {relatedImage ? (
                        <img
                          src={relatedImage}
                          alt={item.name ?? "3D model"}
                          loading="lazy"
                          decoding="async"
                          className="h-40 w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-40 items-center justify-center bg-[#0b0f12] text-xs uppercase tracking-[0.3em] text-white/40">
                          NO IMAGE
                        </div>
                      )}
                    </div>
                    <div className="mt-3 space-y-1">
                      <p className="text-sm font-semibold text-white">{item.name}</p>
                      {relatedMeta && (
                        <p className="text-[11px] text-white/50">{relatedMeta}</p>
                      )}
                      {relatedPrice && (
                        <p className="text-sm font-semibold text-[#2ED1FF]">{`₽${relatedPrice}`}</p>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
