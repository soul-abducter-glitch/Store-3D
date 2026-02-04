import type { Metadata } from "next";

const siteUrl =
  (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Каталог",
  description: "Каталог 3D‑моделей и печати на заказ.",
  alternates: {
    canonical: "/store",
  },
  openGraph: {
    title: "Каталог · 3D-STORE",
    description: "Каталог 3D‑моделей и печати на заказ.",
    url: `${siteUrl}/store`,
    siteName: "3D-STORE",
    locale: "ru_RU",
    type: "website",
    images: [
      {
        url: "/backgrounds/bg_lab.png",
        width: 1200,
        height: 630,
        alt: "3D-STORE",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Каталог · 3D-STORE",
    description: "Каталог 3D‑моделей и печати на заказ.",
    images: ["/backgrounds/bg_lab.png"],
  },
};

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
