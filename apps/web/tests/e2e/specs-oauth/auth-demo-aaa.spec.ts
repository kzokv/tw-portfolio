import { E2E_ENDPOINTS } from "@vakwen/test-e2e/constants";
import { test } from "@vakwen/test-e2e/fixtures/authPages";
import { apiUrl } from "@vakwen/test-e2e/utils";

// Demo tests start from the login page without an existing session.
// Uses noAuthBase fixture (no dev-bypass auth setup, no OAuth cookie).
// ⚠️ This file makes 5 real POST /auth/demo/start calls, exhausting the 5/60s
// demo rate bucket. Tests in other spec files that need a demo session must use
// the demoBase fixture (fixtures/demoBase) to avoid 429 failures.

test.describe("Demo user flow", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(apiUrl(E2E_ENDPOINTS.RESET_DEMO_RATE_BUCKETS));
  });

  test("click demo button creates session and lands on /dashboard", async ({ dashboard, login }) => {
    await login.actions.navigateToLogin();
    await login.assert.demoSignInButtonIsVisible();
    await login.actions.clickDemoSignIn();
    await login.actions.waitForDashboard();
    await dashboard.assert.isOnDashboard();
  });

  test("demo user reaches dashboard with valid session", async ({ dashboard, login }) => {
    await login.actions.navigateToLogin();
    await login.assert.demoSignInButtonIsVisible();
    await login.actions.clickDemoSignIn();
    await login.actions.waitForDashboard();
    await dashboard.assert.demoBannerIsVisible();
  });

  test("demo data is isolated — each session gets unique user", async ({ login, session }) => {
    await login.actions.navigateToLogin();
    await login.assert.demoSignInButtonIsVisible();
    await login.actions.clickDemoSignIn();
    await login.actions.waitForDashboard();
    const isDemo = await session.arrange.sessionStorageValue("isDemo");
    await session.assert.sessionStorageValueIs(isDemo, "true");
  });

  test("sessionStorage.isDemo flag is set after demo sign-in", async ({ login, session }) => {
    await login.actions.navigateToLogin();
    await login.assert.demoSignInButtonIsVisible();
    await login.actions.clickDemoSignIn();
    await login.actions.waitForDashboard();
    const isDemo = await session.arrange.sessionStorageValue("isDemo");
    await session.assert.sessionStorageValueIs(isDemo, "true");
  });

  test("demo button shows error when endpoint returns non-OK", async ({ login }) => {
    await login.arrange.stubDemoStartResponse(404, "not_found");
    await login.actions.navigateToLogin();
    await login.assert.demoSignInButtonIsVisible();
    const response = await login.actions.waitForDemoStartResponse(
      () => login.actions.clickDemoSignIn(),
    );
    await response.finished();
    await login.assert.errorAlertIsVisible();
  });

  test("rate limit feedback shows appropriate message", async ({ login }) => {
    await login.arrange.stubDemoStartResponse(429, "rate_limit_exceeded");
    await login.actions.navigateToLogin();
    await login.assert.demoSignInButtonIsVisible();
    const response = await login.actions.waitForDemoStartResponse(
      () => login.actions.clickDemoSignIn(),
    );
    await response.finished();
    await login.assert.errorAlertContains("wait");
  });

  test("demo banner is visible on dashboard", async ({ dashboard, login }) => {
    await login.actions.navigateToLogin();
    await login.assert.demoSignInButtonIsVisible();
    await login.actions.clickDemoSignIn();
    await login.actions.waitForDashboard();
    await dashboard.assert.demoBannerIsVisible();
    await dashboard.assert.demoBannerContains("demo session");
  });

  test("demo expired message shows on login page", async ({ login }) => {
    await login.actions.navigateToLoginWithQuery("?demoExpired=true");
    await login.assert.demoExpiredMessageIsVisible();
  });
});
