/**
 * KZO-195 — Unit tests for the pure detector `detectDelistingsByAbsence`.
 *
 * Mirrors scope-todo Phase 9 Suite 4 list:
 *   1. Below threshold       — streak=2, threshold=3 → bump only, no stamp
 *   2. At threshold          — streak=2 + 1 from this run → stamp
 *   3. Guard floor trip      — small catalog (size=10), 6 absent → trips floor (5)
 *   4. Guard percent trip    — large catalog (size=1000), 11 absent → trips 1.0%
 *   5. Excluded row          — `delistingDetectionExcluded=true` → never candidate
 *   6. LIC null row          — `lastSeenInCatalogAt=null` → never candidate
 *
 * The pure function signature is locked in scope-todo R2/Phase 3:
 *
 *   interface AbsentRow {
 *     ticker: string;
 *     absenceStreak: number;
 *     lastSeenInCatalogAt: string | null;
 *     delistingDetectionExcluded: boolean;
 *   }
 *   interface DetectionOptions {
 *     threshold: number;
 *     guardPercent: number;   // e.g. 1.0 for 1%
 *     guardFloor: number;
 *     prevCatalogSize: number;
 *   }
 *   interface DetectionPlan {
 *     guardTripped: boolean;
 *     toBump: string[];
 *     toStamp: string[];
 *     absentTickers: string[];
 *   }
 *
 * NOTE (TDD-RED): the import target does NOT yet exist when this file lands —
 * Backend Implementer creates `apps/api/src/services/market-data/detectDelistingsByAbsence.ts`
 * in Phase 3. Tests will fail with a missing-module error until then.
 */

import { describe, it, expect } from "vitest";
import {
  detectDelistingsByAbsence,
  type AbsentRow,
  type DetectionOptions,
} from "../../src/services/market-data/detectDelistingsByAbsence.js";

function row(overrides: Partial<AbsentRow> & { ticker: string }): AbsentRow {
  // Use a key-presence check on `lastSeenInCatalogAt` so explicit `null`
  // overrides (LIC / never-observed cases) are honored. The previous
  // `?? "2026-..."` pattern silently coerced `null` into the default ISO
  // string, masking the LIC test fixture.
  const hasLastSeen = Object.prototype.hasOwnProperty.call(overrides, "lastSeenInCatalogAt");
  return {
    ticker: overrides.ticker,
    absenceStreak: overrides.absenceStreak ?? 0,
    lastSeenInCatalogAt: hasLastSeen ? (overrides.lastSeenInCatalogAt ?? null) : "2026-05-01T00:00:00Z",
    delistingDetectionExcluded: overrides.delistingDetectionExcluded ?? false,
  };
}

describe("detectDelistingsByAbsence (KZO-195 Phase 3 / R2)", () => {
  it("[1] below threshold: streak=2, threshold=3 → bump only, no stamp", () => {
    const absent: AbsentRow[] = [row({ ticker: "AUDEL01", absenceStreak: 1 })];
    const opts: DetectionOptions = {
      threshold: 3,
      guardPercent: 1.0,
      guardFloor: 5,
      prevCatalogSize: 100,
    };
    const plan = detectDelistingsByAbsence(absent, opts);
    expect(plan.guardTripped).toBe(false);
    expect(plan.toBump).toEqual(["AUDEL01"]);
    expect(plan.toStamp).toEqual([]);
    expect(plan.absentTickers).toEqual(["AUDEL01"]);
  });

  it("[2] at threshold: streak=2 + 1 from this run → stamp", () => {
    const absent: AbsentRow[] = [row({ ticker: "AUDEL02", absenceStreak: 2 })];
    const opts: DetectionOptions = {
      threshold: 3,
      guardPercent: 1.0,
      guardFloor: 5,
      prevCatalogSize: 100,
    };
    const plan = detectDelistingsByAbsence(absent, opts);
    expect(plan.guardTripped).toBe(false);
    expect(plan.toBump).toEqual(["AUDEL02"]);
    expect(plan.toStamp).toEqual(["AUDEL02"]);
    expect(plan.absentTickers).toEqual(["AUDEL02"]);
  });

  it("[3] guard floor trip: small catalog (size=10), 6 absent → trips floor=5", () => {
    const absent: AbsentRow[] = [
      row({ ticker: "AUDEL01", absenceStreak: 0 }),
      row({ ticker: "AUDEL02", absenceStreak: 1 }),
      row({ ticker: "AUDEL03", absenceStreak: 0 }),
      row({ ticker: "AUDEL04", absenceStreak: 2 }),
      row({ ticker: "AUDEL05", absenceStreak: 0 }),
      row({ ticker: "AUDEL06", absenceStreak: 0 }),
    ];
    const opts: DetectionOptions = {
      threshold: 3,
      guardPercent: 1.0,
      guardFloor: 5,
      prevCatalogSize: 10,
    };
    const plan = detectDelistingsByAbsence(absent, opts);
    // 6 candidates > max(5, 10*1.0/100=0.1) = 5 → guard trips
    expect(plan.guardTripped).toBe(true);
    expect(plan.toBump).toEqual([]);
    expect(plan.toStamp).toEqual([]);
    expect(plan.absentTickers).toEqual([
      "AUDEL01",
      "AUDEL02",
      "AUDEL03",
      "AUDEL04",
      "AUDEL05",
      "AUDEL06",
    ]);
  });

  it("[4] guard percent trip: large catalog (size=1000), 11 absent → trips 1.0%", () => {
    const absent: AbsentRow[] = Array.from({ length: 11 }, (_, i) =>
      row({ ticker: `AUDEL${String(i + 1).padStart(2, "0")}`, absenceStreak: 0 }),
    );
    const opts: DetectionOptions = {
      threshold: 3,
      guardPercent: 1.0,
      guardFloor: 5,
      prevCatalogSize: 1000,
    };
    const plan = detectDelistingsByAbsence(absent, opts);
    // 11 candidates > max(5, 1000*1.0/100=10) = 10 → guard trips
    expect(plan.guardTripped).toBe(true);
    expect(plan.toBump).toEqual([]);
    expect(plan.toStamp).toEqual([]);
    expect(plan.absentTickers).toHaveLength(11);
  });

  it("[5] excluded row: delistingDetectionExcluded=true → never candidate", () => {
    const absent: AbsentRow[] = [
      row({ ticker: "AUDEL07", absenceStreak: 5, delistingDetectionExcluded: true }),
    ];
    const opts: DetectionOptions = {
      threshold: 3,
      guardPercent: 1.0,
      guardFloor: 5,
      prevCatalogSize: 100,
    };
    const plan = detectDelistingsByAbsence(absent, opts);
    expect(plan.guardTripped).toBe(false);
    expect(plan.toBump).toEqual([]);
    expect(plan.toStamp).toEqual([]);
    expect(plan.absentTickers).toEqual([]);
  });

  it("[6] LIC null row: lastSeenInCatalogAt=null → never candidate", () => {
    const absent: AbsentRow[] = [
      row({ ticker: "AUDEL08", absenceStreak: 5, lastSeenInCatalogAt: null }),
    ];
    const opts: DetectionOptions = {
      threshold: 3,
      guardPercent: 1.0,
      guardFloor: 5,
      prevCatalogSize: 100,
    };
    const plan = detectDelistingsByAbsence(absent, opts);
    expect(plan.guardTripped).toBe(false);
    expect(plan.toBump).toEqual([]);
    expect(plan.toStamp).toEqual([]);
    expect(plan.absentTickers).toEqual([]);
  });

  it("[mix] non-candidates filtered before guard math: 5 candidates + 5 excluded → no trip on floor=5", () => {
    // The guard compares CANDIDATES (post-filter), not absent input length.
    // 5 candidates is NOT strictly > max(5, …) → guard does not trip; bumps proceed.
    const absent: AbsentRow[] = [
      row({ ticker: "AUDEL10", absenceStreak: 0 }),
      row({ ticker: "AUDEL11", absenceStreak: 0 }),
      row({ ticker: "AUDEL12", absenceStreak: 0 }),
      row({ ticker: "AUDEL13", absenceStreak: 0 }),
      row({ ticker: "AUDEL14", absenceStreak: 0 }),
      row({ ticker: "AUDEL15", delistingDetectionExcluded: true }),
      row({ ticker: "AUDEL16", delistingDetectionExcluded: true }),
      row({ ticker: "AUDEL17", lastSeenInCatalogAt: null }),
      row({ ticker: "AUDEL18", lastSeenInCatalogAt: null }),
      row({ ticker: "AUDEL19", lastSeenInCatalogAt: null }),
    ];
    const opts: DetectionOptions = {
      threshold: 3,
      guardPercent: 1.0,
      guardFloor: 5,
      prevCatalogSize: 100,
    };
    const plan = detectDelistingsByAbsence(absent, opts);
    expect(plan.guardTripped).toBe(false);
    expect(plan.toBump).toHaveLength(5);
    expect(plan.toStamp).toEqual([]);
    expect(plan.absentTickers).toHaveLength(5);
  });
});
