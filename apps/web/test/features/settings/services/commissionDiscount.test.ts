import { describe, expect, it } from "vitest";
import { fromZhFoldValue, toZhFoldValue } from "../../../../features/settings/services/commissionDiscount";

describe("commissionDiscount conversion helpers", () => {
  it("converts percent-off to traditional Chinese fold values", () => {
    expect(toZhFoldValue(60)).toBe(4);
    expect(toZhFoldValue(56.2)).toBe(4.38);
  });

  it("converts fold values back to percent-off", () => {
    expect(fromZhFoldValue(4)).toBe(60);
    expect(fromZhFoldValue(2.8)).toBe(72);
  });
});
