import { test, expect } from "@playwright/test";

// Demo tests start from the login page without an existing session.
// The oauth project's storageState (auth setup) seeds a real session cookie,
// so we override it with an empty state for these tests.
test.use({ storageState: { cookies: [], origins: [] } });
// ⚠️ This file makes 5 real POST /auth/demo/start calls, exhausting the 5/60s
// demo rate bucket. Tests in other spec files that need a demo session must use
// the /__e2e/demo-session fixture (fixtures/demo-test.ts) to avoid 429 failures.

test.describe("Demo user flow", () => {
  test("click demo button creates session and lands on /dashboard", async ({ page }) => {
    await page.goto("/login");
    const demoBtn = page.getByTestId("demo-sign-in-button");
    await expect(demoBtn).toBeVisible();

    // Click and wait for the proxy response
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/demo/start")),
      demoBtn.click(),
    ]);
    expect(response.status()).toBe(200);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  });

  test("demo user reaches dashboard with valid session", async ({ page }) => {
    await page.goto("/login");
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/demo/start")),
      page.getByTestId("demo-sign-in-button").click(),
    ]);
    expect(response.status()).toBe(200);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    // The demo banner proves the server-side session resolved with isDemo=true
    await expect(page.getByTestId("demo-banner")).toBeVisible();
  });

  test("demo data is isolated — each session gets unique user", async ({ page }) => {
    await page.goto("/login");
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/demo/start")),
      page.getByTestId("demo-sign-in-button").click(),
    ]);
    expect(response.status()).toBe(200);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    // Each demo session gets a unique user — verify the isDemo flag
    const isDemo = await page.evaluate(() => sessionStorage.getItem("isDemo"));
    expect(isDemo).toBe("true");
  });

  test("sessionStorage.isDemo flag is set after demo sign-in", async ({ page }) => {
    await page.goto("/login");
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/demo/start")),
      page.getByTestId("demo-sign-in-button").click(),
    ]);
    expect(response.status()).toBe(200);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    const isDemo = await page.evaluate(() => sessionStorage.getItem("isDemo"));
    expect(isDemo).toBe("true");
  });

  test("demo button shows error when endpoint returns non-OK", async ({ page }) => {
    await page.route("**/api/demo/start", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) }),
    );
    await page.goto("/login");
    await page.getByTestId("demo-sign-in-button").click();
    // The DemoButton renders a <p role="alert"> inside the card on error
    await expect(page.locator("main [role='alert']")).toBeVisible();
  });

  test("rate limit feedback shows appropriate message", async ({ page }) => {
    await page.route("**/api/demo/start", (route) =>
      route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "rate_limit_exceeded" }) }),
    );
    await page.goto("/login");
    await page.getByTestId("demo-sign-in-button").click();
    await expect(page.locator("main [role='alert']")).toContainText("wait");
  });

  test("demo banner is visible on dashboard", async ({ page }) => {
    await page.goto("/login");
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/demo/start")),
      page.getByTestId("demo-sign-in-button").click(),
    ]);
    expect(response.status()).toBe(200);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    await expect(page.getByTestId("demo-banner")).toContainText("demo session");
  });

  test("demo expired message shows on login page", async ({ page }) => {
    await page.goto("/login?demoExpired=true");
    await expect(page.getByText("Your demo session has ended")).toBeVisible();
  });
});
