import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";

vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      AUTH_MODE: "oauth" as const,
      DEMO_MODE_ENABLED: "true" as const,
      DEMO_SESSION_TTL_SECONDS: 1800,
    },
  };
});

const testOAuthConfig: GoogleOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

let app: AppInstance;

describe("POST /portfolio/refresh-closes demo guard", () => {
  beforeEach(async () => {
    app = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: testOAuthConfig,
      appBaseUrl: "http://localhost:3000",
    });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("blocks demo sessions before spending provider quota", async () => {
    const demoSession = await app.inject({ method: "POST", url: "/__e2e/demo-session" });
    expect(demoSession.statusCode, demoSession.body).toBe(200);
    const setCookie = demoSession.headers["set-cookie"];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!cookie) throw new Error("expected demo session cookie");

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/refresh-closes",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "demo_restricted" });
  });
});
