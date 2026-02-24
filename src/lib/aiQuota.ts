import { checkRateLimitDistributed } from "@/lib/rateLimit";

type QuotaWindow = {
  bucket: "minute" | "hour" | "day";
  max: number;
  windowMs: number;
};

type QuotaSubject = "user" | "ip";

export type QuotaResult = {
  ok: boolean;
  retryAfterMs: number;
  retryAfterSec: number;
  message: string;
};

type EnforceQuotaInput = {
  scope: string;
  userId: string | number;
  ip: string;
  userMinute: number;
  userHour: number;
  userDay: number;
  ipMinute: number;
  ipHour: number;
  ipDay: number;
  actionLabel: string;
};

const toSafePositiveInt = (value: unknown, fallback: number) => {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : Number.parseInt(typeof value === "string" ? value : "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
};

const toRetryAfterSec = (retryAfterMs: number) =>
  Math.max(1, Math.ceil(Math.max(0, retryAfterMs) / 1000));

const describeWindow = (bucket: QuotaWindow["bucket"]) => {
  if (bucket === "minute") return "minute";
  if (bucket === "hour") return "hour";
  return "day";
};

const buildMessage = (actionLabel: string, subject: QuotaSubject, bucket: QuotaWindow["bucket"]) => {
  const by = subject === "user" ? "user quota" : "IP quota";
  return `Too many ${actionLabel} requests (${by}, per ${describeWindow(bucket)}). Please retry later.`;
};

const checkSingleQuota = async (
  args: {
    scope: string;
    key: string;
    subject: QuotaSubject;
    actionLabel: string;
  },
  window: QuotaWindow
): Promise<QuotaResult> => {
  const result = await checkRateLimitDistributed({
    scope: `${args.scope}:${window.bucket}:${args.subject}`,
    key: args.key,
    max: Math.max(1, window.max),
    windowMs: Math.max(1000, window.windowMs),
  });
  if (result.ok) {
    return {
      ok: true,
      retryAfterMs: 0,
      retryAfterSec: 0,
      message: "",
    };
  }
  const retryAfterMs = Math.max(0, result.retryAfterMs);
  return {
    ok: false,
    retryAfterMs,
    retryAfterSec: toRetryAfterSec(retryAfterMs),
    message: buildMessage(args.actionLabel, args.subject, window.bucket),
  };
};

export const enforceUserAndIpQuota = async (input: EnforceQuotaInput): Promise<QuotaResult> => {
  const userKey = String(input.userId);
  const ipKey = (input.ip || "unknown").trim() || "unknown";

  const windowsBySubject: Array<{ subject: QuotaSubject; key: string; windows: QuotaWindow[] }> = [
    {
      subject: "user",
      key: userKey,
      windows: [
        { bucket: "minute", max: input.userMinute, windowMs: 60_000 },
        { bucket: "hour", max: input.userHour, windowMs: 60 * 60_000 },
        { bucket: "day", max: input.userDay, windowMs: 24 * 60 * 60_000 },
      ],
    },
    {
      subject: "ip",
      key: ipKey,
      windows: [
        { bucket: "minute", max: input.ipMinute, windowMs: 60_000 },
        { bucket: "hour", max: input.ipHour, windowMs: 60 * 60_000 },
        { bucket: "day", max: input.ipDay, windowMs: 24 * 60 * 60_000 },
      ],
    },
  ];

  for (const subjectConfig of windowsBySubject) {
    for (const window of subjectConfig.windows) {
      const checked = await checkSingleQuota(
        {
          scope: input.scope,
          key: subjectConfig.key,
          subject: subjectConfig.subject,
          actionLabel: input.actionLabel,
        },
        {
          bucket: window.bucket,
          max: toSafePositiveInt(window.max, 1),
          windowMs: window.windowMs,
        }
      );
      if (!checked.ok) return checked;
    }
  }

  return {
    ok: true,
    retryAfterMs: 0,
    retryAfterSec: 0,
    message: "",
  };
};
