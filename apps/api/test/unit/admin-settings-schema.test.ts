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

    it("repairCooldownMinutes missing", () => {
      const result = patchAdminSettingsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
