import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile",
  description: "Account details, orders, and settings.",
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
