import { test, expect } from "../fixtures/test";
import { apiUrl } from "../helpers/flows";

test.describe("SSE event delivery", () => {
  test("synthetic endpoint publishes event and EventSource receives it", async ({ page, request, e2eUserId }) => {
    // Navigate to ensure app is ready (establishes cookies)
    await page.goto("/transactions", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("domcontentloaded");

    const sseUrl = apiUrl("/events/stream");

    // Open EventSource in the browser and listen for the target event type
    const eventPromise = page.evaluate(
      async ({ url }) => {
        return new Promise<{ received: boolean; data: unknown; eventId: string | null }>((resolve) => {
          const es = new EventSource(url, { withCredentials: true });
          const timeout = setTimeout(() => {
            es.close();
            resolve({ received: false, data: null, eventId: null });
          }, 10_000);

          es.addEventListener("recompute_complete", (e) => {
            clearTimeout(timeout);
            const data = JSON.parse(e.data);
            es.close();
            resolve({ received: true, data, eventId: e.lastEventId });
          });
        });
      },
      { url: sseUrl },
    );

    // Give EventSource a moment to connect and receive initial heartbeat
    await page.waitForTimeout(500);

    // Publish event via synthetic endpoint using the E2E user
    const publishRes = await request.post(apiUrl("/__test/publish-event"), {
      headers: {
        "content-type": "application/json",
        "x-user-id": e2eUserId,
      },
      data: {
        type: "recompute_complete",
        data: { portfolioId: "e2e-test-portfolio" },
      },
    });
    expect(publishRes.ok()).toBeTruthy();

    // Wait for the EventSource to receive the event
    const result = await eventPromise;
    expect(result.received).toBe(true);
    expect(result.data).toEqual({ portfolioId: "e2e-test-portfolio" });
    expect(result.eventId).toBeTruthy();
  });

  test("EventSource receives initial heartbeat on connection", async ({ page }) => {
    await page.goto("/transactions", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("domcontentloaded");

    const sseUrl = apiUrl("/events/stream");

    const result = await page.evaluate(async (url) => {
      return new Promise<{ event: string; data: string; id: string }>((resolve) => {
        const es = new EventSource(url, { withCredentials: true });
        const timeout = setTimeout(() => {
          es.close();
          resolve({ event: "timeout", data: "", id: "" });
        }, 10_000);

        es.addEventListener("heartbeat", (e) => {
          clearTimeout(timeout);
          es.close();
          resolve({
            event: "heartbeat",
            data: e.data,
            id: e.lastEventId,
          });
        });
      });
    }, sseUrl);

    expect(result.event).toBe("heartbeat");
    expect(result.data).toBe("{}");
    expect(result.id).toBe("1");
  });
});
