export type AIQueueDriver = "inmemory" | "bullmq";

export interface AIQueueAdapter {
  enqueueJob(jobId: string, opts?: { delayMs?: number }): Promise<void>;
  ackJob(jobId: string): Promise<void>;
  failJob(jobId: string, reason: string): Promise<void>;
  retryJob(jobId: string, opts?: { delayMs?: number }): Promise<void>;
}
