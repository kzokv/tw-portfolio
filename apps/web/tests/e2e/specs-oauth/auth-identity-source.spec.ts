import { test, expect } from "@tw-portfolio/test-e2e/fixtures/oauthBase";
import { TestEnv } from "@tw-portfolio/config/test";
import { apiUrl } from "@tw-portfolio/test-e2e/utils";

test.describe("session cookie as sole identity source (AUTH_MODE=oauth)", () => {
  test("x-authenticated-user-id header is ignored — session cookie determines identity", async ({
    page,
    request,
  }) => {
    // Auth setup has planted a session cookie via storageState.
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === TestEnv.sessionCookieName);
    expect(sessionCookie, "auth setup must have planted the session cookie").toBeDefined();

    // Extract the userId from the cookie (format: <userId>.<hmac-sig>)
    const lastDot = sessionCookie!.value.lastIndexOf(".");
    expect(lastDot).toBeGreaterThan(0);
    const sessionUserId = sessionCookie!.value.slice(0, lastDot);

    // Call /settings with the valid session cookie AND a spoofed x-authenticated-user-id header.
    // Before the fix, the header would override the session cookie identity.
    const res = await request.get(apiUrl("/settings"), {
      headers: {
        cookie: `${TestEnv.sessionCookieName}=${sessionCookie!.value}`,
        "x-authenticated-user-id": "evil-override",
      },
    });

    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    // The API must use the session cookie identity, not the header.
    expect(body.userId).toBe(sessionUserId);
    expect(body.userId).not.toBe("evil-override");
  });

  test("unauthenticated request with x-authenticated-user-id header returns 401", async ({
    request,
  }) => {
    // Send x-authenticated-user-id header WITHOUT a session cookie.
    // Before the fix, the API would trust this header and return 200 with user data.
    const res = await request.get(apiUrl("/settings"), {
      headers: {
        "x-authenticated-user-id": "user-1",
        // No session cookie — clear cookies by not including them
        cookie: "",
      },
    });

    expect(res.status()).toBe(401);
  });

  test("unauthenticated request without any identity headers returns 401", async ({ request }) => {
    // No cookies, no headers — should be a clean 401.
    const res = await request.get(apiUrl("/settings"), {
      headers: {
        cookie: "",
      },
    });

    expect(res.status()).toBe(401);
  });
});
