import test from "node:test";
import assert from "node:assert/strict";

import { runAiWorkerTick } from "../../src/lib/aiWorker";
import { createMockAiPayload } from "./helpers/mockAiPayload";

test("runAiWorkerTick skips in-process processing when queue driver is bullmq", async () => {
  const prevDriver = process.env.AI_QUEUE_DRIVER;
  process.env.AI_QUEUE_DRIVER = "bullmq";

  try {
    const payload = createMockAiPayload({
      users: [{ id: "u1", aiCredits: 120 }],
      jobs: [
        {
          id: "j1",
          user: "u1",
          provider: "mock",
          status: "queued",
          progress: 0,
          createdAt: new Date(Date.now() - 8000).toISOString(),
          reservedTokens: 10,
        },
      ],
    });

    const result = await runAiWorkerTick(payload as any, { limit: 5 });
    assert.equal(result.enabled, false);
    assert.equal(result.processed, 0);
    assert.equal(result.advanced, 0);
  } finally {
    if (prevDriver === undefined) {
      delete process.env.AI_QUEUE_DRIVER;
    } else {
      process.env.AI_QUEUE_DRIVER = prevDriver;
    }
  }
});
