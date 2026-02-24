type PayloadLike = {
  create: (args: {
    collection: "ai_job_events";
    overrideAccess?: boolean;
    depth?: number;
    data: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
};

type CreateAiJobEventInput = {
  jobId: string | number;
  userId: string | number;
  eventType: string;
  statusBefore?: string | null;
  statusAfter?: string | null;
  provider?: string | null;
  traceId?: string | null;
  requestId?: string | null;
  payload?: Record<string, unknown> | null;
};

const toStringSafe = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toJsonRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export const createAiJobEvent = async (payload: PayloadLike, input: CreateAiJobEventInput) => {
  try {
    await payload.create({
      collection: "ai_job_events",
      overrideAccess: true,
      depth: 0,
      data: {
        job: input.jobId as any,
        user: input.userId as any,
        eventType: toStringSafe(input.eventType) || "job.event",
        statusBefore: toStringSafe(input.statusBefore) || undefined,
        statusAfter: toStringSafe(input.statusAfter) || undefined,
        provider: toStringSafe(input.provider) || undefined,
        traceId: toStringSafe(input.traceId) || undefined,
        requestId: toStringSafe(input.requestId) || undefined,
        payload: toJsonRecord(input.payload),
      },
    });
  } catch (error) {
    console.error("[ai/job-events] failed to create event", {
      eventType: input.eventType,
      jobId: String(input.jobId),
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
