import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Lab",
  description: "AI lab for previewing and generating 3D concepts.",
};

export default function AiLabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
