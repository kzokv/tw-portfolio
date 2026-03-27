import { test, expect } from "@tw-portfolio/test-e2e/fixtures/oauthBase";
import { TestEnv } from "@tw-portfolio/config/test";
import { apiUrl, openSseProbe, waitForSseProbeResult } from "@tw-portfolio/test-e2e/utils";

test.describe("SSE with OAuth session auth", () => {
  test("EventSource receives heartbeat with session cookie auth", async ({ page }) => {
    // The storageState from auth.setup.ts provides a valid session cookie.
    // Navigate to confirm authenticated state.
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);

    const sseUrl = apiUrl("/events/stream");
    await openSseProbe(page, { url: sseUrl, targetEvent: "heartbeat", timeoutMs: 15_000 });
    const result = await waitForSseProbeResult(page, 15_000);

    expect(result.received).toBe(true);
    expect(result.event).toBe("heartbeat");
    // seq is per-user and shared across connections — the page's own useEventStream
    // connection (opened on page.goto) consumes at least seq=1, so this connection's
    // heartbeat will have seq >= 1 (not necessarily exactly 1)
    expect(parseInt(result.eventId ?? "0", 10)).toBeGreaterThanOrEqual(1);
  });

  test("synthetic endpoint delivers event via SSE with oauth session", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);

    const sseUrl = apiUrl("/events/stream");
    await openSseProbe(page, { url: sseUrl, targetEvent: "recompute_complete", timeoutMs: 15_000 });

    // Extract the session cookie from the page context to authenticate the publish request.
    // The request fixture has no cookie jar (per-test sessions are planted in page.context() only).
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === TestEnv.sessionCookieName);
    expect(sessionCookie, "oauth-base must have planted the session cookie").toBeDefined();

    // Publish via synthetic endpoint (uses same session cookie for auth)
    const publishRes = await request.post(apiUrl("/__test/publish-event"), {
      headers: {
        "content-type": "application/json",
        cookie: `${TestEnv.sessionCookieName}=${sessionCookie!.value}`,
      },
      data: {
        type: "recompute_complete",
        data: { portfolioId: "oauth-e2e-test" },
      },
    });
    expect(publishRes.ok()).toBeTruthy();

    const result = await waitForSseProbeResult(page, 15_000);
    expect(result.received).toBe(true);
    expect(result.data).toEqual({ portfolioId: "oauth-e2e-test" });
    expect(result.event).toBe("recompute_complete");
  });
});
