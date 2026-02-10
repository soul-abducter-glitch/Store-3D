import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { RootLayout as PayloadRootLayout, handleServerFunctions } from "@payloadcms/next/layouts";
import type { ServerFunctionClientArgs } from "payload";
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

const isAdminMode =
  process.env.NEXT_PUBLIC_MODE === "admin" ||
  process.env.PORT === "3001" ||
  (process.env.NEXT_PUBLIC_SERVER_URL || "").includes("3001");

const loadPayloadContext = async () => {
  const [{ getPayload }, payloadConfigModule, importMapModule] = await Promise.all([
    import("payload"),
    import("../../payload.config"),
    import("./(payload)/admin/importMap"),
  ]);

  return {
    getPayload,
    payloadConfig: payloadConfigModule.default,
    importMap: importMapModule.importMap,
  };
};

async function serverFunction(args: ServerFunctionClientArgs) {
  "use server";
  const { getPayload, payloadConfig, importMap } = await loadPayloadContext();
  const payload = await getPayload({ config: payloadConfig, importMap });
  return handleServerFunctions({
    ...args,
    config: Promise.resolve(payload.config),
    importMap,
  });
}

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (isAdminMode) {
    const { getPayload, payloadConfig, importMap } = await loadPayloadContext();
    const payload = await getPayload({ config: payloadConfig, importMap });

    return PayloadRootLayout({
      children,
      config: Promise.resolve(payload.config),
      importMap,
      serverFunction,
    });
  }

  return (
    <html lang="ru" className="overflow-x-hidden">
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased overflow-x-hidden`}>
        <ClientNotifications />
        {children}
      </body>
    </html>
  );
}
