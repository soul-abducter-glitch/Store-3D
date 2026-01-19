import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Favorites",
  description: "Your saved 3D models and collections.",
};

export default function FavoritesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
