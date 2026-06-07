import { describe, expect, it } from "vitest";
import { formatDateLabel } from "../../lib/utils";

describe("formatDateLabel", () => {
  it("formats date labels in UTC so SSR and client hydration agree", () => {
    expect(formatDateLabel("2026-06-07T23:30:00.000Z", "en")).toBe("Jun 7, 2026");
    expect(formatDateLabel("2026-06-07T23:30:00.000Z", "zh-TW")).toBe("2026年6月7日");
  });
});
