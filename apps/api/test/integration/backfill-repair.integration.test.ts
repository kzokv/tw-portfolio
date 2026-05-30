import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";

const testOAuthConfig: GoogleOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

let app: Awaited<ReturnType<typeof buildApp>>;

async function createSessionCookieHeader(): Promise<string> {
  const sessionResponse = await app.inject({
    method: "POST",
    url: "/__e2e/oauth-session",
  });
  expect(sessionResponse.statusCode).toBe(200);
  const setCookie = sessionResponse.headers["set-cookie"];
  if (!setCookie) {
    throw new Error("Missing Set-Cookie header from /__e2e/oauth-session");
  }
  return Array.isArray(setCookie) ? setCookie[0]!.split(";")[0]! : setCookie.split(";")[0]!;
}

function seedInstrument(instrument: {
  ticker: string;
  name: string;
  instrumentType: string | null;
  marketCode: string;
  barsBackfillStatus: string;
  lastRepairAt?: string;
}): void {
  (app.persistence as MemoryPersistence)._seedInstrument(instrument);
}

describe("POST /backfill/repair (integration, memory mode)", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns partial success payload when some tickers are rejected by status gate", async () => {
    const cookie = await createSessionCookieHeader();
    seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    seedInstrument({
      ticker: "2317",
      name: "Hon Hai",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "backfilling",
    });

    const send = vi.fn().mockResolvedValue(undefined);
    (app as unknown as { boss: { send: (...args: unknown[]) => Promise<void> } }).boss = { send };

    const response = await app.inject({
      method: "POST",
      url: "/backfill/repair",
      headers: { cookie },
      payload: {
        tickers: ["2330", "2317"],
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      queued: ["2330"],
      rejected: [{ ticker: "2317", reason: "status_backfilling" }],
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("enqueue payload includes trigger=repair with per-ticker options", async () => {
    const cookie = await createSessionCookieHeader();
    seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });

    const send = vi.fn().mockResolvedValue(undefined);
    (app as unknown as { boss: { send: (...args: unknown[]) => Promise<void> } }).boss = { send };

    const response = await app.inject({
      method: "POST",
      url: "/backfill/repair",
      headers: { cookie },
      payload: {
        tickers: ["2330"],
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        includeBars: false,
        includeDividends: true,
      },
    });

    expect(response.statusCode).toBe(200);
    // KZO-169: backfill payload now stamps marketCode (resolved from the
    // persisted instrument) and the singletonKey is composite.
    expect(send).toHaveBeenCalledWith(
      "finmind-backfill",
      {
        ticker: "2330",
        marketCode: "TW",
        userId: expect.any(String),
        trigger: "repair",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        includeBars: false,
        includeDividends: true,
      },
      { singletonKey: "2330:TW", priority: 5 },
    );
  });

  it("rejects a ticker within cooldown window using last_repair_at", async () => {
    const cookie = await createSessionCookieHeader();
    seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
      lastRepairAt: new Date().toISOString(),
    });

    const send = vi.fn().mockResolvedValue(undefined);
    (app as unknown as { boss: { send: (...args: unknown[]) => Promise<void> } }).boss = { send };

    const response = await app.inject({
      method: "POST",
      url: "/backfill/repair",
      headers: { cookie },
      payload: { tickers: ["2330"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().queued).toEqual([]);
    expect(response.json().rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticker: "2330",
          reason: expect.stringMatching(/cooldown/i),
        }),
      ]),
    );
    expect(send).not.toHaveBeenCalled();
  });
});
