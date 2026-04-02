import { TestEnv } from "@tw-portfolio/config/test";
import type { TSessionApiAssistant } from "@tw-portfolio/test-api/assistants";
import { test } from "../fixtures.js";

const repairEndpoint = new URL("/backfill/repair", TestEnv.apiBaseUrl).href;

async function createDemoCookieHeader(
  request: import("@playwright/test").APIRequestContext,
  sessionApi: TSessionApiAssistant,
): Promise<string> {
  const response = await request.post(new URL("/__e2e/demo-session", TestEnv.apiBaseUrl).href);
  await sessionApi.assert.statusIs(response, 200);
  return sessionApi.arrange.sessionCookieHeader(response);
}

test.describe("POST /backfill/repair", () => {
  test("request validation: rejects empty ticker list", async ({ request, testUser, settingsApi }) => {
    const response = await request.post(repairEndpoint, {
      headers: { cookie: testUser.sessionCookie ?? "" },
      data: { tickers: [] },
    });

    await settingsApi.assert.statusIs(response, 400);
  });

  test("request validation: rejects more than 20 tickers", async ({ request, testUser, settingsApi }) => {
    const tickers = Array.from({ length: 21 }, (_, idx) => `T${String(idx).padStart(3, "0")}`);
    const response = await request.post(repairEndpoint, {
      headers: { cookie: testUser.sessionCookie ?? "" },
      data: { tickers },
    });

    await settingsApi.assert.statusIs(response, 400);
  });

  test("request validation: rejects when includeBars and includeDividends are both false", async ({
    request,
    testUser,
    settingsApi,
  }) => {
    const response = await request.post(repairEndpoint, {
      headers: { cookie: testUser.sessionCookie ?? "" },
      data: {
        tickers: ["2330"],
        includeBars: false,
        includeDividends: false,
      },
    });

    await settingsApi.assert.statusIs(response, 400);
  });

  test("request validation: rejects malformed date format", async ({ request, testUser, settingsApi }) => {
    const response = await request.post(repairEndpoint, {
      headers: { cookie: testUser.sessionCookie ?? "" },
      data: {
        tickers: ["2330"],
        startDate: "2026/01/01",
      },
    });

    await settingsApi.assert.statusIs(response, 400);
  });

  test("request validation: rejects startDate > endDate", async ({ request, testUser, settingsApi }) => {
    const response = await request.post(repairEndpoint, {
      headers: { cookie: testUser.sessionCookie ?? "" },
      data: {
        tickers: ["2330"],
        startDate: "2026-04-02",
        endDate: "2026-04-01",
      },
    });

    await settingsApi.assert.statusIs(response, 400);
  });

  test("authorization: demo user is rejected with 403", async ({ request, sessionApi, settingsApi }) => {
    const demoCookie = await createDemoCookieHeader(request, sessionApi);
    const response = await request.post(repairEndpoint, {
      headers: { cookie: demoCookie },
      data: { tickers: ["2330"] },
    });

    await settingsApi.assert.statusIs(response, 403);
    const body = await settingsApi.arrange.body(response) as Record<string, unknown>;
    await settingsApi.assert.errorEquals(body, "demo_restricted");
  });

  test("queue guard: returns 503 when queue is unavailable in memory mode", async ({ request, testUser, settingsApi }) => {
    const response = await request.post(repairEndpoint, {
      headers: { cookie: testUser.sessionCookie ?? "" },
      data: {
        tickers: ["2330"],
        includeBars: true,
        includeDividends: true,
      },
    });

    await settingsApi.assert.statusIs(response, 503);
    const body = await settingsApi.arrange.body(response) as Record<string, unknown>;
    await settingsApi.assert.errorEquals(body, "queue_unavailable");
  });
});
