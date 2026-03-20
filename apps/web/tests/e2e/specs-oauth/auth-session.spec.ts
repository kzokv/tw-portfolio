import { test, expect } from "@playwright/test";
import { apiUrl, extractCookieValue, TestEnv } from "../helpers/flows";

test.describe("authenticated session", () => {
  test("dashboard loads at /dashboard after root redirect", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard/);
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

    // Navigate to the real logout endpoint — clears session cookie and redirects to /login.
    // Cross-port 302 may ERR_ABORTED in Playwright; catch and let the URL assertion verify.
    await page.goto(`http://${TestEnv.host}:${TestEnv.ports.api}/auth/logout`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    // Subsequent navigation to / should redirect to /login via middleware
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  // NOTE: In-app logout via avatar dropdown is now tested in routing.spec.ts (N12).
});

test.describe("HMAC session cookie integrity", () => {
  test("tampered HMAC session cookie redirects to /auth/error?reason=session_expired", async ({ page }) => {
    // Retrieve a valid signed session cookie from the storage state
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === TestEnv.sessionCookieName);
    expect(sessionCookie).toBeDefined();

    const validValue = sessionCookie!.value;
    // Replace everything after the last dot with a bad signature
    const lastDot = validValue.lastIndexOf(".");
    expect(lastDot).toBeGreaterThan(0);
    const tamperedValue = `${validValue.slice(0, lastDot + 1)}badhmacsignature`;

    await page.context().clearCookies();
    await page.context().addCookies([
      {
        name: TestEnv.sessionCookieName,
        value: tamperedValue,
        domain: TestEnv.host,
        path: "/",
        httpOnly: true,
        secure: TestEnv.sessionCookieName.startsWith("__Host-"),
        sameSite: "Lax",
      },
    ]);

    await page.goto("/");
    await expect(page).toHaveURL(/\/auth\/error\?reason=session_expired/, { timeout: 15_000 });
  });

  test("plain sub without HMAC (old format) redirects to /auth/error?reason=session_expired", async ({ page }) => {
    // A bare sub value with no dot separator mimics the pre-HMAC cookie format.
    // verifySessionCookie rejects values without a dot, so the middleware treats this as invalid HMAC.
    await page.context().clearCookies();
    await page.context().addCookies([
      {
        name: TestEnv.sessionCookieName,
        value: "google-sub-001",
        domain: TestEnv.host,
        path: "/",
        httpOnly: true,
        secure: TestEnv.sessionCookieName.startsWith("__Host-"),
        sameSite: "Lax",
      },
    ]);

    await page.goto("/");
    await expect(page).toHaveURL(/\/auth\/error\?reason=session_expired/, { timeout: 15_000 });
  });
});

test.describe("/__e2e/oauth-session endpoint", () => {
  test("creates a working browser session", async ({ page, request }) => {
    // Clear any existing session so we start unauthenticated
    await page.context().clearCookies();

    // Call the e2e session endpoint to mint a fresh signed cookie
    const res = await request.post(apiUrl("/__e2e/oauth-session"));
    expect(res.ok()).toBeTruthy();

    // Extract the session cookie from the Set-Cookie header
    const setCookieHeader = res.headers()["set-cookie"] ?? "";
    const cookieName = TestEnv.sessionCookieName;
    expect(setCookieHeader).toContain(`${cookieName}=`);

    const cookieValue = extractCookieValue(setCookieHeader, cookieName);
    expect(cookieValue).toBeTruthy();

    // Plant the cookie in the browser context
    await page.context().addCookies([
      {
        name: cookieName,
        value: cookieValue!,
        domain: TestEnv.host,
        path: "/",
        httpOnly: true,
        secure: cookieName.startsWith("__Host-"),
        sameSite: "Lax",
      },
    ]);

    // Navigate to the app — should load the dashboard, not redirect to /login
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });
  });
});

test.describe("stateless session re-use after logout", () => {
  test("re-planted pre-logout cookie still grants access (stateless HMAC — no server-side revocation)", async ({ page }) => {
    // Confirm dashboard is accessible with the current session
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);

    // Capture the current session cookie value before logout
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === TestEnv.sessionCookieName);
    expect(sessionCookie).toBeDefined();
    const savedCookieValue = sessionCookie!.value;

    // Logout via the API endpoint — clears the cookie in the browser.
    // Cross-port 302 may ERR_ABORTED in Playwright; catch and let the URL assertion verify.
    await page.goto(`http://${TestEnv.host}:${TestEnv.ports.api}/auth/logout`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    // Re-plant the previously captured cookie value
    await page.context().addCookies([
      {
        name: TestEnv.sessionCookieName,
        value: savedCookieValue,
        domain: TestEnv.host,
        path: "/",
        httpOnly: true,
        secure: TestEnv.sessionCookieName.startsWith("__Host-"),
        sameSite: "Lax",
      },
    ]);

    // Navigate to the app — the cookie is still validly signed, so the session works.
    // This is expected behavior for stateless HMAC-signed sessions: the server has no
    // revocation list, so a validly signed cookie will always be accepted.
    // Server-side session revocation (e.g. a blocklist in Redis) would change this behavior.
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  });
});

test.describe("unknown sub handling", () => {
  test("valid HMAC signature but unknown sub does not crash the app", async ({ page, request }) => {
    // Use the /__e2e/oauth-session endpoint with a custom id_token containing an unknown sub.
    // The endpoint decodes the id_token payload to extract sub, then signs a cookie for it.
    const unknownSub = "unknown-sub-999";
    const payload = Buffer.from(
      JSON.stringify({
        sub: unknownSub,
        email: "unknown@example.com",
        email_verified: true,
        name: "Unknown User",
        iss: "https://accounts.google.com",
        aud: "e2e-test-client-id",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const fakeIdToken = `${header}.${payload}.mock-sig`;

    const res = await request.post(apiUrl("/__e2e/oauth-session"), {
      data: { id_token: fakeIdToken },
    });
    expect(res.ok()).toBeTruthy();

    // Extract and plant the cookie
    const setCookieHeader = res.headers()["set-cookie"] ?? "";
    const cookieName = TestEnv.sessionCookieName;
    const extractedCookieValue = extractCookieValue(setCookieHeader, cookieName);
    expect(extractedCookieValue).toBeTruthy();

    await page.context().clearCookies();
    await page.context().addCookies([
      {
        name: cookieName,
        value: extractedCookieValue!,
        domain: TestEnv.host,
        path: "/",
        httpOnly: true,
        secure: cookieName.startsWith("__Host-"),
        sameSite: "Lax",
      },
    ]);

    // Navigate — the app should handle a valid-but-unknown sub gracefully (no 500 crash)
    await page.goto("/");
    await expect(page.getByTestId("global-error-banner")).toBeHidden({ timeout: 10_000 });
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
