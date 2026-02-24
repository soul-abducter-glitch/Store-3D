import test from "node:test";
import assert from "node:assert/strict";

import { getUserAiCredits } from "../../src/lib/aiCredits";
import {
  finalizeAiJobTokens,
  releaseAiJobTokens,
  reserveAiJobTokens,
} from "../../src/lib/aiTokenLifecycle";
import { createMockAiPayload } from "./helpers/mockAiPayload";

test("reserve/finalize lifecycle avoids double charge", async () => {
  const payload = createMockAiPayload({
    users: [{ id: "u1", aiCredits: 100 }],
    jobs: [{ id: "j1", user: "u1", reservedTokens: 10 }],
  });
  const job = payload.__state().jobs[0];

  const reserveFirst = await reserveAiJobTokens(payload as any, job, 10);
  const reserveSecond = await reserveAiJobTokens(payload as any, job, 10);
  const finalizeFirst = await finalizeAiJobTokens(payload as any, job);
  const finalizeSecond = await finalizeAiJobTokens(payload as any, job);
  const releaseAfterFinalize = await releaseAiJobTokens(payload as any, job);

  assert.equal(reserveFirst.ok, true);
  assert.equal(reserveFirst.applied, true);
  assert.equal(reserveSecond.applied, false);
  assert.equal(finalizeFirst.applied, true);
  assert.equal(finalizeSecond.applied, false);
  assert.equal(releaseAfterFinalize.applied, false);
  assert.equal(await getUserAiCredits(payload as any, "u1"), 90);

  const state = payload.__state();
  const keys = state.tokenEvents.map((event) => event.idempotencyKey);
  assert.ok(keys.includes("job:j1:reserve"));
  assert.ok(keys.includes("job:j1:finalize"));
  assert.equal(keys.includes("job:j1:release"), false);
});

test("reserve/release lifecycle refunds once", async () => {
  const payload = createMockAiPayload({
    users: [{ id: "u2", aiCredits: 50 }],
    jobs: [{ id: "j2", user: "u2", reservedTokens: 15 }],
  });
  const job = payload.__state().jobs[0];

  await reserveAiJobTokens(payload as any, job, 15);
  const releaseFirst = await releaseAiJobTokens(payload as any, job);
  const releaseSecond = await releaseAiJobTokens(payload as any, job);
  const finalizeAfterRelease = await finalizeAiJobTokens(payload as any, job);

  assert.equal(releaseFirst.applied, true);
  assert.equal(releaseSecond.applied, false);
  assert.equal(finalizeAfterRelease.applied, false);
  assert.equal(await getUserAiCredits(payload as any, "u2"), 50);

  const state = payload.__state();
  const keys = state.tokenEvents.map((event) => event.idempotencyKey);
  assert.ok(keys.includes("job:j2:reserve"));
  assert.ok(keys.includes("job:j2:release"));
  assert.equal(keys.includes("job:j2:finalize"), false);
});
