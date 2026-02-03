import { test, expect } from "@playwright/test";

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
  await expect(page.getByText("Печать на заказ", { exact: false })).toBeVisible();
});

test("checkout page loads", async ({ page }) => {
  const response = await page.goto("/checkout");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByText("Оформление заказа", { exact: false })).toBeVisible();
});
