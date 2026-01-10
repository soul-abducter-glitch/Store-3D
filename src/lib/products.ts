export type Finish = "Raw" | "Painted";

const mediaBaseUrl =
  (process.env.NEXT_PUBLIC_MEDIA_BASE_URL || "").trim().replace(/\/$/, "");

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

  if (mediaBaseUrl) {
    return `${mediaBaseUrl}/${url}`;
  }

  return `/api/media-file/${encodeURIComponent(url)}`;
};
