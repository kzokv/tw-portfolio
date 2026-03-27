import { test, expect } from "@tw-portfolio/test-e2e/fixtures/oauthBase";
import { TestEnv } from "@tw-portfolio/config/test";
import { apiUrl, parseSessionCookie, UUID_V4_PATTERN } from "@tw-portfolio/test-e2e/utils";

test.describe("session cookie identity format (AUTH_MODE=oauth)", () => {
  test("session cookie userId part is a UUID (not Google sub)", async ({ page }) => {
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === TestEnv.sessionCookieName);
    expect(sessionCookie, "auth setup must have planted the session cookie").toBeDefined();

    const { userId: cookieUserId } = parseSessionCookie(sessionCookie!.value);
    expect(cookieUserId).toMatch(UUID_V4_PATTERN);
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
    expect(body.userId).toMatch(UUID_V4_PATTERN);
  });

  test("userId in session cookie matches userId returned by /settings", async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === TestEnv.sessionCookieName);
    expect(sessionCookie, "auth setup must have planted the session cookie").toBeDefined();

    const { userId: cookieUserId } = parseSessionCookie(sessionCookie!.value);

    const res = await request.get(apiUrl("/settings"), {
      headers: { cookie: `${TestEnv.sessionCookieName}=${sessionCookie!.value}` },
    });
    expect(res.ok()).toBeTruthy();
    const settingsUserId = (await res.json()).userId;

    expect(settingsUserId).toBe(cookieUserId);
  });
});
