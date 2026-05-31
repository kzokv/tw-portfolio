import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";
import { assertE2EOauthSessionEnabled } from "../../src/routes/registerRoutes.js";

const testOAuthConfig: GoogleOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

describe("assertE2EOauthSessionEnabled guard", () => {
  it("does not throw when NODE_ENV is 'test'", () => {
    expect(() => assertE2EOauthSessionEnabled("test")).not.toThrow();
  });

  it("does not throw when NODE_ENV is 'development'", () => {
    expect(() => assertE2EOauthSessionEnabled("development")).not.toThrow();
  });

  it("throws 404 when NODE_ENV is 'production'", () => {
    expect(() => assertE2EOauthSessionEnabled("production")).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it("throws 404 for unexpected NODE_ENV values", () => {
    expect(() => assertE2EOauthSessionEnabled("staging")).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it("endpoint returns 200 in test mode (NODE_ENV=test)", async () => {
    const app = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: testOAuthConfig,
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/__e2e/oauth-session",
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
