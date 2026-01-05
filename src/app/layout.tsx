import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { RootLayout as PayloadRootLayout, handleServerFunctions } from "@payloadcms/next/layouts";
import { getPayload, type ServerFunctionClientArgs } from "payload";
import "./globals.css";

import payloadConfig from "../../payload.config";
import { importMap } from "./(payload)/admin/importMap";

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

async function serverFunction(args: ServerFunctionClientArgs) {
  "use server";
  const payload = await getPayload({ config: payloadConfig, importMap });
  return handleServerFunctions({
    ...args,
    config: Promise.resolve(payload.config),
    importMap,
  });
}

export const metadata: Metadata = {
  title: "Store-3D",
  description: "3D-STORE marketplace.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (isAdminMode) {
    const payload = await getPayload({ config: payloadConfig, importMap });

    return PayloadRootLayout({
      children,
      config: Promise.resolve(payload.config),
      importMap,
      serverFunction,
    });
  }

  return (
    <html lang="en" className="overflow-x-hidden">
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased overflow-x-hidden`}>
        {children}
      </body>
    </html>
  );
}
