import { resolveProvider } from "@/lib/aiProvider";
import { ensureAiLabSchemaOnce } from "@/lib/ensureAiLabSchemaOnce";

type PayloadLike = {
  find: (args: {
    collection: "users";
    depth?: number;
    limit?: number;
    overrideAccess?: boolean;
  }) => Promise<unknown>;
};

export type ReadinessCheck = {
  name: "database" | "ai_schema" | "ai_provider" | "storage";
  ok: boolean;
  required: boolean;
  message: string;
};

export type ReadinessResult = {
  ok: boolean;
  checks: ReadinessCheck[];
  generatedAt: string;
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const hasS3Config = () => {
  const accessKey = toNonEmptyString(
    process.env.S3_PUBLIC_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID
  );
  const secretKey = toNonEmptyString(
    process.env.S3_PUBLIC_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY
  );
  const bucket = toNonEmptyString(process.env.S3_PUBLIC_BUCKET || process.env.S3_BUCKET);
  const endpoint = toNonEmptyString(process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT);
  return Boolean(accessKey && secretKey && bucket && endpoint);
};

export const runServiceReadinessChecks = async (
  payload: PayloadLike
): Promise<ReadinessResult> => {
  const checks: ReadinessCheck[] = [];

  try {
    await payload.find({
      collection: "users",
      depth: 0,
      limit: 1,
      overrideAccess: true,
    });
    checks.push({
      name: "database",
      ok: true,
      required: true,
      message: "Database connection is healthy.",
    });
  } catch (error) {
    checks.push({
      name: "database",
      ok: false,
      required: true,
      message: error instanceof Error ? error.message : "Failed to query database.",
    });
  }

  try {
    await ensureAiLabSchemaOnce(payload as any);
    checks.push({
      name: "ai_schema",
      ok: true,
      required: true,
      message: "AI schema is ready.",
    });
  } catch (error) {
    checks.push({
      name: "ai_schema",
      ok: false,
      required: true,
      message: error instanceof Error ? error.message : "Failed to ensure AI schema.",
    });
  }

  const provider = resolveProvider(process.env.AI_GENERATION_PROVIDER);
  const providerOk = provider.configured || provider.effectiveProvider === "mock";
  checks.push({
    name: "ai_provider",
    ok: providerOk,
    required: false,
    message: providerOk
      ? provider.fallbackToMock
        ? provider.reason || "Provider fallback to mock mode is active."
        : `Provider ready: ${provider.effectiveProvider}.`
      : provider.reason || "AI provider is not configured.",
  });

  const storageOk = hasS3Config();
  checks.push({
    name: "storage",
    ok: storageOk,
    required: true,
    message: storageOk ? "Storage is configured." : "Storage variables are not configured.",
  });

  const ok = checks.every((check) => (check.required ? check.ok : true));

  return {
    ok,
    checks,
    generatedAt: new Date().toISOString(),
  };
};
