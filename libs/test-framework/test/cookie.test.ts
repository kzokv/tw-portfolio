import { describe, expect, it } from "vitest";
import { parseSessionCookie } from "../src/shared/cookie.js";

describe("parseSessionCookie", () => {
  it("parses legacy oauth cookies with a 2-part payload", () => {
    expect(parseSessionCookie("user-123.deadbeef")).toEqual({
      userId: "user-123",
      hmac: "deadbeef",
      isDemo: false,
    });
  });

  it("parses oauth cookies with a session version", () => {
    expect(parseSessionCookie("user-123.7.deadbeef")).toEqual({
      userId: "user-123",
      sessionVersion: 7,
      hmac: "deadbeef",
      isDemo: false,
    });
  });

  it("parses demo cookies without treating the user id as a session version payload", () => {
    expect(parseSessionCookie("demo:user-123.deadbeef")).toEqual({
      userId: "user-123",
      hmac: "deadbeef",
      isDemo: true,
    });
  });

  it("falls back to legacy parsing when the intermediate segment is not numeric", () => {
    expect(parseSessionCookie("user.with.dot.deadbeef")).toEqual({
      userId: "user.with.dot",
      hmac: "deadbeef",
      isDemo: false,
    });
  });

  it("throws when the cookie is missing a separator", () => {
    expect(() => parseSessionCookie("user-123")).toThrow("Invalid session cookie format");
  });

  it("throws when the cookie is missing a payload or hmac", () => {
    expect(() => parseSessionCookie(".deadbeef")).toThrow("Invalid session cookie format");
    expect(() => parseSessionCookie("user-123.")).toThrow("Invalid session cookie format");
  });
});
