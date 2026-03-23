import { describe, it, expect } from "vitest";
import { Env } from "../src/env.js";

describe("normalizeOrigin", () => {
  it("trims whitespace", () => {
    expect(Env.normalizeOrigin("  http://localhost:3000  ")).toBe("http://localhost:3000");
  });

  it("removes trailing slash", () => {
    expect(Env.normalizeOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("does not modify origins without trailing slash", () => {
    expect(Env.normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });
});

describe("getAllowedOrigins", () => {
  it("returns an array (empty or populated depending on env)", () => {
    expect(Array.isArray(Env.getAllowedOrigins())).toBe(true);
  });

  it("returns normalized, non-empty strings only", () => {
    for (const origin of Env.getAllowedOrigins()) {
      expect(origin).not.toBe("");
      expect(origin).not.toMatch(/\/$/); // no trailing slash
    }
  });
});

describe("getDatabaseUrl", () => {
  it("returns a valid postgres URL", () => {
    const url = Env.getDatabaseUrl();
    expect(url).toMatch(/^postgres:\/\//);
  });
});

describe("getRedisUrl", () => {
  it("returns a valid redis URL", () => {
    const url = Env.getRedisUrl();
    expect(url).toMatch(/^redis:\/\//);
  });
});

describe("getGoogleOAuthEnvConfig", () => {
  it("returns null or a config object depending on env", () => {
    const result = Env.getGoogleOAuthEnvConfig();
    if (result === null) {
      expect(result).toBeNull();
    } else {
      expect(result).toHaveProperty("clientId");
      expect(result).toHaveProperty("clientSecret");
      expect(result).toHaveProperty("redirectUri");
      expect(result).toHaveProperty("sessionSecret");
    }
  });
});

describe("SESSION_COOKIE_NAME", () => {
  it("defaults to g_auth_session in the parsed env", () => {
    expect(Env.SESSION_COOKIE_NAME).toBe("g_auth_session");
  });
});

describe("validateHostConsistency", () => {
  it("passes when both URLs use the same hostname", () => {
    expect(() =>
      Env.validateHostConsistency({
        APP_BASE_URL: "http://localhost:3333",
        GOOGLE_REDIRECT_URI: "http://localhost:4000/auth/google/callback",
        API_PORT: 4000,
      }),
    ).not.toThrow();
  });

  it("throws when APP_BASE_URL and GOOGLE_REDIRECT_URI use different hostnames", () => {
    expect(() =>
      Env.validateHostConsistency({
        APP_BASE_URL: "http://127.0.0.1:3333",
        GOOGLE_REDIRECT_URI: "http://localhost:4000/auth/google/callback",
        API_PORT: 4000,
      }),
    ).toThrow("Hostname mismatch");
  });

  it("throws when 127.0.0.1 and localhost are mixed", () => {
    expect(() =>
      Env.validateHostConsistency({
        APP_BASE_URL: "http://localhost:3333",
        GOOGLE_REDIRECT_URI: "http://127.0.0.1:4000/auth/google/callback",
        API_PORT: 4000,
      }),
    ).toThrow("Hostname mismatch");
  });

  it("passes when only one URL is set", () => {
    expect(() =>
      Env.validateHostConsistency({
        APP_BASE_URL: "http://localhost:3333",
        GOOGLE_REDIRECT_URI: undefined,
        API_PORT: 4000,
      }),
    ).not.toThrow();
  });

  it("passes when no URLs are set", () => {
    expect(() =>
      Env.validateHostConsistency({
        APP_BASE_URL: undefined,
        GOOGLE_REDIRECT_URI: undefined,
        API_PORT: 4000,
      }),
    ).not.toThrow();
  });

  it("throws when GOOGLE_REDIRECT_URI port does not match API_PORT", () => {
    expect(() =>
      Env.validateHostConsistency({
        APP_BASE_URL: "http://localhost:3333",
        GOOGLE_REDIRECT_URI: "http://localhost:9999/auth/google/callback",
        API_PORT: 4000,
        NODE_ENV: "development",
      }),
    ).toThrow("API_PORT");
  });

  it("passes when GOOGLE_REDIRECT_URI port matches API_PORT", () => {
    expect(() =>
      Env.validateHostConsistency({
        APP_BASE_URL: "http://localhost:3333",
        GOOGLE_REDIRECT_URI: "http://localhost:4000/auth/google/callback",
        API_PORT: 4000,
        NODE_ENV: "development",
      }),
    ).not.toThrow();
  });

  it("passes for production HTTPS URLs without explicit port", () => {
    // Different public subdomains are valid (e.g. Cloudflare tunnel where web and API
    // live on separate subdomains). Only localhost-style mismatches are rejected.
    expect(() =>
      Env.validateHostConsistency({
        APP_BASE_URL: "https://app.example.com",
        GOOGLE_REDIRECT_URI: "https://api.example.com/auth/google/callback",
        API_PORT: 4000,
      }),
    ).not.toThrow();
  });

  it("passes for production HTTPS with same host and no port in redirect URI", () => {
    expect(() =>
      Env.validateHostConsistency({
        APP_BASE_URL: "https://example.com",
        GOOGLE_REDIRECT_URI: "https://example.com/auth/google/callback",
        API_PORT: 4000,
      }),
    ).not.toThrow();
  });
});

describe("validateCookieConfig", () => {
  it("passes when COOKIE_DOMAIN is unset (local dev default)", () => {
    expect(() =>
      Env.validateCookieConfig({
        SESSION_COOKIE_NAME: "__Host-g_auth_session",
        COOKIE_DOMAIN: undefined,
      }),
    ).not.toThrow();
  });

  it("passes when COOKIE_DOMAIN is set with a non-prefixed cookie name", () => {
    expect(() =>
      Env.validateCookieConfig({
        SESSION_COOKIE_NAME: "g_auth_session",
        COOKIE_DOMAIN: ".kzokvdevs.dpdns.org",
      }),
    ).not.toThrow();
  });

  it("throws when __Host- prefix is combined with COOKIE_DOMAIN", () => {
    expect(() =>
      Env.validateCookieConfig({
        SESSION_COOKIE_NAME: "__Host-g_auth_session",
        COOKIE_DOMAIN: ".kzokvdevs.dpdns.org",
      }),
    ).toThrow("__Host-");
  });
});

describe("validateEnvConstraints", () => {
  const baseEnv = {
    API_PORT: 4000,
    WEB_PORT: 3000,
    DB_PORT: 5432,
    REDIS_PORT: 6379,
    AUTH_MODE: "dev_bypass" as const,
    NODE_ENV: "development" as const,
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    GOOGLE_REDIRECT_URI: undefined,
    SESSION_SECRET: undefined,
  };

  it("passes with unique ports and dev_bypass in development", () => {
    expect(() => Env.validateEnvConstraints(baseEnv)).not.toThrow();
  });

  it("throws when ports conflict", () => {
    expect(() =>
      Env.validateEnvConstraints({ ...baseEnv, WEB_PORT: 4000 }),
    ).toThrow("Port conflict");
  });

  it("throws when dev_bypass used in production", () => {
    expect(() =>
      Env.validateEnvConstraints({ ...baseEnv, NODE_ENV: "production" as const }),
    ).toThrow("dev_bypass");
  });

  it("passes when dev_bypass used in development", () => {
    expect(() =>
      Env.validateEnvConstraints({ ...baseEnv, NODE_ENV: "development" as const }),
    ).not.toThrow();
  });

  it("passes when dev_bypass used in test", () => {
    expect(() =>
      Env.validateEnvConstraints({ ...baseEnv, NODE_ENV: "test" as const }),
    ).not.toThrow();
  });

  it("throws when oauth mode missing GOOGLE_CLIENT_ID", () => {
    expect(() =>
      Env.validateEnvConstraints({ ...baseEnv, AUTH_MODE: "oauth" as const }),
    ).toThrow("GOOGLE_CLIENT_ID");
  });

  it("passes when oauth mode has all required vars", () => {
    expect(() =>
      Env.validateEnvConstraints({
        ...baseEnv,
        AUTH_MODE: "oauth" as const,
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
        GOOGLE_REDIRECT_URI: "http://localhost:4000/callback",
        SESSION_SECRET: "a-secret-that-is-at-least-32-chars-long",
      }),
    ).not.toThrow();
  });

  // QA edge cases (E8-E11)
  it("throws when oauth mode has partial creds (only SESSION_SECRET missing)", () => {
    expect(() =>
      Env.validateEnvConstraints({
        ...baseEnv,
        AUTH_MODE: "oauth" as const,
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
        GOOGLE_REDIRECT_URI: "http://localhost:4000/callback",
        SESSION_SECRET: undefined,
      }),
    ).toThrow("SESSION_SECRET");
  });

  it("rejects dev_bypass in production even with oauth creds present", () => {
    expect(() =>
      Env.validateEnvConstraints({
        ...baseEnv,
        NODE_ENV: "production" as const,
        AUTH_MODE: "dev_bypass" as const,
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
        GOOGLE_REDIRECT_URI: "http://localhost:4000/callback",
        SESSION_SECRET: "a-secret-that-is-at-least-32-chars-long",
      }),
    ).toThrow("dev_bypass");
  });

  it("detects conflict when three ports share the same value", () => {
    expect(() =>
      Env.validateEnvConstraints({
        ...baseEnv,
        API_PORT: 4000,
        WEB_PORT: 4000,
        DB_PORT: 4000,
      }),
    ).toThrow("Port conflict");
  });

  it("uses injectable params, not Env singleton, for port check", () => {
    // Env singleton has valid unique ports. Injectable params have a conflict.
    // If the function correctly uses envInput, it should throw.
    expect(() =>
      Env.validateEnvConstraints({
        ...baseEnv,
        API_PORT: 9999,
        WEB_PORT: 9999,
      }),
    ).toThrow("Port conflict");
  });
});
