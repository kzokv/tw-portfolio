// KZO-198 — Unit tests for the bounds.ts schema invariants.
import { describe, expect, it } from "vitest";
import {
  APP_CONFIG_BOUNDS,
  APP_CONFIG_SECRET_LENGTH,
} from "../../../src/services/appConfig/bounds.js";

// KZO-198 — Tier 1 numeric fields surfaced via APP_CONFIG_BOUNDS. Tier 2
// (dailyRefresh*, sse*) is DB+SQL only and intentionally absent from the
// bounds object per scope-todo.
const TIER_1_NUMERIC_FIELDS = [
  "marketDataPriceWindowMs",
  "marketDataPriceLimit",
  "marketDataSearchWindowMs",
  "marketDataSearchLimit",
  "inviteStatusWindowMs",
  "inviteStatusLimit",
  "providerDownNotificationSuppressionMs",
  "providerErrorTrailRetentionDays",
  "providerRerunCooldownMs",
  "providerFixerDangerousMatchThreshold",
  "providerFixerPreviewSampleLimit",
  "providerFixerUiPageSize",
  "providerFixerAutoPauseFailuresPerMinute",
  "providerFixerPreviewTokenTtlMinutes",
  "providerOperationAutoRenewIntervalMinutes",
  "providerIncidentRecurrenceWindowMinutes",
  "providerHealthWarningUnresolvedThreshold",
  "providerHealthCriticalUnresolvedThreshold",
  "providerOperationStaleHeartbeatMinutes",
  "providerOperationSummaryRetentionDays",
  "providerOperationLogRetentionDays",
  "providerIncidentRetentionDays",
  "providerResolvedItemRetentionDays",
  "backfillRetryLimit",
  "backfillRetryDelaySeconds",
  "backfillFinmind402RetryMs",
] as const;

describe("APP_CONFIG_BOUNDS — schema invariants", () => {
  it("declares Tier 0 plaintext length 20–500", () => {
    expect(APP_CONFIG_SECRET_LENGTH).toEqual({ min: 20, max: 500 });
  });

  it("min ≥ 0 and max > min for every Tier 1/2 numeric field", () => {
    for (const field of TIER_1_NUMERIC_FIELDS) {
      const b = APP_CONFIG_BOUNDS[field as keyof typeof APP_CONFIG_BOUNDS] as {
        min: number;
        max: number;
      };
      expect(b, `field ${field} missing from APP_CONFIG_BOUNDS`).toBeDefined();
      expect(b.min, `field ${field} min < 0`).toBeGreaterThanOrEqual(0);
      expect(b.max, `field ${field} max <= min`).toBeGreaterThan(b.min);
      expect(Number.isInteger(b.min), `field ${field} min not integer`).toBe(true);
      expect(Number.isInteger(b.max), `field ${field} max not integer`).toBe(true);
    }
  });

  it("includes the existing repairCooldownMinutes bound (legacy field surfaced via single source)", () => {
    // Pre-existing PATCH bound is 10080 (7 days in minutes) — see
    // `apps/api/test/unit/admin-settings-schema.test.ts`. KZO-198 surfaces it
    // via APP_CONFIG_BOUNDS without changing the value.
    expect(APP_CONFIG_BOUNDS.repairCooldownMinutes).toMatchObject({ min: 1, max: 10080 });
  });

  it("every Tier 1 numeric field above appears in APP_CONFIG_BOUNDS (locks the schema)", () => {
    for (const field of TIER_1_NUMERIC_FIELDS) {
      expect(field in APP_CONFIG_BOUNDS, `${field} should be in APP_CONFIG_BOUNDS`).toBe(true);
    }
  });
});
