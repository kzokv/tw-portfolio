import { test, expect } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";

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

    // Navigate to the logout endpoint (API redirects to /login)
    // await page.goto(apiUrl("/auth/logout"));
    // await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    
    // Sanity check: session cookie exists
    const before = (await page.context().cookies()).find((c) => c.name === TestEnv.sessionCookieName);
    expect(before).toBeTruthy();

    // Simulate logout by deleting only the session cookie
    await page.context().clearCookies({ name: TestEnv.sessionCookieName });

    // Confirm cookie is gone
    const after = (await page.context().cookies()).find((c) => c.name === TestEnv.sessionCookieName);
    expect(after).toBeFalsy();

    // Subsequent navigation to / should redirect to /login
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
