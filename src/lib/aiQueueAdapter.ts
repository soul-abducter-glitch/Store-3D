export interface AIQueueAdapter {
  enqueueJob(jobId: string, opts?: { delayMs?: number }): Promise<void>;
  ackJob(jobId: string): Promise<void>;
  failJob(jobId: string, reason: string): Promise<void>;
  retryJob(jobId: string, opts?: { delayMs?: number }): Promise<void>;
}

class InMemoryQueueAdapter implements AIQueueAdapter {
  private readonly pending = new Map<string, { delayMs: number; enqueuedAt: string }>();

  async enqueueJob(jobId: string, opts?: { delayMs?: number }) {
    const normalized = String(jobId).trim();
    if (!normalized) return;
    this.pending.set(normalized, {
      delayMs: Math.max(0, Math.trunc(opts?.delayMs || 0)),
      enqueuedAt: new Date().toISOString(),
    });
  }

  async ackJob(jobId: string) {
    this.pending.delete(String(jobId).trim());
  }

  async failJob(jobId: string, _reason: string) {
    this.pending.delete(String(jobId).trim());
  }

  async retryJob(jobId: string, opts?: { delayMs?: number }) {
    await this.enqueueJob(jobId, opts);
  }
}

class BullMQQueueAdapter implements AIQueueAdapter {
  async enqueueJob(_jobId: string, _opts?: { delayMs?: number }) {}

  async ackJob(_jobId: string) {}

  async failJob(_jobId: string, _reason: string) {}

  async retryJob(_jobId: string, _opts?: { delayMs?: number }) {}
}

let singleton: AIQueueAdapter | null = null;

export const getAiQueueAdapter = (): AIQueueAdapter => {
  if (singleton) return singleton;
  const mode = String(process.env.AI_QUEUE_ADAPTER || "inmemory").trim().toLowerCase();
  singleton = mode === "bullmq" ? new BullMQQueueAdapter() : new InMemoryQueueAdapter();
  return singleton;
};
