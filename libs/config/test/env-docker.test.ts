import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { dockerCloudSchema, dockerLocalSchema, validateCookieDomainRequired } from "../src/env-docker.js";
import { parseDotEnvLine } from "../src/env-schema.js";

const minCloudEnv = {
  POSTGRES_PASSWORD: "test-pw",
  REDIS_PASSWORD: "test-redis",
  CLOUDFLARE_TUNNEL_TOKEN: "test-token",
  PUBLIC_DOMAIN_WEB: "twp-dev-web.kzokvdevs.dpdns.org",
  PUBLIC_DOMAIN_API: "twp-dev-api.kzokvdevs.dpdns.org",
  COOKIE_DOMAIN: ".kzokvdevs.dpdns.org",
  DEPLOY_ENV: "dev",
  // Google OAuth: GOOGLE_REDIRECT_URI omitted — optional in schema (required at runtime via validateEnvConstraints)
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-chars",
};

describe("dockerCloudSchema", () => {
  it("accepts valid cloud config", () => {
    const result = dockerCloudSchema.parse(minCloudEnv);
    expect(result.DEPLOY_ENV).toBe("dev");
    expect(result.COOKIE_DOMAIN).toBe(".kzokvdevs.dpdns.org");
    expect(result.SESSION_COOKIE_NAME).toBe("g_auth_session");
  });

  it("requires COOKIE_DOMAIN (no default)", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { COOKIE_DOMAIN, ...rest } = minCloudEnv;
    expect(() => dockerCloudSchema.parse(rest)).toThrow();
  });

  it("requires DEPLOY_ENV", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { DEPLOY_ENV, ...rest } = minCloudEnv;
    expect(() => dockerCloudSchema.parse(rest)).toThrow();
  });

  it("rejects invalid DEPLOY_ENV value", () => {
    expect(() => dockerCloudSchema.parse({ ...minCloudEnv, DEPLOY_ENV: "staging" })).toThrow();
  });

  it("accepts DEPLOY_ENV=production", () => {
    const result = dockerCloudSchema.parse({ ...minCloudEnv, DEPLOY_ENV: "production" });
    expect(result.DEPLOY_ENV).toBe("production");
  });

  it("requires PUBLIC_DOMAIN_WEB (no default)", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { PUBLIC_DOMAIN_WEB, ...rest } = minCloudEnv;
    expect(() => dockerCloudSchema.parse(rest)).toThrow();
  });

  it("requires PUBLIC_DOMAIN_API (no default)", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { PUBLIC_DOMAIN_API, ...rest } = minCloudEnv;
    expect(() => dockerCloudSchema.parse(rest)).toThrow();
  });

  it("defaults SESSION_COOKIE_NAME to g_auth_session", () => {
    const result = dockerCloudSchema.parse(minCloudEnv);
    expect(result.SESSION_COOKIE_NAME).toBe("g_auth_session");
  });

  // QA gap tests (B9-B14)
  it("defaults NODE_ENV to production", () => {
    const result = dockerCloudSchema.parse(minCloudEnv);
    expect(result.NODE_ENV).toBe("production");
  });

  it("defaults AUTH_MODE to oauth", () => {
    const result = dockerCloudSchema.parse(minCloudEnv);
    expect(result.AUTH_MODE).toBe("oauth");
  });

  it("defaults PERSISTENCE_BACKEND to postgres", () => {
    const result = dockerCloudSchema.parse(minCloudEnv);
    expect(result.PERSISTENCE_BACKEND).toBe("postgres");
  });

  it("rejects empty string COOKIE_DOMAIN", () => {
    expect(() =>
      dockerCloudSchema.parse({ ...minCloudEnv, COOKIE_DOMAIN: "" }),
    ).toThrow();
  });

  it("rejects empty string PUBLIC_DOMAIN_WEB", () => {
    expect(() =>
      dockerCloudSchema.parse({ ...minCloudEnv, PUBLIC_DOMAIN_WEB: "" }),
    ).toThrow();
  });

  it("inherits API_PORT coerce number from envSchema", () => {
    const result = dockerCloudSchema.parse({ ...minCloudEnv, API_PORT: "4000" });
    expect(result.API_PORT).toBe(4000);
    expect(typeof result.API_PORT).toBe("number");
  });
});

describe("validateCookieDomainRequired", () => {
  it("throws when subdomains differ but COOKIE_DOMAIN unset", () => {
    expect(() =>
      validateCookieDomainRequired({
        PUBLIC_DOMAIN_WEB: "web.example.com",
        PUBLIC_DOMAIN_API: "api.example.com",
      }),
    ).toThrow("COOKIE_DOMAIN");
  });

  it("passes when subdomains differ and COOKIE_DOMAIN set", () => {
    expect(() =>
      validateCookieDomainRequired({
        PUBLIC_DOMAIN_WEB: "web.example.com",
        PUBLIC_DOMAIN_API: "api.example.com",
        COOKIE_DOMAIN: ".example.com",
      }),
    ).not.toThrow();
  });

  it("passes when domains are identical (same-host deploy)", () => {
    expect(() =>
      validateCookieDomainRequired({
        PUBLIC_DOMAIN_WEB: "app.example.com",
        PUBLIC_DOMAIN_API: "app.example.com",
      }),
    ).not.toThrow();
  });

  // QA edge cases (D4-D5)
  it("treats empty string COOKIE_DOMAIN as unset", () => {
    expect(() =>
      validateCookieDomainRequired({
        PUBLIC_DOMAIN_WEB: "web.example.com",
        PUBLIC_DOMAIN_API: "api.example.com",
        COOKIE_DOMAIN: "",
      }),
    ).toThrow("COOKIE_DOMAIN");
  });

  it("error message includes both domain values", () => {
    try {
      validateCookieDomainRequired({
        PUBLIC_DOMAIN_WEB: "web.test.io",
        PUBLIC_DOMAIN_API: "api.test.io",
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("web.test.io");
      expect(msg).toContain("api.test.io");
    }
  });
});

// Group C: dockerLocalSchema port alignment (QA-owned)
describe("dockerLocalSchema", () => {
  const minLocalEnv = {
    POSTGRES_PASSWORD: "test-pw",
    REDIS_PASSWORD: "test-redis",
    GOOGLE_CLIENT_ID: "test-id",
    GOOGLE_CLIENT_SECRET: "test-secret",
    SESSION_SECRET: "test-session-secret-that-is-at-least-32-chars",
  };

  it("coerces string API_PORT to number", () => {
    const result = dockerLocalSchema.parse({ ...minLocalEnv, API_PORT: "4000" });
    expect(result.API_PORT).toBe(4000);
    expect(typeof result.API_PORT).toBe("number");
  });

  it("coerces string WEB_PORT to number", () => {
    const result = dockerLocalSchema.parse({ ...minLocalEnv, WEB_PORT: "3000" });
    expect(result.WEB_PORT).toBe(3000);
    expect(typeof result.WEB_PORT).toBe("number");
  });

  it("rejects non-numeric port string", () => {
    expect(() =>
      dockerLocalSchema.parse({ ...minLocalEnv, API_PORT: "abc" }),
    ).toThrow();
  });

  it("rejects negative port value", () => {
    expect(() =>
      dockerLocalSchema.parse({ ...minLocalEnv, API_PORT: "-1" }),
    ).toThrow();
  });

  it("uses correct numeric defaults for ports", () => {
    const result = dockerLocalSchema.parse(minLocalEnv);
    expect(result.API_PORT).toBe(4000);
    expect(result.WEB_PORT).toBe(3000);
    expect(typeof result.API_PORT).toBe("number");
    expect(typeof result.WEB_PORT).toBe("number");
  });
});

// Group F: CI fixture validation (QA-owned)
describe("CI fixture validation", () => {
  const fixturesDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../infra/docker/fixtures",
  );

  function parseFixtureFile(filename: string): Record<string, string> {
    const raw = fs.readFileSync(path.join(fixturesDir, filename), "utf8");
    const env: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseDotEnvLine(line);
      if (parsed) env[parsed.key] = parsed.value;
    }
    return env;
  }

  it("env.dev.ci parses through dockerCloudSchema", () => {
    const env = parseFixtureFile("env.dev.ci");
    expect(() => dockerCloudSchema.parse(env)).not.toThrow();
  });

  it("env.prod.ci parses through dockerCloudSchema", () => {
    const env = parseFixtureFile("env.prod.ci");
    expect(() => dockerCloudSchema.parse(env)).not.toThrow();
  });
});
