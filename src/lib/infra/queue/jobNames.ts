export const AI_GENERATE_QUEUE_NAME = "q:ai:generate";
export const AI_GENERATE_JOB_NAME = "ai.generate";

export type AIGenerateQueueJob = {
  jobId: string;
  traceId?: string;
  requestedAt: string;
};

export const buildAiStableQueueJobId = (jobId: string) => `ai:${jobId}`;

export const buildAiRetryQueueJobId = (jobId: string) =>
  `ai:${jobId}:retry:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
