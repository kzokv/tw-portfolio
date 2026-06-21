import { afterEach, describe, expect, it } from "vitest";
import { applyPriceColorConvention } from "../../lib/theme";

describe("applyPriceColorConvention", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--finance-gain");
    document.documentElement.style.removeProperty("--finance-loss");
    document.documentElement.style.removeProperty("--chart-direction-positive");
    document.documentElement.style.removeProperty("--chart-direction-negative");
  });

  it("keeps green gains and red losses for the default convention", () => {
    applyPriceColorConvention("gain_green_loss_red");

    expect(document.documentElement.style.getPropertyValue("--finance-gain")).toBe("var(--success)");
    expect(document.documentElement.style.getPropertyValue("--finance-loss")).toBe("var(--destructive)");
    expect(document.documentElement.style.getPropertyValue("--chart-direction-positive")).toBe("var(--finance-gain)");
    expect(document.documentElement.style.getPropertyValue("--chart-direction-negative")).toBe("var(--finance-loss)");
  });

  it("swaps gain and loss finance variables for red gains", () => {
    applyPriceColorConvention("gain_red_loss_green");

    expect(document.documentElement.style.getPropertyValue("--finance-gain")).toBe("var(--destructive)");
    expect(document.documentElement.style.getPropertyValue("--finance-loss")).toBe("var(--success)");
    expect(document.documentElement.style.getPropertyValue("--chart-direction-positive")).toBe("var(--finance-gain)");
    expect(document.documentElement.style.getPropertyValue("--chart-direction-negative")).toBe("var(--finance-loss)");
  });
});
