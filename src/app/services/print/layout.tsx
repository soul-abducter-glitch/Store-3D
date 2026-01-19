import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Custom Print Service",
  description: "Upload a model and order 3D printing with custom options.",
};

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return children;
}
