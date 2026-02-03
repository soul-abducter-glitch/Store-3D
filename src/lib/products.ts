export type Finish = "Raw" | "Painted";

const mediaBaseUrl =
  (process.env.NEXT_PUBLIC_MEDIA_BASE_URL || "").trim().replace(/\/$/, "");
const MODEL_EXTENSIONS = [".glb", ".gltf", ".stl"];
const PROXY_SAFE_EXTENSIONS = [".glb", ".stl"];

const extractFilename = (value: string) => {
  const normalized = value.split("?")[0] ?? value;
  const parts = normalized.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "";
};

const isModelUrl = (value: string) =>
  MODEL_EXTENSIONS.some((ext) => value.toLowerCase().endsWith(ext));

const isProxySafeModel = (value: string) =>
  PROXY_SAFE_EXTENSIONS.some((ext) => value.toLowerCase().endsWith(ext));

const shouldProxyExternal = (value: string) => {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return false;
  }
  const lower = value.toLowerCase();
  return (
    lower.includes("/media/") ||
    lower.includes("backblazeb2.com") ||
    lower.includes("tebi.io") ||
    lower.includes("amazonaws.com") ||
    lower.includes("digitaloceanspaces.com")
  );
};

export const resolveAssetUrl = (url?: string | null) => {
  if (!url) {
    return null;
  }

  if (
    url.startsWith("blob:") ||
    url.startsWith("data:") ||
    url.startsWith("file:")
  ) {
    return url;
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    if (isModelUrl(url) && isProxySafeModel(url) && shouldProxyExternal(url)) {
      const filename = extractFilename(url);
      if (filename) {
        return `/api/media-file/${encodeURIComponent(filename)}`;
      }
    }
    return url;
  }

  if (url.startsWith("/")) {
    return url;
  }

  if (mediaBaseUrl) {
    const fullUrl = `${mediaBaseUrl}/${url}`;
    if (isModelUrl(fullUrl) && isProxySafeModel(fullUrl) && shouldProxyExternal(fullUrl)) {
      const filename = extractFilename(url);
      if (filename) {
        return `/api/media-file/${encodeURIComponent(filename)}`;
      }
    }
    return fullUrl;
  }

  const fallbackName = extractFilename(url);
  return `/api/media-file/${encodeURIComponent(fallbackName || url)}`;
};
