import { test, expect } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { apiUrl, extractCookieValue } from "@tw-portfolio/test-e2e/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeFakeIdToken(sub: string, email: string, name: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      email,
      email_verified: true,
      name,
      iss: "https://accounts.google.com",
      aud: "e2e-test-client-id",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  return `${header}.${payload}.mock-sig`;
}

test.describe("/__e2e/oauth-session identity resolution", () => {
  test("response userId is a UUID (not Google sub)", async ({ request }) => {
    const res = await request.post(apiUrl("/__e2e/oauth-session"));
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.userId).toMatch(UUID_PATTERN);
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
    // Cookie format: <userId>.<hmac-sig> — extract the userId from before the last dot
    const lastDot = cookieValue!.lastIndexOf(".");
    const cookieUserId = cookieValue!.slice(0, lastDot);
    expect(cookieUserId).toBe(body.userId);
    expect(cookieUserId).not.toBe(body.sub);
  });

  test("same email resolves to same userId across sessions (idempotency)", async ({ request }) => {
    const uniqueSuffix = Date.now();
    const idToken = makeFakeIdToken(
      `sub-idempotency-${uniqueSuffix}`,
      `idempotency-${uniqueSuffix}@e2e.local`,
      "Idempotency User",
    );
    const res1 = await request.post(apiUrl("/__e2e/oauth-session"), { data: { id_token: idToken } });
    const res2 = await request.post(apiUrl("/__e2e/oauth-session"), { data: { id_token: idToken } });
    expect(res1.ok()).toBeTruthy();
    expect(res2.ok()).toBeTruthy();
    const userId1 = (await res1.json()).userId;
    const userId2 = (await res2.json()).userId;
    expect(userId2).toBe(userId1);
  });

  test("different email creates a different userId (user isolation)", async ({ request }) => {
    const idToken1 = makeFakeIdToken("sub-isolation-a", "user-a-isolation@e2e.local", "User A");
    const idToken2 = makeFakeIdToken("sub-isolation-b", "user-b-isolation@e2e.local", "User B");
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
    const idToken1 = makeFakeIdToken("sub-data-a", "data-user-a@e2e.local", "Data User A");
    const idToken2 = makeFakeIdToken("sub-data-b", "data-user-b@e2e.local", "Data User B");

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
