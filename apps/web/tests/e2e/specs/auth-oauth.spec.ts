import { test, expect } from "@playwright/test";
import { apiUrl } from "../helpers/flows";
import { TestEnv } from "@tw-portfolio/config/test";

test.describe("login page", () => {
  test("renders with sign-in button visible", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("google-sign-in-button")).toBeVisible();
  });

  test("sign-in button links to OAuth start", async ({ page }) => {
    await page.goto("/login");
    const button = page.getByTestId("google-sign-in-button");
    const href = await button.getAttribute("href");
    expect(href).toContain("/auth/google/start");
  });

  test("clicking sign-in button redirects browser to Google OAuth", async ({ page }) => {
    await page.goto("/login");

    // Intercept the OAuth start navigation to prevent leaving the test environment
    let navigatedUrl = "";
    await page.route("**/auth/google/start**", async (route) => {
      navigatedUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: "text/html", body: "" });
    });

    await page.getByTestId("google-sign-in-button").click();
    await page.waitForURL((url) => url.href.includes("/auth/google/start"));

    expect(navigatedUrl).toContain("/auth/google/start");
  });
});

test.describe("GET /auth/google/start", () => {
  test("redirects to Google authorization endpoint", async ({ request }) => {
    const res = await request.get(apiUrl("/auth/google/start"), { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = res.headers()["location"];
    expect(location).toMatch(/accounts\.google\.com/);
  });

  test("redirect URL includes required OAuth parameters with prompt=select_account", async ({ request }) => {
    const res = await request.get(apiUrl("/auth/google/start"), { maxRedirects: 0 });
    const location = new URL(res.headers()["location"]);
    expect(location.searchParams.get("client_id")).toBe("e2e-test-client-id");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("prompt")).toBe("select_account");
  });

  test("each call generates a unique state to prevent replay", async ({ request }) => {
    const res1 = await request.get(apiUrl("/auth/google/start"), { maxRedirects: 0 });
    const res2 = await request.get(apiUrl("/auth/google/start"), { maxRedirects: 0 });
    const state1 = new URL(res1.headers()["location"]).searchParams.get("state");
    const state2 = new URL(res2.headers()["location"]).searchParams.get("state");
    expect(state1).toBeTruthy();
    expect(state2).toBeTruthy();
    expect(state1).not.toBe(state2);
  });
});

test.describe("GET /auth/google/callback", () => {
  test(`signup flow sets ${TestEnv.sessionCookieName} cookie and redirects to app`, async ({ request }) => {
    const startRes = await request.get(apiUrl("/auth/google/start"), { maxRedirects: 0 });
    const state = new URL(startRes.headers()["location"]).searchParams.get("state")!;

    const res = await request.get(
      apiUrl(`/auth/google/callback?code=e2e-auth-code&state=${encodeURIComponent(state)}`),
      { maxRedirects: 0 },
    );

    expect(res.status()).toBe(302);
    const setCookie = res.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain(`${TestEnv.sessionCookieName}=`);
    expect(setCookie).toContain("HttpOnly");
  });

  test(`login flow sets ${TestEnv.sessionCookieName} cookie and redirects (same as signup)`, async ({ request }) => {
    const startRes = await request.get(apiUrl("/auth/google/start"), { maxRedirects: 0 });
    const state = new URL(startRes.headers()["location"]).searchParams.get("state")!;

    const res = await request.get(
      apiUrl(`/auth/google/callback?code=e2e-auth-code&state=${encodeURIComponent(state)}`),
      { maxRedirects: 0 },
    );

    expect(res.status()).toBe(302);
    expect(res.headers()["set-cookie"] ?? "").toContain(`${TestEnv.sessionCookieName}=`);
  });

  test("missing state redirects to /auth/error?reason=invalid_state", async ({ request }) => {
    const res = await request.get(apiUrl("/auth/google/callback?code=e2e-auth-code"), { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toContain("/auth/error?reason=invalid_state");
  });

  test("tampered state redirects to /auth/error?reason=invalid_state", async ({ request }) => {
    const startRes = await request.get(apiUrl("/auth/google/start"), { maxRedirects: 0 });
    const state = new URL(startRes.headers()["location"]).searchParams.get("state")!;
    const [nonce] = state.split(".");
    const tamperedState = `${nonce}.badhmacsignature`;

    const res = await request.get(
      apiUrl(`/auth/google/callback?code=e2e-auth-code&state=${encodeURIComponent(tamperedState)}`),
      { maxRedirects: 0 },
    );

    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toContain("/auth/error?reason=invalid_state");
  });

  test("provider error param redirects to /auth/error?reason=oauth_error", async ({ request }) => {
    const res = await request.get(
      apiUrl("/auth/google/callback?error=access_denied&state=irrelevant"),
      { maxRedirects: 0 },
    );
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toContain("/auth/error?reason=oauth_error");
  });
});

test.describe("POST /auth/token/refresh", () => {
  test("exchanges refresh token and returns new access token", async ({ request }) => {
    const res = await request.post(apiUrl("/auth/token/refresh"), {
      data: { refreshToken: "mock-e2e-refresh-token" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBeDefined();
    expect(body.expiresIn).toBeDefined();
  });

  test("missing refreshToken field returns 400", async ({ request }) => {
    const res = await request.post(apiUrl("/auth/token/refresh"), {
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("401 session expiry", () => {
  test("API 401 response redirects browser to /login without error banner", async ({ page }) => {
    await page.route("**/dashboard/overview**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "authentication required" }),
      }),
    );
    await page.route("**/auth/logout**", (route) =>
      route.fulfill({
        status: 302,
        headers: { location: "/login" },
      }),
    );
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByTestId("global-error-banner")).toBeHidden();
  });
});

test.describe("full browser OAuth flow", () => {
  test(`OAuth callback sets ${TestEnv.sessionCookieName} cookie and redirects browser to app root`, async ({ page, request }) => {
    // Get a valid CSRF state from the API (same as what Google would receive)
    const startRes = await request.get(apiUrl("/auth/google/start"), { maxRedirects: 0 });
    const state = new URL(startRes.headers()["location"]).searchParams.get("state")!;

    // Navigate the browser directly to the callback URL, simulating Google's redirect
    await page.goto(
      apiUrl(`/auth/google/callback?code=e2e-auth-code&state=${encodeURIComponent(state)}`),
      { waitUntil: "domcontentloaded" },
    );
    await expect(page).toHaveURL("/", { timeout: 10_000 });

    // The API sets an HttpOnly session cookie — verify it was received
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === TestEnv.sessionCookieName);
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
  });
});

test.describe("callback error page (browser)", () => {
  test("missing state lands on /auth/error with invalid_state reason", async ({ page }) => {
    await page.goto(
      apiUrl("/auth/google/callback?code=e2e-auth-code"),
      { waitUntil: "domcontentloaded" },
    );
    await expect(page).toHaveURL(/\/auth\/error\?reason=invalid_state/, { timeout: 10_000 });
  });

  test("tampered state lands on /auth/error with invalid_state reason", async ({ page, request: apiRequest }) => {
    const startRes = await apiRequest.get(apiUrl("/auth/google/start"), { maxRedirects: 0 });
    const state = new URL(startRes.headers()["location"]).searchParams.get("state")!;
    const [nonce] = state.split(".");
    const tamperedState = `${nonce}.badhmacsignature`;

    await page.goto(
      apiUrl(`/auth/google/callback?code=e2e-auth-code&state=${encodeURIComponent(tamperedState)}`),
      { waitUntil: "domcontentloaded" },
    );
    await expect(page).toHaveURL(/\/auth\/error\?reason=invalid_state/, { timeout: 10_000 });
  });

  test("provider error param lands on /auth/error with oauth_error reason", async ({ page }) => {
    await page.goto(
      apiUrl("/auth/google/callback?error=access_denied&state=irrelevant"),
      { waitUntil: "domcontentloaded" },
    );
    await expect(page).toHaveURL(/\/auth\/error\?reason=oauth_error/, { timeout: 10_000 });
  });

  test("error page renders try-again link to /login", async ({ page }) => {
    await page.goto("/auth/error?reason=oauth_error");
    await expect(page.getByTestId("auth-error-try-again")).toBeVisible();
    await expect(page.getByTestId("auth-error-try-again")).toHaveAttribute("href", "/login");
  });
});
