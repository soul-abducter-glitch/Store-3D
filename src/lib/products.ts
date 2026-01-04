export type Finish = "Raw" | "Painted";

export const resolveAssetUrl = (url?: string | null) => {
  if (!url) {
    return null;
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  if (url.startsWith("/")) {
    return url;
  }

  return `/${url}`;
};
