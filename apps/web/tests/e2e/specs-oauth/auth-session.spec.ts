import { test, expect } from "@playwright/test";
import { TestEnv } from "../helpers/flows";

test.describe("authenticated session", () => {
  test("dashboard loads without redirect to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });
  });

  test("login page is accessible when already authenticated", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("google-sign-in-button")).toBeVisible();
  });

  test("logout clears session and redirects to /login", async ({ page }) => {
    // First confirm dashboard is accessible
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);

    // Navigate to the real logout endpoint — clears session cookie and redirects to /login
    await page.goto(`http://${TestEnv.host}:${TestEnv.ports.api}/auth/logout`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    // Subsequent navigation to / should redirect to /login via middleware
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});

test.describe("route protection", () => {
  test("unauthenticated visit to / redirects to /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("unauthenticated visit to /login renders login page without redirect", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("google-sign-in-button")).toBeVisible();
  });

  test("unauthenticated visit to /auth/error renders error page without redirect", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/auth/error?reason=server_error");
    await expect(page).toHaveURL(/\/auth\/error/);
    await expect(page.getByTestId("auth-error-try-again")).toBeVisible();
  });
});
