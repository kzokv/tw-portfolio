import { describe, expect, it } from "vitest";
import { isPublicRoute } from "../../src/routes/registerRoutes.js";

describe("public route allowlist", () => {
  it("allows ChatGPT OAuth discovery metadata routes without a session", () => {
    expect(isPublicRoute("GET", "/.well-known/oauth-protected-resource")).toBe(true);
    expect(isPublicRoute("GET", "/.well-known/oauth-protected-resource/mcp")).toBe(true);
    expect(isPublicRoute("GET", "/.well-known/oauth-authorization-server")).toBe(true);
    expect(isPublicRoute("GET", "/.well-known/oauth-authorization-server/mcp")).toBe(true);
    expect(isPublicRoute("GET", "/.well-known/openid-configuration")).toBe(true);
    expect(isPublicRoute("GET", "/.well-known/openid-configuration/mcp")).toBe(true);
    expect(isPublicRoute("GET", "/oauth/redirect")).toBe(true);
  });
});
