import { test, expect } from "../fixtures/oauth-base";
import { apiUrl, TestEnv } from "../helpers/flows";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test.describe("session cookie identity format (AUTH_MODE=oauth)", () => {
  test("session cookie userId part is a UUID (not Google sub)", async ({ page }) => {
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === TestEnv.sessionCookieName);
    expect(sessionCookie, "auth setup must have planted the session cookie").toBeDefined();

    // Cookie format: <userId>.<hmac-sig> — extract the userId from before the last dot
    const lastDot = sessionCookie!.value.lastIndexOf(".");
    expect(lastDot).toBeGreaterThan(0);
    const cookieUserId = sessionCookie!.value.slice(0, lastDot);
    expect(cookieUserId).toMatch(UUID_PATTERN);
  });

  test("/settings returns a UUID as userId", async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === TestEnv.sessionCookieName);
    expect(sessionCookie, "auth setup must have planted the session cookie").toBeDefined();

    const res = await request.get(apiUrl("/settings"), {
      headers: { cookie: `${TestEnv.sessionCookieName}=${sessionCookie!.value}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.userId).toMatch(UUID_PATTERN);
  });

  test("userId in session cookie matches userId returned by /settings", async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === TestEnv.sessionCookieName);
    expect(sessionCookie, "auth setup must have planted the session cookie").toBeDefined();

    const lastDot = sessionCookie!.value.lastIndexOf(".");
    const cookieUserId = sessionCookie!.value.slice(0, lastDot);

    const res = await request.get(apiUrl("/settings"), {
      headers: { cookie: `${TestEnv.sessionCookieName}=${sessionCookie!.value}` },
    });
    expect(res.ok()).toBeTruthy();
    const settingsUserId = (await res.json()).userId;

    expect(settingsUserId).toBe(cookieUserId);
  });
});
