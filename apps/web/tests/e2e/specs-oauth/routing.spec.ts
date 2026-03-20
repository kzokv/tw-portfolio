import { test, expect } from "@playwright/test";
import { apiUrl, extractCookieValue, TestEnv } from "../helpers/flows";

test.describe("route redirects", () => {
  // N1: signed-in user hits / → URL becomes /dashboard
  test("signed-in user at / is redirected to /dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  // N2: signed-in user hits /dashboard → dashboard shell renders
  test("signed-in user at /dashboard loads dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });
  });

  // N3: unauthenticated /transactions → /login?returnTo=%2Ftransactions
  test("unauthenticated /transactions redirects to /login with returnTo", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Ftransactions/, { timeout: 10_000 });
  });

  // N4: unauthenticated /portfolio → /login?returnTo=%2Fportfolio
  test("unauthenticated /portfolio redirects to /login with returnTo", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/portfolio");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fportfolio/, { timeout: 10_000 });
  });

  // N3b: unauthenticated /login does NOT produce returnTo=%2Flogin (loop prevention)
  test("unauthenticated /login does not produce returnTo loop", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
    // Must NOT have returnTo=%2Flogin in the URL
    await expect(page).not.toHaveURL(/returnTo/);
    await expect(page.getByTestId("google-sign-in-button")).toBeVisible();
  });

  // N5: /login?returnTo=/transactions → sign-in button href includes returnTo
  test("login page threads returnTo to sign-in button", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login?returnTo=/transactions");
    const href = await page.getByTestId("google-sign-in-button").getAttribute("href");
    expect(href).toContain("returnTo");
    expect(href).toContain("%2Ftransactions");
  });
});

test.describe("session expired", () => {
  // N14: /auth/error?reason=session_expired renders correct title + description
  test("session_expired error page renders correct content", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/auth/error?reason=session_expired");
    await expect(page.getByText("Your session has expired")).toBeVisible();
    await expect(page.getByText("Please sign in again to continue.")).toBeVisible();
  });

  // N15: session expired page has "Sign in again" link to /login
  test("session_expired page has sign-in-again link", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/auth/error?reason=session_expired");
    const link = page.getByTestId("auth-error-try-again");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/login");
    await expect(link).toContainText("Sign in again");
  });
});

test.describe("avatar dropdown menu", () => {
  // N11: avatar dropdown renders with "Settings" and "Sign out"
  test("avatar dropdown shows Settings and Sign out items", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });
    await page.getByTestId("avatar-button").click();
    await expect(page.getByTestId("avatar-menu-settings")).toBeVisible();
    await expect(page.getByTestId("avatar-menu-sign-out")).toBeVisible();
  });

  // N12: clicking "Sign out" → session cleared → toHaveURL(/\/login/)
  test("clicking Sign out clears session and redirects to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });
    await page.getByTestId("avatar-button").click();

    // Sign out navigates to the API logout endpoint via <a> href (uses TestEnv.host for cookie domain)
    await page.getByTestId("avatar-menu-sign-out").click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  // N13: after sign-out, navigating to /dashboard → /login
  test("after sign-out, /dashboard redirects to /login", async ({ page }) => {
    // Sign out first via direct API navigation (uses TestEnv.host so cookie is cleared on correct domain).
    // Cross-port 302 may ERR_ABORTED in Playwright; catch and let the URL assertion verify.
    await page.goto(`http://${TestEnv.host}:${TestEnv.ports.api}/auth/logout`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    // Try accessing /dashboard — should redirect to /login
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});

test.describe("returnTo roundtrip", () => {
  // N8: full OAuth roundtrip: unauthenticated /transactions → full OAuth → lands on /transactions
  // FIXME: Depends on mock OAuth server (started by playwright.config.ts / dev_bypass suite).
  // Adding the mock server to playwright.oauth.config.ts webServer causes ERR_ABORTED in other
  // oauth tests. When the dev_bypass suite doesn't run first (or its mock server has shut down),
  // the API's token exchange fails → oauth_error/server_error. Needs a dedicated mock server
  // lifecycle solution (per-suite fixture or shared server with health-check gate).
  test.fixme("full returnTo roundtrip through OAuth", async ({ page, request }) => {
    // 1. Unauthenticated → /transactions redirects to /login?returnTo=%2Ftransactions
    await page.context().clearCookies();
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Ftransactions/, { timeout: 10_000 });

    // 2. Get the sign-in button href (contains returnTo in the API start URL)
    const href = await page.getByTestId("google-sign-in-button").getAttribute("href");
    expect(href).toContain("returnTo");

    // 3. Start OAuth flow via API to get a state with returnTo encoded in it
    const startRes = await request.get(apiUrl("/auth/google/start?returnTo=/transactions"), { maxRedirects: 0 });
    const state = new URL(startRes.headers()["location"]).searchParams.get("state")!;

    // 4. Complete callback via API request context (not browser navigation).
    //
    // Browsers reject __Host- prefixed cookies over plain HTTP (the prefix requires HTTPS),
    // so page.goto(callbackUrl) would silently drop the session cookie and the subsequent
    // navigation to /transactions would bounce back to /login.
    //
    // Using request.get bypasses browser cookie enforcement: we capture the Set-Cookie
    // header directly from the 302 response, plant it manually, then verify the browser
    // session works.
    //
    // Note: requires the mock OAuth server (started by playwright.config.ts / dev_bypass
    // suite) to be running so the API can exchange code=e2e-auth-code via GOOGLE_TOKEN_URL.
    const callbackRes = await request.get(
      `http://${TestEnv.host}:${TestEnv.ports.api}/auth/google/callback?code=e2e-auth-code&state=${encodeURIComponent(state)}`,
      { maxRedirects: 0 },
    );
    expect(callbackRes.status()).toBe(302);
    const location = callbackRes.headers()["location"];
    expect(location).toMatch(/\/transactions/);

    // 5. Extract the session cookie from the callback response and plant it in the browser
    // context, then navigate to /transactions to verify the full session roundtrip.
    const setCookie = callbackRes.headers()["set-cookie"] ?? "";
    const cookieValue = extractCookieValue(setCookie, TestEnv.sessionCookieName);
    expect(cookieValue).toBeTruthy();

    await page.context().addCookies([
      {
        name: TestEnv.sessionCookieName,
        value: cookieValue!,
        domain: TestEnv.host,
        path: "/",
        httpOnly: true,
        secure: TestEnv.sessionCookieName.startsWith("__Host-"),
        sameSite: "Lax",
      },
    ]);

    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/transactions/, { timeout: 10_000 });
  });
});
