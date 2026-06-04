import { describe, expect, it } from "vitest";
import { patchAdminSettingsSchema } from "../../src/routes/adminRoutes.js";

describe("patchAdminSettingsSchema (KZO-142)", () => {
  describe("accepts", () => {
    it("repairCooldownMinutes = 1 (min)", () => {
      const result = patchAdminSettingsSchema.safeParse({ repairCooldownMinutes: 1 });
      expect(result.success).toBe(true);
    });

    it("repairCooldownMinutes = 60", () => {
      const result = patchAdminSettingsSchema.safeParse({ repairCooldownMinutes: 60 });
      expect(result.success).toBe(true);
    });

    it("repairCooldownMinutes = 10080 (max)", () => {
      const result = patchAdminSettingsSchema.safeParse({ repairCooldownMinutes: 10080 });
      expect(result.success).toBe(true);
    });

    it("repairCooldownMinutes = null", () => {
      const result = patchAdminSettingsSchema.safeParse({ repairCooldownMinutes: null });
      expect(result.success).toBe(true);
    });

    it("provider operation settings accept valid integer overrides", () => {
      const result = patchAdminSettingsSchema.safeParse({
        providerOperationAutoRenewIntervalMinutes: 60,
        providerIncidentRecurrenceWindowMinutes: 30,
        providerHealthWarningUnresolvedThreshold: 1_000,
        providerHealthCriticalUnresolvedThreshold: 10_000,
        providerOperationStaleHeartbeatMinutes: 15,
        providerOperationSummaryRetentionDays: 90,
        providerOperationLogRetentionDays: 30,
        providerIncidentRetentionDays: 180,
        providerResolvedItemRetentionDays: 30,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("rejects", () => {
    it("repairCooldownMinutes = 0 (below min)", () => {
      const result = patchAdminSettingsSchema.safeParse({ repairCooldownMinutes: 0 });
      expect(result.success).toBe(false);
    });

    it("repairCooldownMinutes = -1 (negative)", () => {
      const result = patchAdminSettingsSchema.safeParse({ repairCooldownMinutes: -1 });
      expect(result.success).toBe(false);
    });

    it("repairCooldownMinutes = 10081 (above max)", () => {
      const result = patchAdminSettingsSchema.safeParse({ repairCooldownMinutes: 10081 });
      expect(result.success).toBe(false);
    });

    it("repairCooldownMinutes = 1.5 (non-integer)", () => {
      const result = patchAdminSettingsSchema.safeParse({ repairCooldownMinutes: 1.5 });
      expect(result.success).toBe(false);
    });

    it("repairCooldownMinutes = '60' (string, not a number)", () => {
      const result = patchAdminSettingsSchema.safeParse({ repairCooldownMinutes: "60" });
      expect(result.success).toBe(false);
    });

    it("providerOperationStaleHeartbeatMinutes rejects values above max", () => {
      const result = patchAdminSettingsSchema.safeParse({ providerOperationStaleHeartbeatMinutes: 241 });
      expect(result.success).toBe(false);
    });

    it("unknown top-level key", () => {
      // KZO-159: schema is `.strict()` — unknown keys are rejected so that
      // future fields cannot be silently dropped by the handler diff logic.
      const result = patchAdminSettingsSchema.safeParse({ unknownField: 1 });
      expect(result.success).toBe(false);
    });
  });

  // KZO-159 (158A) — schema accepts PATCH payloads that omit one or both
  // tracked fields. Each becomes optional so the admin UI can update just
  // the timeframe list or just the cooldown without surfacing a "missing
  // field" error. An empty body is also accepted (treated as a no-op PATCH
  // by the handler).
  describe("KZO-159 — fields optional", () => {
    it("empty object is valid (no-op PATCH)", () => {
      const result = patchAdminSettingsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("only dashboardPerformanceRanges present", () => {
      const result = patchAdminSettingsSchema.safeParse({
        dashboardPerformanceRanges: ["1M", "3M", "YTD", "1Y"],
      });
      expect(result.success).toBe(true);
    });

    it("dashboardPerformanceRanges = null clears override", () => {
      const result = patchAdminSettingsSchema.safeParse({
        dashboardPerformanceRanges: null,
      });
      expect(result.success).toBe(true);
    });

    it("both fields present", () => {
      const result = patchAdminSettingsSchema.safeParse({
        repairCooldownMinutes: 60,
        dashboardPerformanceRanges: ["1M", "YTD"],
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid range element in dashboardPerformanceRanges", () => {
      const result = patchAdminSettingsSchema.safeParse({
        dashboardPerformanceRanges: ["1M", "2W"],
      });
      expect(result.success).toBe(false);
    });

    it("rejects duplicate ranges", () => {
      const result = patchAdminSettingsSchema.safeParse({
        dashboardPerformanceRanges: ["1M", "1M"],
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty ranges list", () => {
      const result = patchAdminSettingsSchema.safeParse({
        dashboardPerformanceRanges: [],
      });
      expect(result.success).toBe(false);
    });
  });
});
