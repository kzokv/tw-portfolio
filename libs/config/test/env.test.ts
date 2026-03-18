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
  it("defaults to __Host-g_auth_session in the parsed env", () => {
    expect(Env.SESSION_COOKIE_NAME).toBe("__Host-g_auth_session");
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
      }),
    ).toThrow("API_PORT");
  });

  it("passes when GOOGLE_REDIRECT_URI port matches API_PORT", () => {
    expect(() =>
      Env.validateHostConsistency({
        APP_BASE_URL: "http://localhost:3333",
        GOOGLE_REDIRECT_URI: "http://localhost:4000/auth/google/callback",
        API_PORT: 4000,
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
