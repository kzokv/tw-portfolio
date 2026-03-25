import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";
import { verifySessionCookie } from "../../src/auth/googleOAuth.js";
import { _resetDemoRateBuckets } from "../../src/routes/registerRoutes.js";

vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: { ...original.Env, DEMO_MODE_ENABLED: "true" as const, DEMO_SESSION_TTL_SECONDS: 1800 },
  };
});

const testOAuthConfig: GoogleOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

describe("POST /auth/demo/start", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    _resetDemoRateBuckets();
    app = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: testOAuthConfig,
      appBaseUrl: "http://localhost:3000",
    });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("creates demo user and returns signed cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/demo/start",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.userId).toBeTruthy();
    expect(body.sessionType).toBe("demo");
    expect(body.expiresAt).toBeTruthy();

    const setCookie = res.headers["set-cookie"] as string;
    expect(setCookie).toContain("Max-Age=1800");
    expect(setCookie).toContain("HttpOnly");

    // Verify cookie is a valid demo session
    const cookieValue = setCookie.split("=").slice(1).join("=").split(";")[0];
    const identity = verifySessionCookie(cookieValue, testOAuthConfig.sessionSecret);
    expect(identity).not.toBeNull();
    expect(identity?.userId).toBe(body.userId);
    expect(identity?.isDemo).toBe(true);
  });

  it("demo user can access /settings with cookie", async () => {
    const { Env } = await import("@tw-portfolio/config");

    const demoRes = await app.inject({
      method: "POST",
      url: "/auth/demo/start",
    });
    expect(demoRes.statusCode).toBe(200);

    const setCookie = demoRes.headers["set-cookie"] as string;
    const cookieValue = setCookie.match(new RegExp(`${Env.SESSION_COOKIE_NAME}=([^;]+)`))?.[1];

    const settingsRes = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { cookie: `${Env.SESSION_COOKIE_NAME}=${cookieValue}` },
    });
    expect(settingsRes.statusCode).toBe(200);
  });

  it("returns X-Session-Type: demo header on responses", async () => {
    const { Env } = await import("@tw-portfolio/config");

    const demoRes = await app.inject({
      method: "POST",
      url: "/auth/demo/start",
    });
    expect(demoRes.statusCode).toBe(200);

    const setCookie = demoRes.headers["set-cookie"] as string;
    const cookieValue = setCookie.match(new RegExp(`${Env.SESSION_COOKIE_NAME}=([^;]+)`))?.[1];

    const settingsRes = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { cookie: `${Env.SESSION_COOKIE_NAME}=${cookieValue}` },
    });
    expect(settingsRes.headers["x-session-type"]).toBe("demo");
  });

  it("seeds demo transactions (non-empty store)", async () => {
    const demoRes = await app.inject({
      method: "POST",
      url: "/auth/demo/start",
    });
    expect(demoRes.statusCode).toBe(200);
    const body = demoRes.json();

    // Load the store to check transactions were seeded
    const store = await app.persistence.loadStore(body.userId);
    expect(store.accounting.facts.tradeEvents.length).toBeGreaterThan(0);

    // Regression: demo seeding must process trades through the full booking
    // pipeline (createTransaction) so that derived data is populated — not just
    // raw tradeEvents. Without this, the portfolio page shows empty holdings.
    expect(store.accounting.projections.lots.length).toBeGreaterThan(0);
    expect(store.accounting.projections.holdings.length).toBeGreaterThan(0);
    expect(store.accounting.facts.cashLedgerEntries.length).toBeGreaterThan(0);

    // Verify holdings cover the expected symbols from demo data
    const holdingSymbols = store.accounting.projections.holdings.map(
      (h: { symbol: string }) => h.symbol,
    );
    expect(holdingSymbols).toContain("2330");
    expect(holdingSymbols).toContain("0050");
  });

  it("rate limits after 5 requests per IP", async () => {
    // Fire 5 successful requests
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/demo/start",
      });
      expect(res.statusCode).toBe(200);
    }

    // 6th should be rate limited
    const res = await app.inject({
      method: "POST",
      url: "/auth/demo/start",
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("rate_limit_exceeded");
  });
});

describe("POST /__e2e/demo-session", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    _resetDemoRateBuckets();
    app = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: testOAuthConfig,
      appBaseUrl: "http://localhost:3000",
    });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("creates demo session and returns signed cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__e2e/demo-session",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.userId).toBeTruthy();
    expect(body.sessionType).toBe("demo");
    expect(body.expiresAt).toBeTruthy();

    // Verify cookie is a valid signed demo session
    const setCookie = res.headers["set-cookie"] as string;
    expect(setCookie).toContain("Max-Age=");
    expect(setCookie).toContain("HttpOnly");

    const cookieValue = setCookie.split("=").slice(1).join("=").split(";")[0];
    const identity = verifySessionCookie(cookieValue, testOAuthConfig.sessionSecret);
    expect(identity).not.toBeNull();
    expect(identity?.userId).toBe(body.userId);
    expect(identity?.isDemo).toBe(true);
  });

  it("seeds demo transactions (non-empty store)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__e2e/demo-session",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const store = await app.persistence.loadStore(body.userId);
    expect(store.accounting.facts.tradeEvents.length).toBeGreaterThan(0);
    expect(store.accounting.projections.lots.length).toBeGreaterThan(0);
    expect(store.accounting.projections.holdings.length).toBeGreaterThan(0);
  });

  it("bypasses demo rate limiter (no 429 after bucket exhaustion)", async () => {
    // Exhaust the demo rate bucket via the real endpoint
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "POST", url: "/auth/demo/start" });
      expect(res.statusCode).toBe(200);
    }
    // Confirm real endpoint is now rate-limited
    const rateLimited = await app.inject({ method: "POST", url: "/auth/demo/start" });
    expect(rateLimited.statusCode).toBe(429);

    // /__e2e/demo-session should still work — it bypasses the rate limiter
    const res = await app.inject({ method: "POST", url: "/__e2e/demo-session" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("returns 404 in production NODE_ENV", async () => {
    const { Env } = await import("@tw-portfolio/config");
    const original = Env.NODE_ENV;
    try {
      (Env as Record<string, unknown>).NODE_ENV = "production";
      const prodApp = await buildApp({
        persistenceBackend: "memory",
        oauthConfig: testOAuthConfig,
      });
      try {
        const res = await prodApp.inject({ method: "POST", url: "/__e2e/demo-session" });
        expect(res.statusCode).toBe(404);
      } finally {
        await prodApp.close();
      }
    } finally {
      (Env as Record<string, unknown>).NODE_ENV = original;
    }
  });
});

describe("POST /auth/demo/start — disabled", () => {
  it("returns 404 when DEMO_MODE_ENABLED=false", async () => {
    // Build app without the vi.mock override — use a separate describe
    // Since we already mocked at module level, we need a different approach.
    // Instead, test by directly checking the route logic via a fresh app
    // where we temporarily override Env.
    const { Env } = await import("@tw-portfolio/config");
    const originalValue = Env.DEMO_MODE_ENABLED;

    try {
      // Temporarily set to "false"
      (Env as Record<string, unknown>).DEMO_MODE_ENABLED = "false";

      const app = await buildApp({
        persistenceBackend: "memory",
        oauthConfig: {
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          redirectUri: "http://localhost:4000/auth/google/callback",
          sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
        },
      });

      try {
        const res = await app.inject({
          method: "POST",
          url: "/auth/demo/start",
        });
        expect(res.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    } finally {
      (Env as Record<string, unknown>).DEMO_MODE_ENABLED = originalValue;
    }
  });
});
