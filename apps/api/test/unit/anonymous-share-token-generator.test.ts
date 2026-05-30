import { describe, expect, it } from "vitest";
import { generateAnonymousShareToken } from "../../src/lib/anonymousShareToken.js";

const BASE62_ALPHABET = /^[A-Za-z0-9]{22}$/;

describe("generateAnonymousShareToken", () => {
  it("returns a 22-character string in the base62 alphabet", () => {
    // Arrange + Act
    const token = generateAnonymousShareToken();

    // Assert
    expect(token).toHaveLength(22);
    expect(token).toMatch(BASE62_ALPHABET);
  });

  it("exercises all three class ranges of the base62 alphabet across 1000 samples", () => {
    // Arrange
    const seen = new Set<string>();

    // Act
    for (let i = 0; i < 1000; i += 1) {
      const token = generateAnonymousShareToken();
      seen.add(token);
      expect(token).toMatch(BASE62_ALPHABET);
    }

    // Assert — no visible collisions at 1000 samples (~131 bits entropy each)
    expect(seen.size).toBe(1000);
  });

  it("produces tokens covering lowercase, uppercase, and digit characters in aggregate", () => {
    // Arrange — 1000 samples × 22 chars = 22_000 char observations. With a 62-char
    // alphabet the probability of missing any single class is effectively zero, so
    // a distribution check across the aggregate is deterministic enough to assert.
    let sawLower = false;
    let sawUpper = false;
    let sawDigit = false;

    // Act
    for (let i = 0; i < 1000; i += 1) {
      const token = generateAnonymousShareToken();
      if (/[a-z]/.test(token)) sawLower = true;
      if (/[A-Z]/.test(token)) sawUpper = true;
      if (/[0-9]/.test(token)) sawDigit = true;
      if (sawLower && sawUpper && sawDigit) break;
    }

    // Assert
    expect(sawLower).toBe(true);
    expect(sawUpper).toBe(true);
    expect(sawDigit).toBe(true);
  });
});
