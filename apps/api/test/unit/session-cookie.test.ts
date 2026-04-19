import { describe, expect, it } from "vitest";
import { Env } from "@tw-portfolio/config";
import {
  signImpersonationCookie,
  signSessionCookie,
  verifyImpersonationCookie,
  verifySessionCookie,
} from "../../src/auth/googleOAuth.js";
import { parseSessionCookie } from "../../src/routes/registerRoutes.js";

const SECRET = "test-session-secret-that-is-long-enough-32chars!!";

describe("signSessionCookie", () => {
  it("returns userId.sessionVersion.hmac for oauth sessions", () => {
    const signed = signSessionCookie("7d7649b4-4daa-4bb4-9f78-9ec5db2f6278", SECRET, 3);
    const parts = signed.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("7d7649b4-4daa-4bb4-9f78-9ec5db2f6278");
    expect(parts[1]).toBe("3");
    expect(parts[2]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps demo cookies on the 2-part demo:userId.hmac format", () => {
    const signed = signSessionCookie("demo-user-1", SECRET, true);
    expect(signed.startsWith("demo:demo-user-1.")).toBe(true);
    expect(signed.split(".")).toHaveLength(2);
  });
});

describe("verifySessionCookie", () => {
  it("round-trips oauth cookies with sessionVersion", () => {
    const signed = signSessionCookie("7d7649b4-4daa-4bb4-9f78-9ec5db2f6278", SECRET, 4);
    expect(verifySessionCookie(signed, SECRET)).toEqual({
      userId: "7d7649b4-4daa-4bb4-9f78-9ec5db2f6278",
      isDemo: false,
      sessionVersion: 4,
    });
  });

  it("round-trips demo cookies", () => {
    const signed = signSessionCookie("demo-user-1", SECRET, true);
    expect(verifySessionCookie(signed, SECRET)).toEqual({
      userId: "demo-user-1",
      isDemo: true,
    });
  });

  it("rejects tampering of oauth userId", () => {
    const signed = signSessionCookie("7d7649b4-4daa-4bb4-9f78-9ec5db2f6278", SECRET, 2);
    const [, sessionVersion, hmac] = signed.split(".");
    const tampered = `other-user.${sessionVersion}.${hmac}`;
    expect(verifySessionCookie(tampered, SECRET)).toBeNull();
  });

  it("rejects tampering of oauth sessionVersion", () => {
    const signed = signSessionCookie("7d7649b4-4daa-4bb4-9f78-9ec5db2f6278", SECRET, 2);
    const [userId, , hmac] = signed.split(".");
    const tampered = `${userId}.9.${hmac}`;
    expect(verifySessionCookie(tampered, SECRET)).toBeNull();
  });

  it("rejects tampering of demo payload", () => {
    const signed = signSessionCookie("demo-user-1", SECRET, true);
    const [, hmac] = signed.split(".");
    const tampered = `demo:someone-else.${hmac}`;
    expect(verifySessionCookie(tampered, SECRET)).toBeNull();
  });

  it("rejects malformed oauth cookies", () => {
    expect(verifySessionCookie("uuid.only-hmac", SECRET)).toBeNull();
    expect(verifySessionCookie("uuid.not-a-number.deadbeef", SECRET)).toBeNull();
  });
});

describe("signImpersonationCookie", () => {
  it("returns adminId.targetUserId.expiresAtMs.hmac", () => {
    const signed = signImpersonationCookie("admin-1", "target-1", 1_900_000_000_000, SECRET);
    const parts = signed.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("admin-1");
    expect(parts[1]).toBe("target-1");
    expect(parts[2]).toBe("1900000000000");
    expect(parts[3]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("throws when expiresAtMs is zero or invalid", () => {
    expect(() => signImpersonationCookie("admin-1", "target-1", 0, SECRET)).toThrow(
      /positive integer/,
    );
    expect(() => signImpersonationCookie("admin-1", "target-1", 1.5, SECRET)).toThrow(
      /positive integer/,
    );
  });
});

describe("verifyImpersonationCookie", () => {
  it("round-trips impersonation cookies", () => {
    const signed = signImpersonationCookie("admin-1", "target-1", 1_900_000_000_000, SECRET);
    expect(verifyImpersonationCookie(signed, SECRET)).toEqual({
      adminId: "admin-1",
      targetUserId: "target-1",
      expiresAtMs: 1_900_000_000_000,
    });
  });

  it("rejects tampering of adminId", () => {
    const signed = signImpersonationCookie("admin-1", "target-1", 1_900_000_000_000, SECRET);
    const [, targetUserId, expiresAtMs, hmac] = signed.split(".");
    const tampered = `admin-2.${targetUserId}.${expiresAtMs}.${hmac}`;
    expect(verifyImpersonationCookie(tampered, SECRET)).toBeNull();
  });

  it("rejects tampering of targetUserId", () => {
    const signed = signImpersonationCookie("admin-1", "target-1", 1_900_000_000_000, SECRET);
    const [adminId, , expiresAtMs, hmac] = signed.split(".");
    const tampered = `${adminId}.target-2.${expiresAtMs}.${hmac}`;
    expect(verifyImpersonationCookie(tampered, SECRET)).toBeNull();
  });

  it("rejects tampering of expiry", () => {
    const signed = signImpersonationCookie("admin-1", "target-1", 1_900_000_000_000, SECRET);
    const [adminId, targetUserId, , hmac] = signed.split(".");
    const tampered = `${adminId}.${targetUserId}.1900000000001.${hmac}`;
    expect(verifyImpersonationCookie(tampered, SECRET)).toBeNull();
  });

  it("rejects malformed impersonation cookies", () => {
    expect(verifyImpersonationCookie("admin.target.deadbeef", SECRET)).toBeNull();
    expect(verifyImpersonationCookie("admin.target.not-a-number.deadbeef", SECRET)).toBeNull();
  });
});

describe("signSessionCookie — sessionVersion guard", () => {
  it("throws when oauth sessionVersion is zero", () => {
    // Arrange + Act + Assert
    expect(() => signSessionCookie("user-1", SECRET, 0)).toThrow(/positive integer/);
  });

  it("throws when oauth sessionVersion is negative", () => {
    expect(() => signSessionCookie("user-1", SECRET, -5)).toThrow(/positive integer/);
  });

  it("throws when oauth sessionVersion is non-integer", () => {
    expect(() => signSessionCookie("user-1", SECRET, 1.5)).toThrow(/positive integer/);
  });

  it("accepts sessionVersion=1 (default)", () => {
    // Act + Assert
    expect(() => signSessionCookie("user-1", SECRET, 1)).not.toThrow();
  });

  it("does not validate sessionVersion path for demo cookies", () => {
    // Demo cookies ignore sessionVersion entirely — guard should not fire.
    expect(() => signSessionCookie("demo-user-1", SECRET, true)).not.toThrow();
  });
});

describe("parseSessionCookie", () => {
  it("disambiguates oauth cookies by 3 parts", () => {
    const signed = signSessionCookie("7d7649b4-4daa-4bb4-9f78-9ec5db2f6278", SECRET, 5);
    const identity = parseSessionCookie(`${Env.SESSION_COOKIE_NAME}=${signed}`, SECRET);
    expect(identity).toEqual({
      userId: "7d7649b4-4daa-4bb4-9f78-9ec5db2f6278",
      isDemo: false,
      sessionVersion: 5,
    });
  });

  it("disambiguates demo cookies by 2 parts", () => {
    const signed = signSessionCookie("demo-user-1", SECRET, true);
    const identity = parseSessionCookie(`${Env.SESSION_COOKIE_NAME}=${signed}`, SECRET);
    expect(identity).toEqual({
      userId: "demo-user-1",
      isDemo: true,
    });
  });
});
