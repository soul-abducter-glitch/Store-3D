import test from "node:test";
import assert from "node:assert/strict";

import { runAiWorkerTick } from "../../src/lib/aiWorker";
import { createMockAiPayload } from "./helpers/mockAiPayload";

test("worker eventually completes mock job and finalizes tokens once", async () => {
  const createdAt = new Date(Date.now() - 9000).toISOString();
  const payload = createMockAiPayload({
    users: [{ id: "u1", aiCredits: 90 }],
    jobs: [
      {
        id: "j1",
        user: "u1",
        provider: "mock",
        status: "queued",
        progress: 0,
        createdAt,
        reservedTokens: 10,
        sourceUrl: "https://example.com/ref.png",
      },
    ],
    tokenEvents: [
      {
        id: "e-reserve",
        user: "u1",
        job: "j1",
        idempotencyKey: "job:j1:reserve",
        type: "reserve",
        reason: "spend",
        amount: 10,
        delta: -10,
        balanceAfter: 90,
      },
    ],
  });

  for (let i = 0; i < 6; i += 1) {
    await runAiWorkerTick(payload as any, { limit: 5 });
  }

  const state = payload.__state();
  const job = state.jobs.find((entry) => entry.id === "j1");
  assert.equal(job?.status, "completed");
  const finalizeEvents = state.tokenEvents.filter(
    (entry) => entry.idempotencyKey === "job:j1:finalize"
  );
  assert.equal(finalizeEvents.length, 1);
  assert.equal(state.users.find((entry) => entry.id === "u1")?.aiCredits, 90);
});

test("worker fails invalid provider job and releases reserved tokens", async () => {
  const payload = createMockAiPayload({
    users: [{ id: "u2", aiCredits: 70 }],
    jobs: [
      {
        id: "j2",
        user: "u2",
        provider: "meshy",
        status: "queued",
        progress: 0,
        reservedTokens: 20,
      },
    ],
    tokenEvents: [
      {
        id: "e-reserve-2",
        user: "u2",
        job: "j2",
        idempotencyKey: "job:j2:reserve",
        type: "reserve",
        reason: "spend",
        amount: 20,
        delta: -20,
        balanceAfter: 70,
      },
    ],
  });

  const result = await runAiWorkerTick(payload as any, { limit: 5 });
  assert.equal(result.advanced, 1);

  const state = payload.__state();
  const job = state.jobs.find((entry) => entry.id === "j2");
  assert.equal(job?.status, "failed");
  assert.equal(state.users.find((entry) => entry.id === "u2")?.aiCredits, 90);
  const releaseEvents = state.tokenEvents.filter(
    (entry) => entry.idempotencyKey === "job:j2:release"
  );
  assert.equal(releaseEvents.length, 1);
});
