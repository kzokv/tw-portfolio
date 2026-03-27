import { test, expect } from "@tw-portfolio/test-e2e/fixtures/base";
import { apiUrl, openSseProbe, waitForSseProbeResult } from "@tw-portfolio/test-e2e/utils";

test.describe("SSE event delivery", () => {
  test("synthetic endpoint publishes event and EventSource receives it", async ({ page, request, e2eUserId, testUser }) => {
    void testUser;
    // Use the lightest authenticated route; the SSE check itself is the subject under test.
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const sseUrl = apiUrl("/events/stream");
    await openSseProbe(page, { url: sseUrl, targetEvent: "recompute_complete" });

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
    const result = await waitForSseProbeResult(page);
    expect(result.received).toBe(true);
    expect(result.data).toEqual({ portfolioId: "e2e-test-portfolio" });
    expect(result.eventId).toBeTruthy();
  });

  test("EventSource receives initial heartbeat on connection", async ({ page, testUser }) => {
    void testUser;
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const sseUrl = apiUrl("/events/stream");
    await openSseProbe(page, { url: sseUrl, targetEvent: "heartbeat" });
    const result = await waitForSseProbeResult(page);
    expect(result.event).toBe("heartbeat");
    expect(result.data).toBe("{}");
    expect(parseInt(result.eventId ?? "0", 10)).toBeGreaterThanOrEqual(1);
  });
});
