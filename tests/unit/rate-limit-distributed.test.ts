import test from "node:test";
import assert from "node:assert/strict";

import { checkRateLimitDistributed } from "../../src/lib/rateLimit";
import { resetRateLimitAdapterForTests } from "../../src/lib/infra/rate-limit/getRateLimitAdapter";

const withEnv = async (driver: string, fn: () => Promise<void>) => {
  const prevDriver = process.env.RATE_LIMIT_DRIVER;
  process.env.RATE_LIMIT_DRIVER = driver;
  resetRateLimitAdapterForTests();
  try {
    await fn();
  } finally {
    if (prevDriver === undefined) {
      delete process.env.RATE_LIMIT_DRIVER;
    } else {
      process.env.RATE_LIMIT_DRIVER = prevDriver;
    }
    resetRateLimitAdapterForTests();
  }
};

test("distributed rate limit enforces memory bucket limits", async () => {
  await withEnv("memory", async () => {
    const scope = `test-rate:${Date.now()}`;
    const key = "user:1";

    const first = await checkRateLimitDistributed({
      scope,
      key,
      max: 2,
      windowMs: 60_000,
    });
    const second = await checkRateLimitDistributed({
      scope,
      key,
      max: 2,
      windowMs: 60_000,
    });
    const third = await checkRateLimitDistributed({
      scope,
      key,
      max: 2,
      windowMs: 60_000,
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(third.ok, false);
    assert.ok(third.retryAfterMs > 0);
  });
});
