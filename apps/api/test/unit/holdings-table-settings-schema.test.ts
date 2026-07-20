import { describe, expect, it } from "vitest";
import {
  adminMarketDataTableSettingsPreferenceSchema,
  holdingsTableSettingsPreferenceSchema,
} from "@vakwen/shared-types";
import type { AdminMarketDataTableContextPreferenceDto } from "@vakwen/shared-types";

const HOLDINGS_SORT_FIELDS = [
  "ticker",
  "accountCount",
  "quantity",
  "averageCost",
  "price",
  "unitPnl",
  "marketValue",
  "costBasis",
  "dailyChangePercent",
  "unrealizedPnl",
  "allocation",
  "dataHealth",
  "nextDividendDate",
  "lastDividendDate",
] as const;

function holdingsSettings(context: Record<string, unknown>) {
  return {
    version: 1,
    contexts: {
      "dashboard.topHoldings": context,
    },
  };
}

describe("holdings table settings preference schema", () => {
  it("[holdings-sort-contract]: every semantic field and direction is accepted in field mode", () => {
    for (const sortField of HOLDINGS_SORT_FIELDS) {
      for (const sortDirection of ["asc", "desc"] as const) {
        expect(
          holdingsTableSettingsPreferenceSchema.safeParse(
            holdingsSettings({ sortMode: "field", sortField, sortDirection }),
          ).success,
          `${sortField}/${sortDirection}`,
        ).toBe(true);
      }
    }
  });

  it("[holdings-sort-contract]: invalid field or direction is rejected", () => {
    expect(
      holdingsTableSettingsPreferenceSchema.safeParse(
        holdingsSettings({
          sortMode: "field",
          sortField: "position",
          sortDirection: "sideways",
        }),
      ).success,
    ).toBe(false);
  });

  it("[holdings-sort-contract]: field mode requires both a semantic field and direction", () => {
    expect(
      holdingsTableSettingsPreferenceSchema.safeParse(
        holdingsSettings({ sortMode: "field", sortDirection: "asc" }),
      ).success,
    ).toBe(false);
    expect(
      holdingsTableSettingsPreferenceSchema.safeParse(
        holdingsSettings({ sortMode: "field", sortField: "ticker" }),
      ).success,
    ).toBe(false);
  });

  it("[holdings-sort-contract]: active field state without an explicit mode is rejected", () => {
    expect(
      holdingsTableSettingsPreferenceSchema.safeParse(
        holdingsSettings({ sortField: "ticker", sortDirection: "asc" }),
      ).success,
    ).toBe(false);
    expect(
      holdingsTableSettingsPreferenceSchema.safeParse(
        holdingsSettings({ sortField: "ticker" }),
      ).success,
    ).toBe(false);
    expect(
      holdingsTableSettingsPreferenceSchema.safeParse(
        holdingsSettings({ sortDirection: "asc" }),
      ).success,
    ).toBe(false);
  });

  it("[holdings-sort-contract]: custom mode accepts no active field state and rejects contradictions", () => {
    expect(
      holdingsTableSettingsPreferenceSchema.safeParse(
        holdingsSettings({ sortMode: "custom" }),
      ).success,
    ).toBe(true);
    expect(
      holdingsTableSettingsPreferenceSchema.safeParse(
        holdingsSettings({
          sortMode: "custom",
          sortField: "ticker",
          sortDirection: "asc",
        }),
      ).success,
    ).toBe(false);
  });

  it("[holdings-sort-contract]: legacy version 1 settings remain valid without sorting", () => {
    expect(
      holdingsTableSettingsPreferenceSchema.safeParse(
        holdingsSettings({
          columnOrder: ["ticker", "quantity"],
          hiddenColumns: ["quantity"],
          rowOrder: ["TW:2330", "US:NVDA"],
        }),
      ).success,
    ).toBe(true);
  });

  it("[admin-market-data-contract]: legacy schema stays valid but does not accept holdings sorting", () => {
    type AdminContextHasSortMode = "sortMode" extends keyof AdminMarketDataTableContextPreferenceDto
      ? true
      : false;
    const adminContextHasSortMode: AdminContextHasSortMode = false;
    expect(adminContextHasSortMode).toBe(false);

    const legacyAdminSettings = {
      version: 1,
      contexts: {
        "admin.marketData.TW.instruments": {
          columnOrder: ["ticker", "status"],
          hiddenColumns: ["providers"],
        },
      },
    };
    expect(adminMarketDataTableSettingsPreferenceSchema.safeParse(legacyAdminSettings).success).toBe(true);

    const withHoldingsSort = structuredClone(legacyAdminSettings) as {
      contexts: Record<string, Record<string, unknown>>;
    };
    withHoldingsSort.contexts["admin.marketData.TW.instruments"]!.sortMode = "field";
    withHoldingsSort.contexts["admin.marketData.TW.instruments"]!.sortField = "ticker";
    withHoldingsSort.contexts["admin.marketData.TW.instruments"]!.sortDirection = "asc";
    expect(adminMarketDataTableSettingsPreferenceSchema.safeParse(withHoldingsSort).success).toBe(false);
  });
});
