import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse, type NextRequest } from "next/server";
import { Readable } from "stream";
import { getPayloadHMR } from "@payloadcms/next/utilities";

import payloadConfig from "../../../../../payload.config";
import { importMap } from "../../../(payload)/admin/importMap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MediaDoc = {
  id?: string | number;
  url?: string;
  filename?: string;
  mimeType?: string;
};

type ProductDoc = {
  id?: string | number;
  slug?: string;
  name?: string;
  rawModel?: MediaDoc | string | number | null;
  paintedModel?: MediaDoc | string | number | null;
};

type UserResponse = {
  user?: {
    id?: string | number;
    purchasedProducts?: Array<ProductDoc | string | number | null> | null;
  };
};

const bucket = process.env.S3_PUBLIC_BUCKET || process.env.S3_BUCKET;
const endpoint = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT;
const accessKeyId =
  process.env.S3_PUBLIC_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
const secretAccessKey =
  process.env.S3_PUBLIC_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
const region = process.env.S3_PUBLIC_REGION || process.env.S3_REGION || "us-east-1";
const prefix = "media";

const client =
  bucket && endpoint && accessKeyId && secretAccessKey
    ? new S3Client({
        region,
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      })
    : null;

const getPayload = async () =>
  getPayloadHMR({
    config: payloadConfig,
    importMap,
  });

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

  const headers = new Headers();
  headers.set(
    "Content-Type",
    response.headers.get("content-type") || guessContentType(fallbackFilename)
  );
  headers.set(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(fallbackFilename)}"`
  );
  headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }
  return new Response(response.body, { headers });
};

const normalizeId = (value: unknown) => String(value ?? "").trim();

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
    if (normalizeId(entry.id) === target || entry.slug === target) {
      return entry;
    }
  }
  return null;
};

const resolveMediaDoc = async (payload: any, value?: MediaDoc | string | number | null) => {
  if (!value) return null;
  if (typeof value === "object") {
    return value as MediaDoc;
  }
  const id = normalizeId(value);
  if (!id) return null;
  try {
    return (await payload.findByID({
      collection: "media",
      id,
      depth: 0,
      overrideAccess: true,
    })) as MediaDoc;
  } catch {
    return null;
  }
};

const fetchUser = async (request: NextRequest) => {
  const siteUrl = (
    process.env.NEXT_PUBLIC_SERVER_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    request.nextUrl.origin ||
    "http://localhost:3000"
  )
    .trim()
    .replace(/\/$/, "");
  const cookie = request.headers.get("cookie") || "";
  const response = await fetch(`${siteUrl}/api/users/me?depth=2`, {
    headers: cookie ? { cookie } : undefined,
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as UserResponse;
  return data?.user ?? null;
};

const fetchProductByIdOrSlug = async (payload: any, target: string) => {
  if (!target) return null;
  const where = /^\d+$/.test(target)
    ? { or: [{ id: { equals: Number(target) } }, { slug: { equals: target } }] }
    : { slug: { equals: target } };
  const result = await payload.find({
    collection: "products",
    depth: 2,
    limit: 1,
    overrideAccess: true,
    where,
  });
  return (result?.docs?.[0] ?? null) as ProductDoc | null;
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
  const user = await fetchUser(request);
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

  const payload = await getPayload();
  let product =
    typeof purchasedEntry === "object"
      ? (purchasedEntry as ProductDoc)
      : await fetchProductByIdOrSlug(payload, target);
  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  if (!product.rawModel && !product.paintedModel) {
    const fallbackId = normalizeId(product.id) || product.slug || target;
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
  const resolvedFilename =
    media?.filename ||
    decodeURIComponent((media?.url || "").split("?")[0].split("/").pop() || "").trim() ||
    `${product.slug || product.id || target}.stl`;

  if (!client || !bucket) {
    if (media?.url) {
      const proxied = await streamRemoteFile(media.url, request, resolvedFilename);
      if (proxied) {
        return proxied;
      }
    }
    return NextResponse.json({ error: "Storage is not configured." }, { status: 500 });
  }

  const key = prefix ? `${prefix}/${resolvedFilename}` : resolvedFilename;
  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    if (!result.Body) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }

    const headers = new Headers();
    headers.set("Content-Type", media.mimeType || guessContentType(resolvedFilename));
    headers.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(resolvedFilename)}"`
    );
    headers.set("Cache-Control", "private, max-age=0, must-revalidate");
    if (typeof result.ContentLength === "number") {
      headers.set("Content-Length", result.ContentLength.toString());
    }

    return new Response(toWebStream(result.Body), { headers });
  } catch (error: any) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      if (media.url) {
        const proxied = await streamRemoteFile(media.url, request, resolvedFilename);
        if (proxied) {
          return proxied;
        }
      }
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    if (media.url) {
      const proxied = await streamRemoteFile(media.url, request, resolvedFilename);
      if (proxied) {
        return proxied;
      }
    }
    return NextResponse.json({ error: "Failed to download file." }, { status: 500 });
  }
}
