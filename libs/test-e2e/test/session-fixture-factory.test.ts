import { describe, it, expect } from "vitest";
import { createSessionFixtureConfig, type TSessionFixtureMode } from "../src/fixtures/sessionBase.js";

describe("createSessionFixtureConfig", () => {
  it("returns oauth config with domain-based cookie", () => {
    const config = createSessionFixtureConfig("oauth");
    expect(config.endpoint).toBe("/__e2e/oauth-session");
    expect(config.cookieMode).toBe("domain");
  });

  it("returns demo config with url-based cookie", () => {
    const config = createSessionFixtureConfig("demo");
    expect(config.endpoint).toBe("/__e2e/demo-session");
    expect(config.cookieMode).toBe("url");
  });

  it("exposes mode type for compile-time safety", () => {
    const modes: TSessionFixtureMode[] = ["oauth", "demo"];
    expect(modes).toHaveLength(2);
  });
});
