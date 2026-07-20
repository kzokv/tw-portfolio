import { describe, expect, it } from "vitest";
import * as preferenceHelpers from "../../../components/holdings/holdingsPreferenceHelpers";

describe("holdings preference sorting migration", () => {
  it("contextually expands Dashboard Position while preserving order, hidden state, and width intent", () => {
    const resolved = preferenceHelpers.resolveHoldingsTableSettingsPreference({
      version: 1,
      contexts: {
        "dashboard.topHoldings": {
          columnOrder: ["ticker", "position", "price", "pnl"],
          hiddenColumns: ["position"],
          columnWidths: { position: 180 },
          layoutStyle: "dashboard",
        },
      },
    });

    expect(resolved.contexts["dashboard.topHoldings"]).toMatchObject({
      columnOrder: ["ticker", "quantity", "accounts", "allocation", "price", "unrealizedPnl"],
      hiddenColumns: ["quantity", "accounts", "allocation"],
    });
    expect(resolved.contexts["dashboard.topHoldings"]?.columnWidths).not.toMatchObject({
      quantity: 180,
      accounts: 180,
      allocation: 180,
    });
  });

  it("migrates every locked legacy alias to canonical holdings column identifiers", () => {
    const resolved = preferenceHelpers.resolveHoldingsTableSettingsPreference({
      version: 1,
      contexts: {
        "reports.market.detail": {
          columnOrder: [
            "ticker",
            "avgCost",
            "pnl",
            "unrealized",
            "daily",
            "weight",
            "health",
            "action",
            "nextDividend",
            "lastDividend",
          ],
          hiddenColumns: ["avgCost", "unrealized", "health", "action", "nextDividend", "lastDividend"],
          columnWidths: {
            action: 112,
            avgCost: 148,
            health: 192,
            lastDividend: 152,
            nextDividend: 152,
            weight: 128,
          },
          layoutStyle: "portfolio",
        },
      },
    });

    expect(resolved.contexts["reports.market.detail"]).toMatchObject({
      columnOrder: [
        "ticker",
        "averageCost",
        "unrealizedPnl",
        "dailyChange",
        "allocation",
        "dataHealth",
        "actions",
        "nextDividendDate",
        "lastDividendDate",
      ],
      hiddenColumns: ["averageCost", "unrealizedPnl", "dataHealth", "actions", "nextDividendDate", "lastDividendDate"],
      columnWidths: {
        actions: 112,
        allocation: 128,
        averageCost: 148,
        dataHealth: 192,
        lastDividendDate: 152,
        nextDividendDate: 152,
      },
    });
  });

  it("uses common Quantity, Accounts, and Allocation identifiers across Portfolio compact and detailed preferences", () => {
    const legacy = {
      columnOrder: ["ticker", "position", "weight"],
      hiddenColumns: ["position"],
      columnWidths: {},
      layoutStyle: "portfolio",
    };
    const resolved = preferenceHelpers.resolveHoldingsTableSettingsPreference({
      version: 1,
      contexts: {
        "holdings.shared": legacy,
        "portfolio.holdings": legacy,
      },
    });

    for (const contextKey of ["holdings.shared", "portfolio.holdings"] as const) {
      expect(resolved.contexts[contextKey]).toMatchObject({
        columnOrder: ["ticker", "quantity", "accounts", "allocation"],
        hiddenColumns: ["quantity", "accounts"],
      });
    }
  });

  it("contextually canonicalizes Reports Position, Weight, Daily, and bare P&L identifiers", () => {
    const resolved = preferenceHelpers.resolveHoldingsTableSettingsPreference({
      version: 1,
      contexts: {
        "reports.dailyReview.holdings": {
          columnOrder: ["ticker", "position", "weight", "daily", "pnl"],
          hiddenColumns: ["weight"],
          columnWidths: {},
          layoutStyle: "portfolio",
        },
      },
    });

    expect(resolved.contexts["reports.dailyReview.holdings"]).toMatchObject({
      columnOrder: ["ticker", "quantity", "accounts", "allocation", "dailyChange", "unrealizedPnl"],
      hiddenColumns: ["allocation"],
    });
  });

  it("infers Custom mode from legacy manual row order without manufacturing an active field", () => {
    const resolved = preferenceHelpers.resolveHoldingsTableSettingsPreference({
      version: 1,
      contexts: {
        "portfolio.holdings": {
          columnOrder: ["ticker", "quantity"],
          hiddenColumns: [],
          columnWidths: {},
          layoutStyle: "portfolio",
          rowOrder: ["US:AAPL", "TW:2330"],
        },
      },
    });

    expect(resolved.contexts["portfolio.holdings"]).toMatchObject({ sortMode: "custom" });
    expect(resolved.contexts["portfolio.holdings"]).not.toHaveProperty("sortField");
    expect(resolved.contexts["portfolio.holdings"]).not.toHaveProperty("sortDirection");
  });

  it("uses a runtime fallback for an unsupported field without deleting the stored preference", () => {
    type NormalizeSort = (args: {
      defaultSort: { sortDirection: "asc" | "desc"; sortField: string; sortMode: "custom" | "field" };
      rawContext: Record<string, unknown>;
      supportedFields: string[];
    }) => { sortDirection: "asc" | "desc"; sortField?: string; sortMode: "custom" | "field" };
    const normalizeSort = (preferenceHelpers as unknown as { normalizeHoldingsSortPreference?: NormalizeSort })
      .normalizeHoldingsSortPreference;
    expect(normalizeSort).toBeTypeOf("function");
    const stored = { sortDirection: "desc", sortField: "futureMetric", sortMode: "field" };
    const runtime = normalizeSort!({
      defaultSort: { sortDirection: "desc", sortField: "marketValue", sortMode: "field" },
      rawContext: stored,
      supportedFields: ["ticker", "marketValue"],
    });

    expect(runtime).toEqual({ sortDirection: "desc", sortField: "marketValue", sortMode: "field" });
    expect(stored).toEqual({ sortDirection: "desc", sortField: "futureMetric", sortMode: "field" });
  });
});
