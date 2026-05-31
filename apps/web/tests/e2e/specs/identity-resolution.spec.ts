import { test, expect } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { apiUrl, extractCookieValue, makeDeterministicIdToken, parseSessionCookie, UUID_V4_PATTERN } from "@vakwen/test-e2e/utils";

test.describe("/__e2e/oauth-session identity resolution", () => {
  test("response userId is a UUID (not Google sub)", async ({ request }) => {
    const res = await request.post(apiUrl("/__e2e/oauth-session"));
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.userId).toMatch(UUID_V4_PATTERN);
    // userId is the internal app UUID, not the Google sub
    expect(body.userId).not.toBe(body.sub);
  });

  test("session cookie is signed with UUID, not Google sub", async ({ request }) => {
    const res = await request.post(apiUrl("/__e2e/oauth-session"));
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const setCookieHeader = res.headers()["set-cookie"] ?? "";
    const cookieValue = extractCookieValue(setCookieHeader, TestEnv.sessionCookieName);
    expect(cookieValue).toBeTruthy();
    const { userId: cookieUserId } = parseSessionCookie(cookieValue!);
    expect(cookieUserId).toBe(body.userId);
    expect(cookieUserId).not.toBe(body.sub);
  });

  test("same email resolves to same userId across sessions (idempotency)", async ({ request }) => {
    const uniqueSuffix = Date.now();
    const idToken = makeDeterministicIdToken({
      sub: `sub-idempotency-${uniqueSuffix}`,
      email: `idempotency-${uniqueSuffix}@e2e.local`,
      name: "Idempotency User",
    });
    const res1 = await request.post(apiUrl("/__e2e/oauth-session"), { data: { id_token: idToken } });
    const res2 = await request.post(apiUrl("/__e2e/oauth-session"), { data: { id_token: idToken } });
    expect(res1.ok()).toBeTruthy();
    expect(res2.ok()).toBeTruthy();
    const userId1 = (await res1.json()).userId;
    const userId2 = (await res2.json()).userId;
    expect(userId2).toBe(userId1);
  });

  test("different email creates a different userId (user isolation)", async ({ request }) => {
    const idToken1 = makeDeterministicIdToken({ sub: "sub-isolation-a", email: "user-a-isolation@e2e.local", name: "User A" });
    const idToken2 = makeDeterministicIdToken({ sub: "sub-isolation-b", email: "user-b-isolation@e2e.local", name: "User B" });
    const res1 = await request.post(apiUrl("/__e2e/oauth-session"), { data: { id_token: idToken1 } });
    const res2 = await request.post(apiUrl("/__e2e/oauth-session"), { data: { id_token: idToken2 } });
    expect(res1.ok()).toBeTruthy();
    expect(res2.ok()).toBeTruthy();
    const userId1 = (await res1.json()).userId;
    const userId2 = (await res2.json()).userId;
    expect(userId1).not.toBe(userId2);
  });

  test("two users with different emails access isolated settings via their session cookies", async ({
    request,
  }) => {
    const idToken1 = makeDeterministicIdToken({ sub: "sub-data-a", email: "data-user-a@e2e.local", name: "Data User A" });
    const idToken2 = makeDeterministicIdToken({ sub: "sub-data-b", email: "data-user-b@e2e.local", name: "Data User B" });

    const session1 = await request.post(apiUrl("/__e2e/oauth-session"), { data: { id_token: idToken1 } });
    const session2 = await request.post(apiUrl("/__e2e/oauth-session"), { data: { id_token: idToken2 } });
    expect(session1.ok()).toBeTruthy();
    expect(session2.ok()).toBeTruthy();

    const userId1 = (await session1.json()).userId;
    const userId2 = (await session2.json()).userId;
    expect(userId1).not.toBe(userId2);

    const cookie1 = extractCookieValue(session1.headers()["set-cookie"] ?? "", TestEnv.sessionCookieName)!;
    const cookie2 = extractCookieValue(session2.headers()["set-cookie"] ?? "", TestEnv.sessionCookieName)!;

    const settings1 = await request.get(apiUrl("/settings"), {
      headers: { cookie: `${TestEnv.sessionCookieName}=${cookie1}` },
    });
    const settings2 = await request.get(apiUrl("/settings"), {
      headers: { cookie: `${TestEnv.sessionCookieName}=${cookie2}` },
    });

    expect(settings1.ok()).toBeTruthy();
    expect(settings2.ok()).toBeTruthy();
    expect((await settings1.json()).userId).toBe(userId1);
    expect((await settings2.json()).userId).toBe(userId2);
  });
});

test.describe("session persistence", () => {
  test("session from /__e2e/oauth-session remains active across page reload", async ({ page, request }) => {
    await page.context().clearCookies();

    const res = await request.post(apiUrl("/__e2e/oauth-session"));
    expect(res.ok()).toBeTruthy();

    const setCookieHeader = res.headers()["set-cookie"] ?? "";
    const cookieValue = extractCookieValue(setCookieHeader, TestEnv.sessionCookieName)!;
    const cookieName = TestEnv.sessionCookieName;

    await page.context().addCookies([
      {
        name: cookieName,
        value: cookieValue,
        domain: TestEnv.host,
        path: "/",
        httpOnly: true,
        secure: cookieName.startsWith("__Host-"),
        sameSite: "Lax",
      },
    ]);

    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });

    // Reload — the HMAC-signed session cookie should still be accepted
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });
  });
});
