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
const prefix = "media";

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
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const candidate =
      (value as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (value as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (value as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
    return normalizeRelationshipId(candidate);
  }
  if (typeof value === "number") return value;
  const raw = String(value).trim();
  if (!raw) return null;
  const base = raw.split(":")[0]?.trim() ?? "";
  if (!base || /\s/.test(base)) return null;
  if (/^\d+$/.test(base)) return Number(base);
  return base;
};

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

const extractKeyFromUrl = (value?: string | null) => {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    const normalized = stripBucketPrefix(normalizeStoragePath(value));
    if (!normalized) return null;
    if (normalized.startsWith("api/media-file/")) {
      return normalized.slice("api/media-file/".length);
    }
    return normalized;
  }
  try {
    const parsed = new URL(value);
    const normalized = stripBucketPrefix(normalizeStoragePath(parsed.pathname));
    if (!normalized) return null;
    if (normalized.startsWith("api/media-file/")) {
      return normalized.slice("api/media-file/".length);
    }
    return normalized;
  } catch {
    return null;
  }
};

const collectStorageTargets = () => {
  const targets: StorageTarget[] = [];
  if (publicBucket && publicClient) {
    targets.push({ bucket: publicBucket, client: publicClient });
  }
  if (uploadBucket && uploadClient) {
    const duplicate = targets.some((target) => target.bucket === uploadBucket);
    if (!duplicate) {
      targets.push({ bucket: uploadBucket, client: uploadClient });
    }
  }
  return targets;
};

const buildKeyCandidates = (media: MediaDoc, fallbackName: string) => {
  const candidates = new Set<string>();
  const push = (value?: string | null) => {
    if (!value) return;
    const normalized = stripBucketPrefix(normalizeStoragePath(value));
    if (!normalized) return;
    candidates.add(normalized);

    const baseName = normalized.split("/").pop() || "";
    if (baseName) {
      candidates.add(baseName);
    }
    if (prefix && !normalized.startsWith(`${prefix}/`)) {
      candidates.add(`${prefix}/${normalized}`);
    }
    if (prefix && baseName && !baseName.startsWith(`${prefix}/`)) {
      candidates.add(`${prefix}/${baseName}`);
    }
  };

  push(media.filename);
  push(extractKeyFromUrl(media.url));
  push(fallbackName);

  if (!candidates.size) {
    push(`${prefix}/${fallbackName}`);
  }
  return Array.from(candidates);
};

const buildProxyCandidates = (media: MediaDoc, fallbackName: string, keys: string[]) => {
  const candidates = new Set<string>();
  const push = (value?: string | null) => {
    if (!value) return;
    const normalized = normalizeStoragePath(value);
    if (!normalized) return;
    candidates.add(normalized);
    const baseName = normalized.split("/").pop() || "";
    if (baseName) {
      candidates.add(baseName);
    }
  };

  push(media.filename);
  push(extractKeyFromUrl(media.url));
  push(fallbackName);
  keys.forEach((key) => push(key));
  return Array.from(candidates);
};

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

const resolveMediaDoc = async (payload: any, value?: MediaDoc | string | number | null) => {
  if (!value) return null;
  if (typeof value === "object") {
    const typed = value as MediaDoc;
    if (typed.filename || typed.url || typed.mimeType) {
      return typed;
    }
    const relationId = normalizeRelationshipId(typed.id ?? typed.value ?? typed._id);
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
  }
  const relationId = normalizeRelationshipId(value);
  if (!relationId) return null;
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

const streamRemoteFile = async (
  remoteUrl: string,
  request: NextRequest,
  fallbackFilename: string
) => {
  const cookie = request.headers.get("cookie") || "";
  const response = await fetch(resolveAbsoluteUrl(remoteUrl, request), {
    headers: cookie ? { cookie } : undefined,
    cache: "no-store",
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    return null;
  }

  return buildAttachmentResponse(
    response.body,
    fallbackFilename,
    response.headers.get("content-type"),
    response.headers.get("content-length")
  );
};

const streamFromMediaProxy = async (
  candidate: string,
  request: NextRequest,
  fallbackFilename: string
) => {
  const cookie = request.headers.get("cookie") || "";
  const path = `/api/media-file/${encodeURIComponent(candidate)}`;
  const response = await fetch(resolveAbsoluteUrl(path, request), {
    headers: cookie ? { cookie } : undefined,
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    return null;
  }
  return buildAttachmentResponse(
    response.body,
    fallbackFilename,
    response.headers.get("content-type"),
    response.headers.get("content-length")
  );
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

  const purchasedEntryId =
    typeof purchasedEntry === "object"
      ? normalizeId(
          normalizeRelationshipId(
            (purchasedEntry as ProductDoc).id ??
              (purchasedEntry as ProductDoc).value ??
              (purchasedEntry as ProductDoc)._id
          )
        )
      : normalizeId(normalizeRelationshipId(purchasedEntry));

  let product: ProductDoc | null =
    typeof purchasedEntry === "object"
      ? (purchasedEntry as ProductDoc)
      : null;

  if (!product || (!product.rawModel && !product.paintedModel)) {
    const candidates = Array.from(
      new Set([target, purchasedEntryId].map((value) => normalizeId(value)).filter(Boolean))
    );
    for (const candidate of candidates) {
      const fetched = await fetchProductByIdOrSlug(payload, candidate);
      if (fetched) {
        product = fetched;
        if (fetched.rawModel || fetched.paintedModel) {
          break;
        }
      }
    }
  }

  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  if (!product.rawModel && !product.paintedModel) {
    const fallbackId = normalizeId(product.id ?? product.value ?? product._id) || product.slug || target;
    const refreshed = await fetchProductByIdOrSlug(payload, fallbackId);
    if (refreshed) {
      product = refreshed;
    }
  }

  const media =
    (await resolveMediaDoc(payload, product.rawModel)) ??
    (await resolveMediaDoc(payload, product.paintedModel));
  if (!media?.filename && !media?.url) {
    return NextResponse.json({ error: "File not available." }, { status: 404 });
  }

  const fileNameFromMedia = normalizeStoragePath(media.filename || "").split("/").pop();
  const fileNameFromUrl = normalizeStoragePath(extractKeyFromUrl(media.url || "") || "").split("/").pop();
  const resolvedFilename =
    fileNameFromMedia ||
    fileNameFromUrl ||
    `${product.slug || product.id || target}.stl`;

  const storageTargets = collectStorageTargets();
  const keyCandidates = buildKeyCandidates(media, resolvedFilename);
  let unexpectedStorageError = false;

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
          resolvedFilename,
          media.mimeType || result.ContentType || guessContentType(resolvedFilename),
          typeof result.ContentLength === "number" ? String(result.ContentLength) : null
        );
        if (response) {
          return response;
        }
      } catch (error: any) {
        if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
          continue;
        }
        unexpectedStorageError = true;
      }
    }
  }

  if (media.url) {
    const proxiedRemote = await streamRemoteFile(media.url, request, resolvedFilename);
    if (proxiedRemote) {
      return proxiedRemote;
    }
  }

  const proxyCandidates = buildProxyCandidates(media, resolvedFilename, keyCandidates);
  for (const candidate of proxyCandidates) {
    const proxiedInternal = await streamFromMediaProxy(candidate, request, resolvedFilename);
    if (proxiedInternal) {
      return proxiedInternal;
    }
  }

  if (!storageTargets.length) {
    return NextResponse.json({ error: "Storage is not configured." }, { status: 500 });
  }

  return NextResponse.json(
    { error: unexpectedStorageError ? "Failed to download file." : "File not found." },
    { status: unexpectedStorageError ? 500 : 404 }
  );
}

