import { describe, it, expect } from "vitest";
import { envSchema, webEnvSchema } from "../src/env-schema.js";

// Group A: webEnvSchema behavioral tests (QA-owned)
describe("webEnvSchema", () => {
  it("has exactly 4 shape keys", () => {
    const keys = Object.keys(webEnvSchema.shape);
    expect(keys).toHaveLength(4);
    expect(keys.sort()).toEqual([
      "NEXT_PUBLIC_API_BASE_URL",
      "NEXT_PUBLIC_AUTH_MODE",
      "SESSION_COOKIE_NAME",
      "SESSION_SECRET",
    ]);
  });

  it("defaults NEXT_PUBLIC_AUTH_MODE to dev_bypass", () => {
    const result = webEnvSchema.parse({});
    expect(result.NEXT_PUBLIC_AUTH_MODE).toBe("dev_bypass");
  });

  it("defaults NEXT_PUBLIC_API_BASE_URL to http://localhost:4000", () => {
    const result = webEnvSchema.parse({});
    expect(result.NEXT_PUBLIC_API_BASE_URL).toBe("http://localhost:4000");
  });

  it("inherits SESSION_COOKIE_NAME default from envSchema", () => {
    const result = webEnvSchema.parse({});
    expect(result.SESSION_COOKIE_NAME).toBe("__Host-g_auth_session");
  });

  it("inherits SESSION_SECRET as optional from envSchema", () => {
    const result = webEnvSchema.parse({});
    expect(result.SESSION_SECRET).toBeUndefined();
  });

  it("does NOT contain API_PORT", () => {
    expect("API_PORT" in webEnvSchema.shape).toBe(false);
  });

  it("does NOT contain NODE_ENV", () => {
    expect("NODE_ENV" in webEnvSchema.shape).toBe(false);
  });

  it("rejects invalid NEXT_PUBLIC_AUTH_MODE enum value", () => {
    expect(() =>
      webEnvSchema.parse({ NEXT_PUBLIC_AUTH_MODE: "none" }),
    ).toThrow();
  });

  it("rejects empty string SESSION_COOKIE_NAME (min(1) inherited)", () => {
    expect(() =>
      webEnvSchema.parse({ SESSION_COOKIE_NAME: "" }),
    ).toThrow();
  });
});

// Group G: structural smoke tests (QA-owned)
describe("envSchema structural", () => {
  it("does NOT contain NEXT_PUBLIC_AUTH_MODE", () => {
    expect("NEXT_PUBLIC_AUTH_MODE" in envSchema.shape).toBe(false);
  });

  it("does NOT contain NEXT_PUBLIC_API_BASE_URL", () => {
    expect("NEXT_PUBLIC_API_BASE_URL" in envSchema.shape).toBe(false);
  });
});
