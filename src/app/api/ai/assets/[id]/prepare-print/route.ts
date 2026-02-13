import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../../payload.config";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

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
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
};

const normalizeEmail = (value?: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

const isAdmin = (user?: any) => {
  const email = normalizeEmail(user?.email);
  if (!email) return false;
  return parseAdminEmails().includes(email);
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const guessMimeType = (filename: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".obj")) return "model/obj";
  if (lower.endsWith(".stl")) return "model/stl";
  return "application/octet-stream";
};

type PrecheckIssue = {
  code: string;
  severity: "risk" | "critical";
  message: string;
};

type PrecheckResult = {
  status: "ok" | "risk" | "critical";
  summary: string;
  issues: PrecheckIssue[];
  modelBytes: number | null;
  contentType: string;
};

const PRECHECK_TIMEOUT_MS = 8000;
const RISK_SIZE_BYTES = 60 * 1024 * 1024;
const CRITICAL_SIZE_BYTES = 120 * 1024 * 1024;

const parseContentLength = (value: string | null) => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const isLikelyModelMime = (value: string) => {
  const raw = value.toLowerCase();
  if (!raw) return true;
  if (raw.includes("model/")) return true;
  if (raw.includes("application/octet-stream")) return true;
  if (raw.includes("application/gltf")) return true;
  return false;
};

const buildPrecheckSummary = (status: PrecheckResult["status"], issues: PrecheckIssue[]) => {
  if (status === "critical") return issues[0]?.message || "Критичная проблема модели.";
  if (status === "risk") return issues[0]?.message || "Есть риск печати. Проверьте модель.";
  return "Модель готова к переносу в печать.";
};

const inspectModelPrecheck = async (modelUrl: string, format: string): Promise<PrecheckResult> => {
  const issues: PrecheckIssue[] = [];
  const extension = format.toLowerCase();
  if (!["glb", "gltf", "obj", "stl"].includes(extension)) {
    issues.push({
      code: "unsupported_format",
      severity: "critical",
      message: "Неподдерживаемый формат файла для печати.",
    });
  }

  let contentType = "";
  let modelBytes: number | null = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRECHECK_TIMEOUT_MS);

  try {
    let response = await fetch(modelUrl, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    }).catch(() => null);

    if (!response || !response.ok || response.status === 405) {
      response = await fetch(modelUrl, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Range: "bytes=0-0",
        },
      }).catch(() => null);
    }

    if (!response || !response.ok) {
      issues.push({
        code: "source_unreachable",
        severity: "critical",
        message: "Файл модели недоступен по ссылке (истек URL или нет доступа).",
      });
    } else {
      contentType = response.headers.get("content-type") || "";
      modelBytes = parseContentLength(response.headers.get("content-length"));

      if (contentType && !isLikelyModelMime(contentType)) {
        issues.push({
          code: "invalid_content_type",
          severity: "critical",
          message: "Ссылка не похожа на 3D-файл (content-type).",
        });
      }

      if (modelBytes !== null && modelBytes >= CRITICAL_SIZE_BYTES) {
        issues.push({
          code: "file_too_large",
          severity: "critical",
          message: "Файл слишком большой для стабильного предпросмотра и печати.",
        });
      } else if (modelBytes !== null && modelBytes >= RISK_SIZE_BYTES) {
        issues.push({
          code: "file_large_risk",
          severity: "risk",
          message: "Большой файл: загрузка и анализ могут быть медленными.",
        });
      } else if (modelBytes === null) {
        issues.push({
          code: "unknown_file_size",
          severity: "risk",
          message: "Размер файла неизвестен. Рекомендуется ручная проверка.",
        });
      }
    }
  } catch {
    issues.push({
      code: "precheck_network_error",
      severity: "risk",
      message: "Не удалось проверить файл по сети. Продолжайте с осторожностью.",
    });
  } finally {
    clearTimeout(timeout);
  }

  const hasCritical = issues.some((issue) => issue.severity === "critical");
  const hasRisk = issues.some((issue) => issue.severity === "risk");
  const status: PrecheckResult["status"] = hasCritical ? "critical" : hasRisk ? "risk" : "ok";

  return {
    status,
    summary: buildPrecheckSummary(status, issues),
    issues,
    modelBytes,
    contentType,
  };
};

const sanitizeFilename = (filename: string, fallbackExt = ".glb") => {
  const trimmed = filename.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  const rawExt = dotIndex > 0 ? trimmed.slice(dotIndex).toLowerCase() : "";
  const allowedExt = [".glb", ".gltf", ".obj", ".stl"];
  const ext = allowedExt.includes(rawExt) ? rawExt : fallbackExt;
  const base = (dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/^[-_]+/, "")
    .replace(/[-_]+$/, "")
    .slice(0, 80);
  const safeBase = base || "ai-model";
  return `${safeBase}${ext}`;
};

const deriveFilename = (value: string, fallbackExt = ".glb") => {
  const input = toNonEmptyString(value);
  if (!input) return `ai-model${fallbackExt}`;
  try {
    const parsed = new URL(input);
    const filename = decodeURIComponent(parsed.pathname.split("/").pop() || "").trim();
    if (filename) return sanitizeFilename(filename, fallbackExt);
    return `ai-model${fallbackExt}`;
  } catch {
    return `ai-model${fallbackExt}`;
  }
};

const findAuthorizedAsset = async (
  payload: any,
  request: NextRequest,
  params: Promise<{ id: string }>
) => {
  const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
  const user = authResult?.user ?? null;
  const userId = normalizeRelationshipId(user?.id);
  if (!user || userId === null) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 }),
    };
  }

  const resolvedParams = await params;
  const id = resolvedParams?.id ? String(resolvedParams.id).trim() : "";
  if (!id) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Asset id is required." }, { status: 400 }),
    };
  }

  const asset = await payload.findByID({
    collection: "ai_assets",
    id,
    depth: 0,
    overrideAccess: true,
  });

  if (!asset) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Asset not found." }, { status: 404 }),
    };
  }

  const ownerId = normalizeRelationshipId(asset?.user);
  if (!isAdmin(user) && (ownerId === null || String(ownerId) !== String(userId))) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    asset,
  };
};

const findMediaByUrl = async (payload: any, modelUrl: string) => {
  const found = await payload.find({
    collection: "media",
    depth: 0,
    limit: 1,
    sort: "-createdAt",
    where: {
      url: {
        equals: modelUrl,
      },
    },
    overrideAccess: true,
  });
  return found?.docs?.[0] ?? null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await getPayloadClient();
    await ensureAiLabSchemaOnce(payload as any);
    const authorized = await findAuthorizedAsset(payload, request, params);
    if (!authorized.ok) return authorized.response;

    const asset = authorized.asset;
    const modelUrl = toNonEmptyString(asset?.modelUrl);
    const formatFromAsset =
      typeof asset?.format === "string" ? asset.format.trim().toLowerCase() : "";
    const formatFromUrl = (() => {
      const lower = modelUrl.toLowerCase().split("?")[0];
      if (lower.endsWith(".glb")) return "glb";
      if (lower.endsWith(".gltf")) return "gltf";
      if (lower.endsWith(".obj")) return "obj";
      if (lower.endsWith(".stl")) return "stl";
      return "";
    })();
    const formatRaw = formatFromAsset || formatFromUrl;
    if (!modelUrl) {
      return NextResponse.json(
        { success: false, error: "Asset model URL is empty." },
        { status: 400 }
      );
    }

    const precheck = await inspectModelPrecheck(modelUrl, formatRaw);
    if (precheck.status === "critical") {
      return NextResponse.json(
        {
          success: false,
          error: precheck.summary,
          precheck,
        },
        { status: 422 }
      );
    }

    let media = await findMediaByUrl(payload, modelUrl);
    if (!media?.id) {
      const preferredExt =
        formatRaw === "glb" || formatRaw === "gltf" || formatRaw === "obj" || formatRaw === "stl"
          ? `.${formatRaw}`
          : ".glb";
      let filename = deriveFilename(modelUrl, preferredExt);
      const buildMediaData = (safeFilename: string) => ({
        alt: toNonEmptyString(asset?.title) || "AI model",
        fileType: "3d-model",
        isCustomerUpload: true,
        filename: safeFilename,
        mimeType: guessMimeType(safeFilename),
        url: modelUrl,
        prefix: "media",
      });
      try {
        media = await payload.create({
          collection: "media",
          overrideAccess: true,
          disableTransaction: true,
          data: buildMediaData(filename),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!/filename/i.test(message)) {
          throw error;
        }
        filename = `ai-model-${String(asset.id).replace(/[^A-Za-z0-9_-]/g, "")}${preferredExt}`;
        media = await payload.create({
          collection: "media",
          overrideAccess: true,
          disableTransaction: true,
          data: buildMediaData(filename),
        });
      }
    }

    return NextResponse.json(
      {
        success: true,
        assetId: String(asset.id),
        media: {
          id: String(media.id),
          url: typeof media.url === "string" ? media.url : modelUrl,
          filename: typeof media.filename === "string" ? media.filename : deriveFilename(modelUrl),
        },
        precheck,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/assets:prepare-print] failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to prepare AI asset for print." },
      { status: 500 }
    );
  }
}
