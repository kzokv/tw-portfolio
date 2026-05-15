/**
 * KZO-196 — GICS taxonomy invariants. Co-located in `apps/api/test/unit/` (the
 * scope-todo's `libs/shared-types/test/gics.test.ts` would require bootstrapping
 * a vitest runner in shared-types; apps/api's vitest already aliases
 * `@vakwen/shared-types` to source so tests run in suite 4).
 */
import { describe, it, expect } from "vitest";
import {
  gicsSectors,
  gicsIndustryGroups,
  sectorForIndustryGroup,
  industryGroupsForSector,
} from "@vakwen/shared-types";

describe("KZO-196 — GICS taxonomy", () => {
  it("exports exactly 11 GICS sectors", () => {
    expect(gicsSectors).toHaveLength(11);
  });

  it("exports the post-2023 GICS industry-group count (25 rows)", () => {
    // Note: scope-todo §"Static GICS map" cited 24 (pre-2023 count). The
    // post-2023 GICS taxonomy adopted by S&P/MSCI has 25 industry groups
    // (Consumer Discretionary picked up "Distribution & Retail" while
    // Consumer Staples kept its own retail group). Implementing the modern
    // count keeps the AU sector dropdown aligned with the ASX feed's
    // current `GICS industry group` column values.
    expect(gicsIndustryGroups).toHaveLength(25);
  });

  it("every industry group's parent sector is in the 11-sector list", () => {
    const sectorNames = new Set(gicsSectors.map((s) => s.sector));
    for (const ig of gicsIndustryGroups) {
      expect(sectorNames.has(ig.sector)).toBe(true);
    }
  });

  it("every sector display key is unique", () => {
    const keys = gicsSectors.map((s) => s.displayKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every industry-group display key is unique", () => {
    const keys = gicsIndustryGroups.map((ig) => ig.displayKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every industry-group name is unique", () => {
    const names = gicsIndustryGroups.map((ig) => ig.industryGroup);
    expect(new Set(names).size).toBe(names.length);
  });

  describe("sectorForIndustryGroup", () => {
    it("returns the parent sector for every canonical industry group", () => {
      for (const ig of gicsIndustryGroups) {
        expect(sectorForIndustryGroup(ig.industryGroup)).toBe(ig.sector);
      }
    });

    it("returns null for unknown industry-group strings", () => {
      expect(sectorForIndustryGroup("Not Applic.")).toBeNull();
      expect(sectorForIndustryGroup("")).toBeNull();
      expect(sectorForIndustryGroup("Software & Services ")).toBeNull(); // trailing space
    });

    it("is case-sensitive", () => {
      expect(sectorForIndustryGroup("software & services")).toBeNull();
      expect(sectorForIndustryGroup("Software & Services")).toBe("Information Technology");
    });
  });

  describe("industryGroupsForSector", () => {
    it("inverse-maps to the same set as the forward map", () => {
      for (const sector of gicsSectors) {
        const groups = industryGroupsForSector(sector.sector);
        expect(groups.length).toBeGreaterThan(0);
        for (const g of groups) {
          expect(sectorForIndustryGroup(g)).toBe(sector.sector);
        }
      }
    });

    it("union of all sectors' industry-groups equals the full 25-row list", () => {
      const seen = new Set<string>();
      for (const sector of gicsSectors) {
        for (const g of industryGroupsForSector(sector.sector)) seen.add(g);
      }
      expect(seen.size).toBe(gicsIndustryGroups.length);
    });

    it("returns an empty array for unknown sectors", () => {
      expect(industryGroupsForSector("Aerospace")).toEqual([]);
      expect(industryGroupsForSector("")).toEqual([]);
    });
  });
});
