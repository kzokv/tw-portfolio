import { describe, expect, it } from "vitest";
import { roundToDecimal } from "../src/index.js";

describe("roundToDecimal", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundToDecimal(152.356, 2)).toBe(152.36);
    expect(roundToDecimal(152.354, 2)).toBe(152.35);
  });

  it("handles the IEEE 754 .5 boundary correctly", () => {
    // Math.round(33.335 * 100) / 100 would give 33.33 (wrong)
    expect(roundToDecimal(33.335, 2)).toBe(33.34);
    // 1.005 is stored as 1.00499... in IEEE 754 — toFixed(2) rounds down
    // This is correct behavior: the actual float IS closer to 1.00
    expect(roundToDecimal(1.005, 2)).toBe(1);
  });

  it("handles zero decimal places", () => {
    expect(roundToDecimal(152.6, 0)).toBe(153);
    expect(roundToDecimal(152.4, 0)).toBe(152);
  });

  it("returns integers unchanged for higher precision", () => {
    expect(roundToDecimal(100, 2)).toBe(100);
    expect(roundToDecimal(98000, 2)).toBe(98000);
  });

  it("handles negative values", () => {
    expect(roundToDecimal(-152.356, 2)).toBe(-152.36);
    expect(roundToDecimal(-33.335, 2)).toBe(-33.34);
  });

  it("handles zero", () => {
    expect(roundToDecimal(0, 2)).toBe(0);
  });

  it("handles floating-point multiplication artifacts", () => {
    // 152.35 * 3 = 457.04999999999995 in IEEE 754
    const product = 152.35 * 3;
    expect(roundToDecimal(product, 2)).toBe(457.05);
  });

  it("rounds to 4 decimal places", () => {
    expect(roundToDecimal(1.23456, 4)).toBe(1.2346);
    expect(roundToDecimal(1.23454, 4)).toBe(1.2345);
  });
});
