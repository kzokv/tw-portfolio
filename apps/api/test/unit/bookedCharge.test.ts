import { describe, expect, it } from "vitest";
import { isValidBookedCharge } from "../../src/validation/bookedCharge.js";

describe("booked charge validation", () => {
  it("accepts non-negative finite amounts with at most 4 decimal places", () => {
    expect(isValidBookedCharge(0)).toBe(true);
    expect(isValidBookedCharge(1)).toBe(true);
    expect(isValidBookedCharge(1.2345)).toBe(true);
    expect(isValidBookedCharge(1.23e-2)).toBe(true);
  });

  it("rejects negative, non-finite, and higher-precision amounts", () => {
    expect(isValidBookedCharge(-0.01)).toBe(false);
    expect(isValidBookedCharge(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidBookedCharge(Number.NaN)).toBe(false);
    expect(isValidBookedCharge(1.23456)).toBe(false);
    expect(isValidBookedCharge(1e-5)).toBe(false);
  });
});
