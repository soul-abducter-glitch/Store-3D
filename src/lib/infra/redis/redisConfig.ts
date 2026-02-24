const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const toNonEmptyString = (value: string | undefined) => {
  if (!value) return "";
  return value.trim();
};

export type RedisRuntimeConfig = {
  url: string;
  tls: boolean;
  prefix: string;
};

export const resolveRedisConfig = (): RedisRuntimeConfig | null => {
  const redisUrl = toNonEmptyString(process.env.REDIS_URL);
  if (!redisUrl) return null;

  const tlsFlag = parseBoolean(process.env.REDIS_TLS, redisUrl.startsWith("rediss://"));
  const prefix = toNonEmptyString(process.env.REDIS_PREFIX) || "store3d";

  return {
    url: redisUrl,
    tls: tlsFlag,
    prefix,
  };
};

export const isRedisConfigured = () => Boolean(resolveRedisConfig());

export const buildRedisKey = (...parts: Array<string | number | null | undefined>) => {
  const config = resolveRedisConfig();
  const prefix = config?.prefix || "store3d";
  const suffix = parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(":");
  return suffix ? `${prefix}:${suffix}` : prefix;
};
