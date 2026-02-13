import { test, expect, type Page } from "@playwright/test";

const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL || "";
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD || "";
const E2E_USER_NAME = process.env.E2E_USER_NAME || "E2E Smoke";

const hasAuthCreds = Boolean(E2E_USER_EMAIL && E2E_USER_PASSWORD);

const ensureAuth = async (page: Page) => {
  const createRes = await page.request.post("/api/users", {
    data: {
      email: E2E_USER_EMAIL,
      password: E2E_USER_PASSWORD,
      name: E2E_USER_NAME,
    },
  });

  if (!createRes.ok() && ![400, 409].includes(createRes.status())) {
    const body = await createRes.text().catch(() => "");
    throw new Error(`Failed to create e2e user: HTTP ${createRes.status()} ${body}`);
  }

  const loginRes = await page.request.post("/api/users/login", {
    data: {
      email: E2E_USER_EMAIL,
      password: E2E_USER_PASSWORD,
    },
  });

  if (!loginRes.ok()) {
    const body = await loginRes.text().catch(() => "");
    throw new Error(`Failed to login e2e user: HTTP ${loginRes.status()} ${body}`);
  }
};

const waitForCompletedJob = async (page: Page, jobId: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pollRes = await page.request.get(`/api/ai/generate/${encodeURIComponent(jobId)}`);
    if (!pollRes.ok()) {
      await page.waitForTimeout(500);
      continue;
    }

    const pollJson = await pollRes.json().catch(() => null);
    const status = pollJson?.job?.status;
    if (status === "completed") {
      return pollJson;
    }
    if (status === "failed") {
      throw new Error(`AI job failed: ${pollJson?.job?.errorMessage || "unknown error"}`);
    }
    await page.waitForTimeout(600);
  }

  throw new Error("Timed out while waiting for AI job completion.");
};

test("home page loads", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/3D-STORE/i);
});

test("store page loads", async ({ page }) => {
  const response = await page.goto("/store");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByText("3D-STORE", { exact: false })).toBeVisible();
});

test("print service page loads", async ({ page }) => {
  const response = await page.goto("/services/print");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByText("Печать", { exact: false })).toBeVisible();
});

test("checkout page loads", async ({ page }) => {
  const response = await page.goto("/checkout");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByText("Оформление", { exact: false })).toBeVisible();
});

test.describe("critical smoke (ai + order path)", () => {
  test.skip(!hasAuthCreds, "Set E2E_USER_EMAIL and E2E_USER_PASSWORD to run authenticated smoke tests.");

  test("generate -> save -> print -> cart", async ({ page }) => {
    await ensureAuth(page);

    const generateRes = await page.request.post("/api/ai/generate", {
      data: {
        mode: "text",
        prompt: "simple calibration cube",
      },
    });
    expect(generateRes.ok()).toBeTruthy();

    const generateJson = await generateRes.json();
    expect(generateJson?.success).toBeTruthy();

    const jobId = String(generateJson?.job?.id || "");
    expect(jobId).toBeTruthy();

    const completed = await waitForCompletedJob(page, jobId);
    const modelUrl = String(completed?.job?.result?.modelUrl || "");
    expect(modelUrl).toBeTruthy();

    const saveRes = await page.request.post("/api/ai/assets", {
      data: {
        jobId,
        title: "E2E Smoke Asset",
      },
    });
    expect(saveRes.ok()).toBeTruthy();
    const saveJson = await saveRes.json();
    const assetId = String(saveJson?.asset?.id || "");
    expect(assetId).toBeTruthy();

    const precheckRes = await page.request.post(`/api/ai/assets/${encodeURIComponent(assetId)}/prepare-print`);
    expect([200, 422]).toContain(precheckRes.status());

    await page.goto(`/services/print?model=${encodeURIComponent(modelUrl)}&name=E2E%20Smoke`);
    await page.waitForTimeout(1200);

    const addToCartButton = page.getByRole("button", {
      name: /в корзину|add to cart/i,
    });
    await expect(addToCartButton).toBeVisible();
    await addToCartButton.click();

    const cartHasItems = await page.evaluate(() => {
      const keys = Object.keys(window.localStorage);
      for (const key of keys) {
        if (!key.toLowerCase().includes("cart")) continue;
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return true;
          }
        } catch {
          // ignore invalid json
        }
      }
      return false;
    });

    expect(cartHasItems).toBeTruthy();
  });

  test("top-up -> token history -> generate", async ({ page }) => {
    await ensureAuth(page);

    const topupRes = await page.request.post("/api/ai/tokens/topup", {
      data: {
        packId: "starter",
      },
      headers: {
        "idempotency-key": `e2e-${Date.now()}`,
      },
    });
    expect(topupRes.ok()).toBeTruthy();

    const topupJson = await topupRes.json();
    expect(topupJson?.success).toBeTruthy();

    const historyRes = await page.request.get("/api/ai/tokens/history?limit=20");
    expect(historyRes.ok()).toBeTruthy();
    const historyJson = await historyRes.json();
    expect(Array.isArray(historyJson?.events)).toBeTruthy();

    if (topupJson?.mode === "mock") {
      const hasTopupEvent = (historyJson?.events || []).some((event: any) => event?.reason === "topup");
      expect(hasTopupEvent).toBeTruthy();
    } else {
      expect(typeof topupJson?.checkoutUrl).toBe("string");
      expect(Boolean(topupJson?.checkoutUrl)).toBeTruthy();
    }

    const generateRes = await page.request.post("/api/ai/generate", {
      data: {
        mode: "text",
        prompt: "smoke token generate",
      },
    });
    expect([200, 402]).toContain(generateRes.status());
  });
});
