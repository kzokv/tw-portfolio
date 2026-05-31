import { describe, expect, it } from "vitest";
import {
  extractInviteCode,
  extractReturnTo,
  generateState,
  verifyState,
} from "../../src/auth/googleOAuth.js";

const SECRET = "test-session-secret-that-is-long-enough-32chars!!";

describe("generateState — 4-part form with invite code", () => {
  it("produces a 4-part token when invite code provided with no returnTo", () => {
    // Arrange + Act
    const state = generateState(SECRET, undefined, "ABCDEFGH");

    // Assert
    const parts = state.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[1]).toBe("");
    expect(parts[2]).toBe("ABCDEFGH");
  });

  it("produces a 4-part token when both invite code and returnTo are provided", () => {
    // Arrange + Act
    const state = generateState(SECRET, "/portfolio", "ABCDEFGH");

    // Assert
    const parts = state.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[1]).not.toBe("");
    expect(parts[2]).toBe("ABCDEFGH");
  });

  it("falls back to 2-part form when neither provided (backward compatible)", () => {
    // Arrange + Act
    const state = generateState(SECRET);

    // Assert
    expect(state.split(".")).toHaveLength(2);
  });

  it("falls back to 3-part form when only returnTo provided (backward compatible)", () => {
    // Arrange + Act
    const state = generateState(SECRET, "/dashboard");

    // Assert
    expect(state.split(".")).toHaveLength(3);
  });
});

describe("verifyState — tamper detection", () => {
  it("accepts an unmodified 4-part state", () => {
    // Arrange
    const state = generateState(SECRET, "/portfolio", "ABCDEFGH");

    // Act + Assert
    expect(verifyState(state, SECRET)).toBe(true);
  });

  it("rejects tampering of the invite-code segment", () => {
    // Arrange
    const state = generateState(SECRET, "/portfolio", "ABCDEFGH");
    const parts = state.split(".");
    const tampered = `${parts[0]}.${parts[1]}.DIFFERENT.${parts[3]}`;

    // Act + Assert
    expect(verifyState(tampered, SECRET)).toBe(false);
  });

  it("rejects tampering of the returnTo segment in 4-part form", () => {
    // Arrange
    const state = generateState(SECRET, "/portfolio", "ABCDEFGH");
    const parts = state.split(".");
    const tampered = `${parts[0]}.AAAA.${parts[2]}.${parts[3]}`;

    // Act + Assert
    expect(verifyState(tampered, SECRET)).toBe(false);
  });

  it("rejects tampering of the nonce segment", () => {
    // Arrange
    const state = generateState(SECRET, undefined, "ABCDEFGH");
    const parts = state.split(".");
    const tampered = `0000000000000000.${parts[1]}.${parts[2]}.${parts[3]}`;

    // Act + Assert
    expect(verifyState(tampered, SECRET)).toBe(false);
  });

  it("rejects a 4-part state signed by a different secret", () => {
    // Arrange
    const state = generateState("other-secret", "/x", "ABCDEFGH");

    // Act + Assert
    expect(verifyState(state, SECRET)).toBe(false);
  });
});

describe("extractInviteCode", () => {
  it("returns the invite code from a 4-part state", () => {
    // Arrange
    const state = generateState(SECRET, undefined, "MYCODEAB");

    // Act + Assert
    expect(extractInviteCode(state)).toBe("MYCODEAB");
  });

  it("returns null for a 3-part state (returnTo only, no invite)", () => {
    // Arrange
    const state = generateState(SECRET, "/dashboard");

    // Act + Assert
    expect(extractInviteCode(state)).toBeNull();
  });

  it("returns null for a 2-part state (no returnTo, no invite)", () => {
    // Arrange
    const state = generateState(SECRET);

    // Act + Assert
    expect(extractInviteCode(state)).toBeNull();
  });

  it("returns null for malformed state (1 part)", () => {
    // Act + Assert
    expect(extractInviteCode("only-one-segment")).toBeNull();
  });
});

describe("extractReturnTo — 4-part compatibility", () => {
  it("extracts returnTo from a 4-part state when present", () => {
    // Arrange
    const state = generateState(SECRET, "/portfolio", "ABCDEFGH");

    // Act + Assert
    expect(extractReturnTo(state)).toBe("/portfolio");
  });

  it("returns null when returnTo is empty in a 4-part state (invite-only flow)", () => {
    // Arrange
    const state = generateState(SECRET, undefined, "ABCDEFGH");

    // Act + Assert
    expect(extractReturnTo(state)).toBeNull();
  });

  it("still extracts returnTo from a 3-part state (backward compat)", () => {
    // Arrange
    const state = generateState(SECRET, "/dashboard");

    // Act + Assert
    expect(extractReturnTo(state)).toBe("/dashboard");
  });
});
