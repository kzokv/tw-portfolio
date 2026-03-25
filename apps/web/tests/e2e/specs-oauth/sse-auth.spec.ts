import { test, expect } from "@playwright/test";
import { apiUrl } from "../helpers/flows";

test.describe("SSE with OAuth session auth", () => {
  test("EventSource receives heartbeat with session cookie auth", async ({ page }) => {
    // The storageState from auth.setup.ts provides a valid session cookie.
    // Navigate to confirm authenticated state.
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);

    const sseUrl = apiUrl("/events/stream");

    // Open EventSource with withCredentials (sends session cookie)
    const result = await page.evaluate(async (url) => {
      return new Promise<{
        connected: boolean;
        heartbeatReceived: boolean;
        eventId: string;
      }>((resolve) => {
        const es = new EventSource(url, { withCredentials: true });
        const timeout = setTimeout(() => {
          es.close();
          resolve({ connected: false, heartbeatReceived: false, eventId: "" });
        }, 15_000);

        es.addEventListener("heartbeat", (e) => {
          clearTimeout(timeout);
          es.close();
          resolve({
            connected: true,
            heartbeatReceived: true,
            eventId: e.lastEventId,
          });
        });

        es.onerror = () => {
          clearTimeout(timeout);
          es.close();
          resolve({ connected: false, heartbeatReceived: false, eventId: "" });
        };
      });
    }, sseUrl);

    expect(result.connected).toBe(true);
    expect(result.heartbeatReceived).toBe(true);
    // seq is per-user and shared across connections — the page's own useEventStream
    // connection (opened on page.goto) consumes at least seq=1, so this connection's
    // heartbeat will have seq >= 1 (not necessarily exactly 1)
    expect(parseInt(result.eventId)).toBeGreaterThanOrEqual(1);
  });

  test("synthetic endpoint delivers event via SSE with oauth session", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);

    const sseUrl = apiUrl("/events/stream");

    // Open EventSource listening for recompute_complete
    const eventPromise = page.evaluate(async (url) => {
      return new Promise<{ received: boolean; data: unknown; eventType: string }>((resolve) => {
        const es = new EventSource(url, { withCredentials: true });
        const timeout = setTimeout(() => {
          es.close();
          resolve({ received: false, data: null, eventType: "" });
        }, 15_000);

        es.addEventListener("recompute_complete", (e) => {
          clearTimeout(timeout);
          es.close();
          resolve({
            received: true,
            data: JSON.parse(e.data),
            eventType: "recompute_complete",
          });
        });
      });
    }, sseUrl);

    // Give EventSource time to establish connection
    await page.waitForTimeout(1000);

    // Publish via synthetic endpoint (uses same session cookie for auth)
    const publishRes = await request.post(apiUrl("/__test/publish-event"), {
      headers: { "content-type": "application/json" },
      data: {
        type: "recompute_complete",
        data: { portfolioId: "oauth-e2e-test" },
      },
    });
    expect(publishRes.ok()).toBeTruthy();

    const result = await eventPromise;
    expect(result.received).toBe(true);
    expect(result.data).toEqual({ portfolioId: "oauth-e2e-test" });
    expect(result.eventType).toBe("recompute_complete");
  });
});
