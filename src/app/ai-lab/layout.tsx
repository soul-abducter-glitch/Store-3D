import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI лаборатория",
  description: "Экспериментальная AI‑лаборатория для прототипирования 3D‑идей.",
};

export default function AiLabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
