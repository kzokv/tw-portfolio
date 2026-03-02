import { describe, expect, it } from "vitest";
import { formatRecomputeMessage } from "../../../features/portfolio/i18n";

describe("formatRecomputeMessage", () => {
  it("formats English recompute messages", () => {
    expect(formatRecomputeMessage("en", "CONFIRMED", 3)).toBe("Recompute CONFIRMED, items: 3");
  });

  it("formats Traditional Chinese recompute messages", () => {
    expect(formatRecomputeMessage("zh-TW", "CONFIRMED", 3)).toBe("重算已確認，共 3 筆項目");
  });
});
