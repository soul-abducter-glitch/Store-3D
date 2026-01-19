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

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const product = await fetchProduct(params.slug);
  if (!product) {
    return {
      title: "Product not found",
      description: "Requested product is not available.",
      robots: { index: false, follow: false },
    };
  }

  const title = product.name ?? "3D-STORE";
  const description =
    richTextToPlain(product.description).trim() ||
    "3D model available in the 3D-STORE marketplace.";
  const imageUrl = resolveImageUrl(product.thumbnail) ?? "/backgrounds/bg_lab.png";
  const canonical = `/product/${product.slug ?? params.slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: `${siteUrl}${canonical}`,
      type: "product",
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

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const product = await fetchProduct(params.slug);
  if (!product) {
    notFound();
  }

  const description = richTextToPlain(product.description).trim();
  const imageUrl = resolveImageUrl(product.thumbnail);
  const priceLabel =
    typeof product.price === "number"
      ? new Intl.NumberFormat("ru-RU").format(product.price)
      : null;
  const productUrl = `${siteUrl}/product/${product.slug ?? params.slug}`;
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
            <img src={imageUrl} alt={product.name ?? "3D model"} className="w-full object-cover" />
          </div>
        )}
        {description && <p className="text-base leading-relaxed text-white/70">{description}</p>}
      </div>
    </main>
  );
}
