"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type FavoriteItem = {
  id: string;
  name: string;
  slug: string;
  priceLabel: string;
  priceValue: number | null;
  thumbnailUrl: string;
  tech: string;
  formatLabel: string;
  formatKey: "digital" | "physical" | null;
};

const STORAGE_KEY = "store3d_favorites";

const normalizeFavorite = (item: any): FavoriteItem | null => {
  if (!item || typeof item !== "object") {
    return null;
  }

  const id = typeof item.id === "string" ? item.id : null;
  if (!id) {
    return null;
  }

  const name = typeof item.name === "string" ? item.name : "Untitled";
  const slug = typeof item.slug === "string" ? item.slug : "";
  const priceLabel = typeof item.priceLabel === "string" ? item.priceLabel : "N/A";
  const priceValue = typeof item.priceValue === "number" ? item.priceValue : null;
  const thumbnailUrl = typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : "";
  const tech = typeof item.tech === "string" ? item.tech : "";
  const formatLabel = typeof item.formatLabel === "string" ? item.formatLabel : "MODEL";
  const formatKey =
    item.formatKey === "physical" ? "physical" : item.formatKey === "digital" ? "digital" : null;

  return {
    id,
    name,
    slug,
    priceLabel,
    priceValue,
    thumbnailUrl,
    tech,
    formatLabel,
    formatKey,
  };
};

const readFavorites = (): FavoriteItem[] => {
  if (typeof window === "undefined") {
    return [];
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return [];
  }
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => normalizeFavorite(item))
      .filter((item): item is FavoriteItem => Boolean(item));
  } catch {
    return [];
  }
};

const writeFavorites = (favorites: FavoriteItem[]) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  window.dispatchEvent(new Event("favorites-updated"));
};

export const useFavorites = () => {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    setFavorites(readFavorites());
    const handleUpdate = () => setFavorites(readFavorites());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setFavorites(readFavorites());
      }
    };
    window.addEventListener("favorites-updated", handleUpdate);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("favorites-updated", handleUpdate);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.id)), [favorites]);

  const toggleFavorite = useCallback((item: FavoriteItem) => {
    setFavorites((prev) => {
      const exists = prev.some((favorite) => favorite.id === item.id);
      const next = exists
        ? prev.filter((favorite) => favorite.id !== item.id)
        : [item, ...prev];
      writeFavorites(next);
      return next;
    });
  }, []);

  const removeFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.filter((favorite) => favorite.id !== id);
      writeFavorites(next);
      return next;
    });
  }, []);

  return {
    favorites,
    favoriteIds,
    toggleFavorite,
    removeFavorite,
  };
};
