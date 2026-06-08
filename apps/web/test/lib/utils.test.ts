import { describe, expect, it } from "vitest";
import { formatCompactCurrencyAmount, formatDateLabel } from "../../lib/utils";

describe("formatDateLabel", () => {
  it("formats date labels in UTC so SSR and client hydration agree", () => {
    expect(formatDateLabel("2026-06-07T23:30:00.000Z", "en")).toBe("Jun 7, 2026");
    expect(formatDateLabel("2026-06-07T23:30:00.000Z", "zh-TW")).toBe("2026年6月7日");
  });
});

describe("formatCompactCurrencyAmount", () => {
  it("keeps the currency code on compact displays", () => {
    expect(formatCompactCurrencyAmount(182450, "AUD", "en")).toBe("AUD 182.5K");
    expect(formatCompactCurrencyAmount(1240, "USD", "en")).toBe("USD 1.2K");
  });
});
