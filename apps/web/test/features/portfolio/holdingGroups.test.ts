import { describe, expect, it } from "vitest";
import type { DashboardOverviewHoldingDto } from "@vakwen/shared-types";
import {
  buildAllocationPercentages,
  buildHoldingGroupsFromHoldings,
  getAmountForAllocationBasis,
  resolveHoldingGroups,
} from "../../../features/portfolio/holdingGroups";

const holdings: DashboardOverviewHoldingDto[] = [
  {
    accountId: "acc-1",
    accountName: "Main Brokerage",
    ticker: "2330",
    quantity: 2_000,
    costBasisAmount: 1_185_472,
    currency: "TWD",
    averageCostPerShare: 593,
    currentUnitPrice: 610,
    marketValueAmount: 1_220_000,
    unrealizedPnlAmount: 34_528,
    allocationPct: 98.2,
    change: 5,
    changePercent: 0.82,
    previousClose: 605,
    quoteStatus: "current",
    nextDividendDate: null,
    lastDividendPostedDate: "2026-02-20",
    freshness: "current",
    freshnessTooltip: null,
  },
];

describe("resolveHoldingGroups", () => {
  it("preserves explicit null reporting amounts instead of relabeling native values", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("expected holding group");

    const resolved = resolveHoldingGroups({
      holdings,
      holdingGroups: [{
        ...group,
        reportingCurrency: "AUD",
        reportingCostBasisAmount: null,
        reportingMarketValueAmount: null,
        reportingUnrealizedPnlAmount: null,
        children: group.children.map((child) => ({
          ...child,
          reportingCurrency: "AUD",
          reportingCostBasisAmount: null,
          reportingMarketValueAmount: null,
          reportingUnrealizedPnlAmount: null,
        })),
      }],
    });

    expect(resolved[0]?.reportingCurrency).toBe("AUD");
    expect(resolved[0]?.reportingCostBasisAmount).toBeNull();
    expect(resolved[0]?.reportingMarketValueAmount).toBeNull();
    expect(resolved[0]?.reportingUnrealizedPnlAmount).toBeNull();
    expect(resolved[0]?.children[0]?.reportingCostBasisAmount).toBeNull();
    expect(resolved[0]?.children[0]?.reportingMarketValueAmount).toBeNull();
    expect(resolved[0]?.children[0]?.reportingUnrealizedPnlAmount).toBeNull();
  });

  it("keeps legacy native fallback only when reporting fields are absent", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("expected holding group");

    const legacyGroup = {
      ...group,
      children: group.children.map((child) => ({ ...child })),
    } as Record<string, unknown>;
    delete legacyGroup.reportingCostBasisAmount;
    delete legacyGroup.reportingMarketValueAmount;
    delete legacyGroup.reportingUnrealizedPnlAmount;
    const child = (legacyGroup.children as Array<Record<string, unknown>>)[0];
    if (!child) throw new Error("expected holding child");
    delete child.reportingCostBasisAmount;
    delete child.reportingMarketValueAmount;
    delete child.reportingUnrealizedPnlAmount;

    const resolved = resolveHoldingGroups({
      holdings,
      holdingGroups: [legacyGroup as never],
    });

    expect(resolved[0]?.reportingCurrency).toBe("TWD");
    expect(resolved[0]?.reportingCostBasisAmount).toBe(1_185_472);
    expect(resolved[0]?.reportingMarketValueAmount).toBe(1_220_000);
    expect(resolved[0]?.reportingUnrealizedPnlAmount).toBe(34_528);
  });

  it("does not use native values for allocation when reporting amounts are explicitly null", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("expected holding group");
    const missingReportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
      children: group.children,
    };

    expect(getAmountForAllocationBasis(missingReportingGroup, "cost_basis")).toEqual({
      amount: 0,
      usedFallback: true,
    });
    expect(getAmountForAllocationBasis(missingReportingGroup, "market_value")).toEqual({
      amount: 0,
      usedFallback: true,
    });
    expect(buildAllocationPercentages([missingReportingGroup], "cost_basis").get("2330::TW")).toBe(0);
  });
});
