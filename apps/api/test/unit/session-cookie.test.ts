import { describe, expect, it } from "vitest";
import { signSessionCookie, verifySessionCookie } from "../../src/auth/googleOAuth.js";

const SECRET = "test-session-secret-that-is-long-enough-32chars!!";

describe("signSessionCookie", () => {
  it("returns sub.hmac format", () => {
    const signed = signSessionCookie("google-sub-123", SECRET);
    const parts = signed.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("google-sub-123");
    // HMAC is a 64-char hex string (SHA-256)
    expect(parts[1]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces deterministic output for the same inputs", () => {
    const a = signSessionCookie("sub-1", SECRET);
    const b = signSessionCookie("sub-1", SECRET);
    expect(a).toBe(b);
  });

  it("produces different output for different subs", () => {
    const a = signSessionCookie("sub-1", SECRET);
    const b = signSessionCookie("sub-2", SECRET);
    expect(a).not.toBe(b);
  });

  it("produces different output for different secrets", () => {
    const a = signSessionCookie("sub-1", "secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const b = signSessionCookie("sub-1", "secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(a).not.toBe(b);
  });
});

describe("verifySessionCookie", () => {
  it("returns the sub for a validly-signed cookie", () => {
    const signed = signSessionCookie("google-sub-123", SECRET);
    expect(verifySessionCookie(signed, SECRET)).toEqual({ userId: "google-sub-123", isDemo: false });
  });

  it("returns null for a tampered HMAC", () => {
    const signed = signSessionCookie("google-sub-123", SECRET);
    const tampered = signed.slice(0, signed.lastIndexOf(".")) + ".badhmacsignaturebadhmacsignaturebadhmacsignaturebadhmacsignature";
    expect(verifySessionCookie(tampered, SECRET)).toBeNull();
  });

  it("returns null for a plain sub with no HMAC", () => {
    expect(verifySessionCookie("google-sub-123", SECRET)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(verifySessionCookie("", SECRET)).toBeNull();
  });

  it("returns null when signed with a different secret", () => {
    const signed = signSessionCookie("google-sub-123", "other-secret-that-is-long-enough-32chars!!");
    expect(verifySessionCookie(signed, SECRET)).toBeNull();
  });

  it("returns null for malformed input (no dot separator)", () => {
    expect(verifySessionCookie("no-dot-here", SECRET)).toBeNull();
  });

  it("returns null when HMAC portion is empty", () => {
    expect(verifySessionCookie("sub.", SECRET)).toBeNull();
  });

  it("returns null when sub portion is empty", () => {
    expect(verifySessionCookie(".somehmacsig", SECRET)).toBeNull();
  });

  it("correctly round-trips a sub that contains dots", () => {
    const sub = "numeric.sub.with.dots";
    const signed = signSessionCookie(sub, SECRET);
    expect(verifySessionCookie(signed, SECRET)).toEqual({ userId: sub, isDemo: false });
  });
});

describe("demo cookie prefix", () => {
  it("signSessionCookie with isDemo=true prepends demo: to payload", () => {
    const signed = signSessionCookie("user-123", SECRET, true);
    expect(signed.startsWith("demo:user-123.")).toBe(true);
  });

  it("verifySessionCookie returns isDemo=true for demo-prefixed cookie", () => {
    const signed = signSessionCookie("user-123", SECRET, true);
    expect(verifySessionCookie(signed, SECRET)).toEqual({ userId: "user-123", isDemo: true });
  });

  it("round-trip: sign demo cookie and verify returns correct identity", () => {
    const signed = signSessionCookie("demo-user-uuid", SECRET, true);
    const result = verifySessionCookie(signed, SECRET);
    expect(result).toEqual({ userId: "demo-user-uuid", isDemo: true });
    // Verify tampering fails
    const nonDemo = signSessionCookie("demo-user-uuid", SECRET, false);
    const nonDemoResult = verifySessionCookie(nonDemo, SECRET);
    expect(nonDemoResult).toEqual({ userId: "demo-user-uuid", isDemo: false });
  });
});
