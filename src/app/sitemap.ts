import type { MetadataRoute } from "next";

const siteUrl =
  (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
const apiBase =
  (process.env.NEXT_PUBLIC_SERVER_URL || process.env.NEXT_PUBLIC_SITE_URL || siteUrl).replace(
    /\/$/,
    ""
  );

const routes = ["", "/ai-lab", "/services/print", "/favorites", "/checkout", "/profile"];

type ProductListResponse = {
  docs?: Array<{ slug?: string | null }>;
};

const fetchProductSlugs = async () => {
  try {
    const res = await fetch(`${apiBase}/api/products?depth=0&limit=2000`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as ProductListResponse;
    return (data?.docs ?? [])
      .map((doc) => doc.slug)
      .filter((slug): slug is string => Boolean(slug && slug.trim()));
  } catch {
    return [];
  }
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const productSlugs = await fetchProductSlugs();
  const productRoutes = productSlugs.map((slug) => `/product/${slug}`);
  return [...routes, ...productRoutes].map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified,
  }));
}
