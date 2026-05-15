import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Env is frozen at module load from .env.local (AUTH_MODE=oauth). Override to dev_bypass so
// non-auth tests (TC-I1, TC-I3–TC-I5) don't get 401. Pattern: see sse.integration.test.ts.
vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "dev_bypass" as const },
  };
});

import { buildApp } from "../../src/app.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";

// Realistic TWSE fixture bars (same as unit test layer for cross-layer consistency)
const FIXTURE_BARS_2330 = [
  { ticker: "2330", barDate: "2026-03-28", open: 595, high: 600, low: 590, close: 598, volume: 25000000, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
  { ticker: "2330", barDate: "2026-03-27", open: 590, high: 596, low: 588, close: 595, volume: 22000000, source: "test", ingestedAt: "2026-03-27T18:00:00Z" },
];

const FIXTURE_BARS_2317 = [
  { ticker: "2317", barDate: "2026-03-28", open: 108, high: 110, low: 107, close: 109, volume: 15000000, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
];

// Used only for TC-I2 (auth enforcement test)
const testOAuthConfig: GoogleOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

let app: Awaited<ReturnType<typeof buildApp>>;

describe("GET /quotes", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("TC-I1: seed bars → 200 with enriched snapshot shape", async () => {
    (app.persistence as MemoryPersistence)._seedDailyBars([
      ...FIXTURE_BARS_2330,
      ...FIXTURE_BARS_2317,
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/quotes?tickers=2330,2317",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, Record<string, unknown> | null>;

    // 2330: 2 days → full derivation
    expect(body["2330"]).toMatchObject({
      close: 598,
      previousClose: 595,
      change: 3,
      asOf: "2026-03-28",
      source: "test",
    });
    expect(typeof body["2330"]!["changePercent"]).toBe("number");
    expect(typeof body["2330"]!["isProvisional"]).toBe("boolean");

    // 2317: 1 day → null derived fields
    expect(body["2317"]).toMatchObject({
      close: 109,
      previousClose: null,
      change: null,
      changePercent: null,
      asOf: "2026-03-28",
    });
  });

  it.skip("TC-I2: auth required — no session cookie → 401 (expects oauthConfig enforcement)", async () => {
    // Skipped at integration layer: AUTH_MODE is mocked to dev_bypass file-wide so TC-I1/3/4/5
    // work without needing session cookies. Auth enforcement requires resolveUserId to run in
    // oauth mode, which is tested at the HTTP layer (TC-H2 in quotes-aaa.http.spec.ts) where
    // the full OAuth stack is wired via the test server in oauth mode.
    const oauthApp = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: testOAuthConfig,
    });

    try {
      const response = await oauthApp.inject({
        method: "GET",
        url: "/quotes?tickers=2330",
        // No cookie / auth header
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await oauthApp.close();
    }
  });

  it("TC-I3: missing tickers param → 400", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/quotes",
    });

    expect(response.statusCode).toBe(400);
  });

  it("TC-I4: too many tickers (>20) → 400", async () => {
    const tickers = Array.from({ length: 21 }, (_, i) => `T${String(i).padStart(4, "0")}`).join(",");

    const response = await app.inject({
      method: "GET",
      url: `/quotes?tickers=${tickers}`,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toBe("too_many_symbols");
  });

  it("TC-I5: unknown ticker → null in response, not an error", async () => {
    // No bars seeded
    const response = await app.inject({
      method: "GET",
      url: "/quotes?tickers=UNKNOWN",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body["UNKNOWN"]).toBeNull();
  });
});
