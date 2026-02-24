import type { AIQueueAdapter } from "@/lib/infra/queue/queueAdapter";

export class InMemoryQueueAdapter implements AIQueueAdapter {
  private readonly pending = new Map<string, { delayMs: number; enqueuedAt: string }>();

  async enqueueJob(jobId: string, opts?: { delayMs?: number }) {
    const normalized = String(jobId || "").trim();
    if (!normalized) return;
    this.pending.set(normalized, {
      delayMs: Math.max(0, Math.trunc(opts?.delayMs || 0)),
      enqueuedAt: new Date().toISOString(),
    });
  }

  async ackJob(jobId: string) {
    this.pending.delete(String(jobId || "").trim());
  }

  async failJob(jobId: string, _reason: string) {
    this.pending.delete(String(jobId || "").trim());
  }

  async retryJob(jobId: string, opts?: { delayMs?: number }) {
    await this.enqueueJob(jobId, opts);
  }
}
