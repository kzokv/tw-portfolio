import { describe, expect, it } from "vitest";
import type { QuoteSnapshot } from "@vakwen/domain";
import type { DashboardOverviewHoldingGroupDto } from "../../../../libs/shared-types/src/index.js";
import { buildDashboardOverview, buildOverviewHoldingGroups } from "../../src/services/dashboard.js";
import { translateOverviewHoldingGroups } from "../../src/services/dashboardReportingCurrency.js";
import type { Persistence } from "../../src/persistence/types.js";
import type { Store } from "../../src/types/store.js";

function makeStore(input: {
  accounts: Array<{ id: string; name: string; defaultCurrency: "TWD" | "USD" | "AUD" | "KRW" }>;
  holdings: Array<{ accountId: string; ticker: string; quantity: number; costBasisAmount: number; currency: string }>;
  instruments?: Array<{ ticker: string; marketCode: "TW" | "US" | "AU" | "KR"; name: string }>;
  catalogInstruments?: Array<{ ticker: string; marketCode: "TW" | "US" | "AU" | "KR"; name: string }>;
}): Store {
  return {
    settings: {
      userId: "user-1",
      locale: "en",
      costBasisMethod: "WEIGHTED_AVERAGE",
      quotePollIntervalSeconds: 60,
    },
    accounts: input.accounts.map((account) => ({
      ...account,
      userId: "user-1",
      feeProfileId: `${account.id}-fee-profile`,
      accountType: "broker",
    })),
    accounting: {
      projections: {
        holdings: input.holdings,
      },
      facts: {
        dividendLedgerEntries: [],
        dividendDeductionEntries: [],
      },
    },
    marketData: {
      dividendEvents: [],
      instruments: input.instruments ?? [],
    },
    instruments: (input.catalogInstruments ?? []).map((instrument) => ({
      ...instrument,
      type: "STOCK",
      isProvisional: false,
    })),
    feeProfiles: [],
    feeProfileBindings: [],
  } as unknown as Store;
}

function makePersistence(fxRates: Record<string, number>): Persistence {
  return {
    getFxRate: async (base: string, quote: string) => {
      if (base === quote) return 1;
      return fxRates[`${base}:${quote}`] ?? null;
    },
  } as unknown as Persistence;
}

function findGroup(
  groups: DashboardOverviewHoldingGroupDto[],
  ticker: string,
  marketCode: string,
): DashboardOverviewHoldingGroupDto {
  const match = groups.find((group) => group.ticker === ticker && group.marketCode === marketCode);
  if (!match) {
    throw new Error(`Expected group ${ticker}:${marketCode}`);
  }
  return match;
}

describe("dashboard holdingGroups", () => {
  it("aggregates same-market holdings across accounts and keeps same bare ticker split by market", async () => {
    const store = makeStore({
      accounts: [
        { id: "acc-us-1", name: "US One", defaultCurrency: "USD" },
        { id: "acc-us-2", name: "US Two", defaultCurrency: "USD" },
        { id: "acc-au-1", name: "AU One", defaultCurrency: "AUD" },
      ],
      holdings: [
        { accountId: "acc-us-1", ticker: "BHP", quantity: 10, costBasisAmount: 1_000, currency: "USD" },
        { accountId: "acc-us-2", ticker: "BHP", quantity: 5, costBasisAmount: 600, currency: "USD" },
        { accountId: "acc-au-1", ticker: "BHP", quantity: 8, costBasisAmount: 200, currency: "AUD" },
      ],
      catalogInstruments: [
        { ticker: "BHP", marketCode: "US", name: "BHP Group US" },
        { ticker: "BHP", marketCode: "AU", name: "BHP Group AU" },
      ],
    });
    const quotes: QuoteSnapshot[] = [
      {
        ticker: "BHP",
        marketCode: "US",
        close: 120,
        previousClose: 118,
        change: 2,
        changePercent: 1.6949,
        asOf: "2026-06-01",
        source: "test",
        isProvisional: false,
      },
      {
        ticker: "BHP",
        marketCode: "AU",
        close: 30,
        previousClose: 29,
        change: 1,
        changePercent: 3.4483,
        asOf: "2026-06-01",
        source: "test",
        isProvisional: false,
      },
    ];

    const overview = buildDashboardOverview(store, {
      integrityIssue: null,
      quotes,
    });

    const holdingGroups = await translateOverviewHoldingGroups(
      overview.holdingGroups,
      "TWD",
      "market_value",
      "2026-06-01",
      makePersistence({
        "USD:TWD": 32,
        "AUD:TWD": 21,
      }),
    );

    expect(overview.holdings).toHaveLength(3);
    expect(holdingGroups).toHaveLength(2);

    const usGroup = findGroup(holdingGroups, "BHP", "US");
    expect(usGroup.instrumentName).toBe("BHP Group US");
    expect(usGroup.children.every((child) => child.instrumentName === "BHP Group US")).toBe(true);
    expect(usGroup.accountCount).toBe(2);
    expect(usGroup.quantity).toBe(15);
    expect(usGroup.costBasisAmount).toBe(1_600);
    expect(usGroup.averageCostPerShare).toBe(106.67);
    expect(usGroup.currentUnitPrice).toBe(120);
    expect(usGroup.reportingCurrentUnitPrice).toBe(3_840);
    expect(usGroup.marketValueAmount).toBe(1_800);
    expect(usGroup.unrealizedPnlAmount).toBe(200);
    expect(usGroup.quoteStatus).toBe("current");
    expect(usGroup.reportingCurrency).toBe("TWD");
    expect(usGroup.reportingCostBasisAmount).toBe(51_200);
    expect(usGroup.reportingMarketValueAmount).toBe(57_600);
    expect(usGroup.reportingUnrealizedPnlAmount).toBe(6_400);
    expect(usGroup.fxStatus).toBe("complete");
    expect(usGroup.allocationBasisUsed).toBe("market_value");
    expect(usGroup.allocationBasisFallbackReason).toBe(null);
    expect(usGroup.reportingAllocationPercent).toBeCloseTo(91.954);
    expect(usGroup.children).toHaveLength(2);
    expect(usGroup.children[0]?.reportingCurrency).toBe("TWD");
    expect(usGroup.children[0]?.reportingCurrentUnitPrice).toBe(3_840);

    const auGroup = findGroup(holdingGroups, "BHP", "AU");
    expect(auGroup.instrumentName).toBe("BHP Group AU");
    expect(auGroup.accountCount).toBe(1);
    expect(auGroup.quantity).toBe(8);
    expect(auGroup.costBasisAmount).toBe(200);
    expect(auGroup.currentUnitPrice).toBe(30);
    expect(auGroup.reportingCurrentUnitPrice).toBe(630);
    expect(auGroup.reportingCostBasisAmount).toBe(4_200);
    expect(auGroup.reportingMarketValueAmount).toBe(5_040);
    expect(auGroup.reportingAllocationPercent).toBeCloseTo(8.046);
  });

  it("uses cost-basis fallback metadata for allocation when market value is missing", async () => {
    const store = makeStore({
      accounts: [
        { id: "acc-tw-1", name: "TW One", defaultCurrency: "TWD" },
        { id: "acc-us-1", name: "US One", defaultCurrency: "USD" },
      ],
      holdings: [
        { accountId: "acc-tw-1", ticker: "2330", quantity: 10, costBasisAmount: 500, currency: "TWD" },
        { accountId: "acc-us-1", ticker: "AAPL", quantity: 1, costBasisAmount: 10, currency: "USD" },
      ],
    });
    const quotes: QuoteSnapshot[] = [
      {
        ticker: "2330",
        marketCode: "TW",
        close: 100,
        previousClose: 99,
        change: 1,
        changePercent: 1.0101,
        asOf: "2026-06-01",
        source: "test",
        isProvisional: false,
      },
    ];

    const overview = buildDashboardOverview(store, {
      integrityIssue: null,
      quotes,
    });

    const holdingGroups = await translateOverviewHoldingGroups(
      overview.holdingGroups,
      "TWD",
      "market_value",
      "2026-06-01",
      makePersistence({
        "USD:TWD": 32,
      }),
    );

    const twGroup = findGroup(holdingGroups, "2330", "TW");
    const usGroup = findGroup(holdingGroups, "AAPL", "US");

    expect(twGroup.allocationBasisUsed).toBe("market_value");
    expect(twGroup.allocationBasisFallbackReason).toBe(null);
    expect(twGroup.reportingAllocationPercent).toBeCloseTo(75.7575);

    expect(usGroup.quoteStatus).toBe("missing");
    expect(usGroup.marketValueAmount).toBe(null);
    expect(usGroup.reportingMarketValueAmount).toBe(null);
    expect(usGroup.reportingCostBasisAmount).toBe(320);
    expect(usGroup.allocationBasisUsed).toBe("cost_basis");
    expect(usGroup.allocationBasisFallbackReason).toBe("missing_quote");
    expect(usGroup.reportingAllocationPercent).toBeCloseTo(24.2424);
    expect(usGroup.children[0]?.allocationBasisUsed).toBe("cost_basis");
    expect(usGroup.children[0]?.allocationBasisFallbackReason).toBe("missing_quote");
  });

  it("rebuilds grouped rows from freshness-enriched holdings", () => {
    const store = makeStore({
      accounts: [
        { id: "acc-us-1", name: "US One", defaultCurrency: "USD" },
        { id: "acc-us-2", name: "US Two", defaultCurrency: "USD" },
      ],
      holdings: [
        { accountId: "acc-us-1", ticker: "AAPL", quantity: 1, costBasisAmount: 100, currency: "USD" },
        { accountId: "acc-us-2", ticker: "AAPL", quantity: 2, costBasisAmount: 200, currency: "USD" },
      ],
    });
    const overview = buildDashboardOverview(store, {
      integrityIssue: null,
      quotes: [],
    });
    const staleHolding = overview.holdings.find((holding) => holding.accountId === "acc-us-1");
    if (!staleHolding) throw new Error("Expected acc-us-1 holding");
    staleHolding.freshness = "stale_red";
    staleHolding.freshnessTooltip = "Last quote 14 days ago";

    const holdingGroups = buildOverviewHoldingGroups(store, overview.holdings);
    const group = findGroup(holdingGroups, "AAPL", "US");

    expect(group.freshness).toBe("stale_red");
    expect(group.freshnessTooltip).toBe("Last quote 14 days ago");
    expect(group.children.find((child) => child.accountId === "acc-us-1")?.freshness).toBe("stale_red");
    expect(group.children.find((child) => child.accountId === "acc-us-2")?.freshness).toBe("current");
  });

});
