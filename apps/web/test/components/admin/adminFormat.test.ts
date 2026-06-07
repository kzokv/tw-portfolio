import { describe, expect, it } from "vitest";
import { formatUtcTimestamp } from "../../../components/admin/adminFormat";

describe("admin format helpers", () => {
  it("formats timestamps in stable UTC text for SSR hydration", () => {
    expect(formatUtcTimestamp("2026-06-07T15:11:31.662Z")).toBe("2026-06-07 15:11:31 UTC");
  });

  it("keeps invalid timestamp values visible", () => {
    expect(formatUtcTimestamp("not-a-date")).toBe("not-a-date");
    expect(formatUtcTimestamp(null)).toBe("never");
  });
});
