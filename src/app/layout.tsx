import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

import ClientNotifications from "@/components/ClientNotifications";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

const sanitizeUrlInput = (value: string) =>
  value.trim().replace(/^['"]+|['"]+$/g, "");

const resolveSiteUrl = () => {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";
  const cleaned = sanitizeUrlInput(raw);
  const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

  try {
    const url = new URL(withProtocol);
    return url.origin.replace(/\/$/, "");
  } catch {
    return "http://localhost:3000";
  }
};

const siteUrl = resolveSiteUrl();
const metadataBase = (() => {
  try {
    return new URL(siteUrl);
  } catch {
    return undefined;
  }
})();

export const metadata: Metadata = {
  ...(metadataBase ? { metadataBase } : {}),
  title: {
    default: "3D-STORE",
    template: "%s · 3D-STORE",
  },
  description: "Маркетплейс 3D-моделей и печати на заказ.",
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    title: "3D-STORE",
    description: "Маркетплейс 3D-моделей и печати на заказ.",
    url: siteUrl,
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
    title: "3D-STORE",
    description: "Маркетплейс 3D-моделей и печати на заказ.",
    images: ["/backgrounds/bg_lab.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="overflow-x-hidden">
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased overflow-x-hidden`}>
        <ClientNotifications />
        {children}
      </body>
    </html>
  );
}
