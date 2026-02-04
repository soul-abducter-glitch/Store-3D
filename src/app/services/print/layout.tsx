import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Печать на заказ",
  description: "Загрузите модель и оформите заказ на 3D‑печать.",
};

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return children;
}
