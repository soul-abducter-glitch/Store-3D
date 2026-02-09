import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse, type NextRequest } from "next/server";
import { Readable } from "stream";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MediaDoc = {
  id?: string | number;
  url?: string;
  filename?: string;
  mimeType?: string;
  value?: unknown;
  _id?: unknown;
};

type ProductDoc = {
  id?: string | number;
  slug?: string;
  name?: string;
  rawModel?: MediaDoc | string | number | null;
  paintedModel?: MediaDoc | string | number | null;
  value?: unknown;
  _id?: unknown;
};

type UserDoc = {
  id?: string | number;
  purchasedProducts?: Array<ProductDoc | string | number | null> | null;
};

type StorageTarget = {
  bucket: string;
  client: S3Client;
};

type DownloadAttempt = {
  response: Response | null;
  hadUnexpectedError: boolean;
};

const publicBucket = process.env.S3_PUBLIC_BUCKET || process.env.S3_BUCKET;
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT;
const publicAccessKeyId =
  process.env.S3_PUBLIC_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
const publicSecretAccessKey =
  process.env.S3_PUBLIC_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
const publicRegion = process.env.S3_PUBLIC_REGION || process.env.S3_REGION || "us-east-1";
const uploadBucket = process.env.S3_UPLOAD_BUCKET || process.env.S3_BUCKET;
const uploadEndpoint = process.env.S3_UPLOAD_ENDPOINT || process.env.S3_ENDPOINT;
const uploadAccessKeyId = process.env.S3_UPLOAD_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
const uploadSecretAccessKey =
  process.env.S3_UPLOAD_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
const uploadRegion = process.env.S3_UPLOAD_REGION || process.env.S3_REGION || "us-east-1";
const storagePrefix = "media";
const mediaProxyPrefix = "api/media-file/";

const buildS3Client = (
  endpoint: string | undefined,
  accessKeyId: string | undefined,
  secretAccessKey: string | undefined,
  region: string
) =>
  endpoint && accessKeyId && secretAccessKey
    ? new S3Client({
        region,
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      })
    : null;

const publicClient = buildS3Client(
  publicEndpoint,
  publicAccessKeyId,
  publicSecretAccessKey,
  publicRegion
);

const uploadClient = buildS3Client(
  uploadEndpoint,
  uploadAccessKeyId,
  uploadSecretAccessKey,
  uploadRegion
);

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const collectStorageTargets = () => {
  const targets: StorageTarget[] = [];
  if (publicBucket && publicClient) {
    targets.push({ bucket: publicBucket, client: publicClient });
  }
  if (uploadBucket && uploadClient && !targets.some((target) => target.bucket === uploadBucket)) {
    targets.push({ bucket: uploadBucket, client: uploadClient });
  }
  return targets;
};

const storageTargets = collectStorageTargets();

const guessContentType = (filename: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".stl")) return "model/stl";
  if (lower.endsWith(".obj")) return "model/obj";
  return "application/octet-stream";
};

const toWebStream = (body: any) => {
  if (!body) return null;
  if (body instanceof Readable) {
    return Readable.toWeb(body);
  }
  return body;
};

const resolveAbsoluteUrl = (value: string, request: NextRequest) => {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const siteUrl = (
    process.env.NEXT_PUBLIC_SERVER_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    request.nextUrl.origin ||
    "http://localhost:3000"
  )
    .trim()
    .replace(/\/$/, "");
  return `${siteUrl}${value.startsWith("/") ? value : `/${value}`}`;
};

const normalizeId = (value: unknown) => String(value ?? "").trim();

const normalizeRelationshipId = (value: unknown): string | number | null => {
  let current: unknown = value;
  while (typeof current === "object" && current !== null) {
    current =
      (current as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (current as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (current as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
  }
  if (current === null || current === undefined) return null;
  if (typeof current === "number") return current;
  const raw = String(current).trim();
  if (!raw) return null;
  const base = raw.split(":")[0]?.trim() ?? "";
  if (!base || /\s/.test(base)) return null;
  if (/^\d+$/.test(base)) return Number(base);
  return base;
};

const getRelationshipId = (value: unknown) => normalizeRelationshipId(value);

const normalizeStoragePath = (value: string) =>
  value
    .split("?")[0]
    .split("#")[0]
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();

const stripBucketPrefix = (value: string) => {
  if (publicBucket && value.startsWith(`${publicBucket}/`)) {
    return value.slice(publicBucket.length + 1);
  }
  if (uploadBucket && value.startsWith(`${uploadBucket}/`)) {
    return value.slice(uploadBucket.length + 1);
  }
  return value;
};

const unwrapMediaProxyPath = (value: string) =>
  value.startsWith(mediaProxyPrefix)
    ? value.slice(mediaProxyPrefix.length)
    : value;

const extractStorageKey = (value?: string | null) => {
  if (!value) return null;
  const source = /^https?:\/\//i.test(value)
    ? (() => {
        try {
          return new URL(value).pathname;
        } catch {
          return "";
        }
      })()
    : value;

  const normalized = unwrapMediaProxyPath(
    stripBucketPrefix(normalizeStoragePath(source))
  );
  return normalized || null;
};

const pushStorageCandidate = (set: Set<string>, value?: string | null) => {
  if (!value) return;
  const normalized = stripBucketPrefix(normalizeStoragePath(value));
  if (!normalized) return;

  set.add(normalized);
  const baseName = normalized.split("/").pop() || "";
  if (baseName) {
    set.add(baseName);
  }
  if (storagePrefix && !normalized.startsWith(`${storagePrefix}/`)) {
    set.add(`${storagePrefix}/${normalized}`);
  }
  if (storagePrefix && baseName) {
    set.add(`${storagePrefix}/${baseName}`);
  }
};

const buildStorageKeyCandidates = (media: MediaDoc, fallbackName: string) => {
  const candidates = new Set<string>();
  pushStorageCandidate(candidates, media.filename);
  pushStorageCandidate(candidates, extractStorageKey(media.url));
  pushStorageCandidate(candidates, fallbackName);
  if (!candidates.size) {
    pushStorageCandidate(candidates, `${storagePrefix}/${fallbackName}`);
  }
  return Array.from(candidates);
};

const pushProxyCandidate = (set: Set<string>, value?: string | null) => {
  if (!value) return;
  const normalized = normalizeStoragePath(value);
  if (!normalized) return;

  set.add(normalized);
  const baseName = normalized.split("/").pop() || "";
  if (baseName) {
    set.add(baseName);
  }
};

const buildProxyCandidates = (media: MediaDoc, fallbackName: string, keys: string[]) => {
  const candidates = new Set<string>();
  pushProxyCandidate(candidates, media.filename);
  pushProxyCandidate(candidates, extractStorageKey(media.url));
  pushProxyCandidate(candidates, fallbackName);
  keys.forEach((key) => pushProxyCandidate(candidates, key));
  return Array.from(candidates);
};

const resolveFilename = (media: MediaDoc, product: ProductDoc, target: string) => {
  const fileNameFromMedia = normalizeStoragePath(media.filename || "").split("/").pop();
  const fileNameFromUrl = normalizeStoragePath(extractStorageKey(media.url) || "").split("/").pop();
  return fileNameFromMedia || fileNameFromUrl || `${product.slug || product.id || target}.stl`;
};

const hasDownloadModel = (product?: ProductDoc | null) =>
  Boolean(product?.rawModel || product?.paintedModel);

const buildAttachmentResponse = (
  body: BodyInit | null,
  filename: string,
  contentType?: string | null,
  contentLength?: string | null
) => {
  if (!body) return null;
  const headers = new Headers();
  headers.set("Content-Type", contentType || guessContentType(filename));
  headers.set(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(filename)}"`
  );
  headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }
  return new Response(body, { headers });
};

const fetchAsAttachment = async (
  request: NextRequest,
  pathOrUrl: string,
  filename: string
) => {
  const cookie = request.headers.get("cookie") || "";
  const response = await fetch(resolveAbsoluteUrl(pathOrUrl, request), {
    headers: cookie ? { cookie } : undefined,
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    return null;
  }
  return buildAttachmentResponse(
    response.body,
    filename,
    response.headers.get("content-type"),
    response.headers.get("content-length")
  );
};

const isStorageNotFound = (error: any) =>
  error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;

const tryDownloadFromStorage = async (
  media: MediaDoc,
  filename: string,
  keyCandidates: string[]
): Promise<DownloadAttempt> => {
  let hadUnexpectedError = false;
  for (const storage of storageTargets) {
    for (const key of keyCandidates) {
      try {
        const result = await storage.client.send(
          new GetObjectCommand({
            Bucket: storage.bucket,
            Key: key,
          })
        );
        if (!result.Body) {
          continue;
        }
        const response = buildAttachmentResponse(
          toWebStream(result.Body),
          filename,
          media.mimeType || result.ContentType || guessContentType(filename),
          typeof result.ContentLength === "number" ? String(result.ContentLength) : null
        );
        if (response) {
          return { response, hadUnexpectedError };
        }
      } catch (error: any) {
        if (!isStorageNotFound(error)) {
          hadUnexpectedError = true;
        }
      }
    }
  }
  return { response: null, hadUnexpectedError };
};

const resolveMediaDoc = async (payload: any, value?: MediaDoc | string | number | null) => {
  const relationId = getRelationshipId(value);
  if (typeof value === "object" && value && !relationId) {
    const typed = value as MediaDoc;
    if (typed.filename || typed.url || typed.mimeType) {
      return typed;
    }
    return null;
  }
  if (typeof value === "object" && value) {
    const typed = value as MediaDoc;
    if (typed.filename || typed.url || typed.mimeType) {
      return typed;
    }
  }
  if (!relationId) {
    return null;
  }
  try {
    return (await payload.findByID({
      collection: "media",
      id: relationId,
      depth: 0,
      overrideAccess: true,
    })) as MediaDoc;
  } catch {
    return null;
  }
};

const fetchUser = async (payload: any, request: NextRequest) => {
  try {
    const authResult = await payload.auth({ headers: request.headers });
    const relationId = normalizeRelationshipId(authResult?.user?.id);
    if (!relationId) return null;
    return (await payload.findByID({
      collection: "users",
      id: relationId,
      depth: 2,
      overrideAccess: true,
    })) as UserDoc;
  } catch {
    return null;
  }
};

const pickPurchasedProduct = (
  products: Array<ProductDoc | string | number | null>,
  target: string
) => {
  for (const entry of products) {
    if (!entry) continue;
    if (typeof entry === "string" || typeof entry === "number") {
      if (normalizeId(entry) === target) {
        return entry;
      }
      continue;
    }
    if (
      normalizeId(entry.id) === target ||
      normalizeId(entry.value) === target ||
      normalizeId(entry._id) === target ||
      entry.slug === target
    ) {
      return entry;
    }
  }
  return null;
};

const extractEntryId = (entry: ProductDoc | string | number | null) =>
  normalizeId(getRelationshipId(entry));

const fetchProductByIdOrSlug = async (payload: any, target: string) => {
  if (!target) return null;
  const where: { or: Array<Record<string, { equals: string | number }>> } = {
    or: [{ slug: { equals: target } }, { id: { equals: target } }],
  };
  if (/^\d+$/.test(target)) {
    where.or.unshift({ id: { equals: Number(target) } });
  }
  const result = await payload.find({
    collection: "products",
    depth: 2,
    limit: 1,
    overrideAccess: true,
    where,
  });
  return (result?.docs?.[0] ?? null) as ProductDoc | null;
};

const resolveProduct = async (
  payload: any,
  target: string,
  purchasedEntry: ProductDoc | string | number
) => {
  let product = typeof purchasedEntry === "object" ? (purchasedEntry as ProductDoc) : null;
  const candidates = Array.from(
    new Set(
      [
        target,
        extractEntryId(purchasedEntry),
        normalizeId(product?.id ?? product?.value ?? product?._id),
        product?.slug,
      ]
        .map((value) => normalizeId(value))
        .filter(Boolean)
    )
  );

  if (!hasDownloadModel(product)) {
    for (const candidate of candidates) {
      const fetched = await fetchProductByIdOrSlug(payload, candidate);
      if (!fetched) continue;
      product = fetched;
      if (hasDownloadModel(fetched)) {
        break;
      }
    }
  }

  if (!product) {
    return null;
  }

  if (!hasDownloadModel(product)) {
    const fallbackId =
      normalizeId(product.id ?? product.value ?? product._id) || product.slug || target;
    const refreshed = await fetchProductByIdOrSlug(payload, fallbackId);
    if (refreshed) {
      product = refreshed;
    }
  }

  return product;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolvedParams = await params;
  const target = normalizeId(resolvedParams?.productId);
  if (!target) {
    return NextResponse.json({ error: "Missing product id." }, { status: 400 });
  }

  const payload = await getPayloadClient();
  const user = await fetchUser(payload, request);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const purchasedProducts = Array.isArray(user?.purchasedProducts)
    ? user.purchasedProducts
    : [];
  const purchasedEntry = pickPurchasedProduct(purchasedProducts, target);
  if (!purchasedEntry) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  const product = await resolveProduct(payload, target, purchasedEntry);
  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  const media =
    (await resolveMediaDoc(payload, product.rawModel)) ??
    (await resolveMediaDoc(payload, product.paintedModel));
  if (!media?.filename && !media?.url) {
    return NextResponse.json({ error: "File not available." }, { status: 404 });
  }

  const resolvedFilename = resolveFilename(media, product, target);
  const keyCandidates = buildStorageKeyCandidates(media, resolvedFilename);
  const { response: storageResponse, hadUnexpectedError } = await tryDownloadFromStorage(
    media,
    resolvedFilename,
    keyCandidates
  );
  if (storageResponse) {
    return storageResponse;
  }

  if (media.url) {
    const proxiedRemote = await fetchAsAttachment(request, media.url, resolvedFilename);
    if (proxiedRemote) {
      return proxiedRemote;
    }
  }

  const proxyCandidates = buildProxyCandidates(media, resolvedFilename, keyCandidates);
  for (const candidate of proxyCandidates) {
    const proxiedInternal = await fetchAsAttachment(
      request,
      `/api/media-file/${encodeURIComponent(candidate)}`,
      resolvedFilename
    );
    if (proxiedInternal) {
      return proxiedInternal;
    }
  }

  if (!storageTargets.length) {
    return NextResponse.json({ error: "Storage is not configured." }, { status: 500 });
  }

  return NextResponse.json(
    { error: hadUnexpectedError ? "Failed to download file." : "File not found." },
    { status: hadUnexpectedError ? 500 : 404 }
  );
}

