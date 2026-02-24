import test from "node:test";
import assert from "node:assert/strict";

import { canTransition, transitionJob } from "../../src/lib/aiJobStateMachine";
import { createMockAiPayload } from "./helpers/mockAiPayload";

test("state machine allows and blocks expected transitions", () => {
  assert.equal(canTransition("queued", "running"), true);
  assert.equal(canTransition("provider_processing", "completed"), false);
  assert.equal(canTransition("postprocessing", "completed"), true);
  assert.equal(canTransition("completed", "running"), false);
});

test("transitionJob applies valid transition and writes audit event", async () => {
  const payload = createMockAiPayload({
    users: [{ id: "u1", aiCredits: 120 }],
    jobs: [{ id: "j1", user: "u1", status: "queued", progress: 0 }],
  });

  const updated = await transitionJob(payload as any, "j1", "running", {
    eventType: "test.transition",
    progress: 12,
  });

  assert.equal(updated.status, "running");
  assert.equal(updated.progress, 12);
  assert.ok(updated.startedAt);

  const state = payload.__state();
  assert.equal(state.jobEvents.length, 1);
  assert.equal(state.jobEvents[0]?.eventType, "test.transition");
  assert.equal(state.jobEvents[0]?.statusBefore, "queued");
  assert.equal(state.jobEvents[0]?.statusAfter, "running");
});

test("transitionJob rejects invalid transition from terminal state", async () => {
  const payload = createMockAiPayload({
    users: [{ id: "u1", aiCredits: 120 }],
    jobs: [{ id: "j2", user: "u1", status: "completed", progress: 100 }],
  });

  await assert.rejects(
    () => transitionJob(payload as any, "j2", "running", { eventType: "test.invalid" }),
    /Invalid AI job transition/i
  );
});

test("legacy processing status is normalized to provider_processing", async () => {
  const payload = createMockAiPayload({
    users: [{ id: "u1", aiCredits: 120 }],
    jobs: [{ id: "j3", user: "u1", status: "processing", progress: 55 }],
  });

  const updated = await transitionJob(payload as any, "j3", "provider_processing", {
    eventType: "test.normalize",
  });

  assert.equal(updated.status, "provider_processing");
});
