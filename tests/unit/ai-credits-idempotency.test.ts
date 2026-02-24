import test from "node:test";
import assert from "node:assert/strict";

import {
  getUserAiCredits,
  refundUserAiCredits,
  spendUserAiCredits,
} from "../../src/lib/aiCredits";
import { createMockAiPayload } from "./helpers/mockAiPayload";

test("spendUserAiCredits is idempotent by key", async () => {
  const payload = createMockAiPayload({
    users: [{ id: "u1", aiCredits: 100 }],
  });

  const first = await spendUserAiCredits(payload as any, "u1", 10, {
    idempotencyKey: "job:j1:reserve",
    reason: "spend",
  });
  const second = await spendUserAiCredits(payload as any, "u1", 10, {
    idempotencyKey: "job:j1:reserve",
    reason: "spend",
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.remaining, 90);
  assert.equal(second.remaining, 90);
  assert.equal(await getUserAiCredits(payload as any, "u1"), 90);

  const state = payload.__state();
  assert.equal(state.tokenEvents.length, 1);
  assert.equal(state.tokenEvents[0]?.idempotencyKey, "job:j1:reserve");
});

test("refundUserAiCredits is idempotent by key", async () => {
  const payload = createMockAiPayload({
    users: [{ id: "u1", aiCredits: 70 }],
  });

  const first = await refundUserAiCredits(payload as any, "u1", 10, {
    idempotencyKey: "job:j1:release",
    reason: "refund",
  });
  const second = await refundUserAiCredits(payload as any, "u1", 10, {
    idempotencyKey: "job:j1:release",
    reason: "refund",
  });

  assert.equal(first, 80);
  assert.equal(second, 80);
  assert.equal(await getUserAiCredits(payload as any, "u1"), 80);

  const state = payload.__state();
  assert.equal(state.tokenEvents.length, 1);
  assert.equal(state.tokenEvents[0]?.idempotencyKey, "job:j1:release");
});
