import { describe, expect, it } from "vitest";
import { resolveHoldingAllocationBasis } from "../../src/services/userPreferences.js";

describe("resolveHoldingAllocationBasis", () => {
  it("defaults to market_value when the key is missing", () => {
    expect(resolveHoldingAllocationBasis({})).toBe("market_value");
  });

  it("passes through cost_basis", () => {
    expect(resolveHoldingAllocationBasis({ holdingAllocationBasis: "cost_basis" })).toBe("cost_basis");
  });

  it("defaults invalid values to market_value", () => {
    expect(resolveHoldingAllocationBasis({ holdingAllocationBasis: "bogus" })).toBe("market_value");
  });
});
