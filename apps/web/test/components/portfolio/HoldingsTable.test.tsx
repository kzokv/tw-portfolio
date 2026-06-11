import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardOverviewHoldingGroupDto } from "@vakwen/shared-types";
import { holdingGroupMatchesStatusFilter, HoldingsTable } from "../../../components/portfolio/HoldingsTable";
import { getDictionary } from "../../../lib/i18n";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(async () => ({ preferences: {} })),
  patchJson: vi.fn(async () => ({ preferences: {} })),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const dict = getDictionary("en");

const baseGroup: DashboardOverviewHoldingGroupDto = {
  ticker: "AAPL",
  marketCode: "US",
  quantity: 10,
  costBasisAmount: 1_000,
  currency: "USD",
  averageCostPerShare: 100,
  currentUnitPrice: 110,
  marketValueAmount: 1_100,
  unrealizedPnlAmount: 100,
  allocationPct: 100,
  change: 1,
  changePercent: 0.91,
  previousClose: 109,
  quoteStatus: "current",
  nextDividendDate: null,
  lastDividendPostedDate: null,
  freshness: "current",
  freshnessTooltip: null,
  accountCount: 1,
  reportingCurrency: "TWD",
  reportingCostBasisAmount: 32_000,
  reportingMarketValueAmount: 35_200,
  reportingUnrealizedPnlAmount: 3_200,
  reportingAllocationPercent: 100,
  fxStatus: "complete",
  allocationBasisUsed: "market_value",
  allocationBasisFallbackReason: null,
  children: [],
};

function renderTable(holdingGroups: DashboardOverviewHoldingGroupDto[], options: { controlledAllocationBasis?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const allocationProps = options.controlledAllocationBasis === false ? {} : { allocationBasis: "market_value" as const };
  act(() => {
    root.render(
      <HoldingsTable
        accounts={[]}
        {...allocationProps}
        dict={dict}
        holdingGroups={holdingGroups}
        holdings={[]}
        instruments={[]}
        locale="en"
      />,
    );
  });
  return { container, root };
}

describe("HoldingsTable", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("does not render native values as reporting-currency values when reporting amounts are missing", () => {
    const rendered = renderTable([{
      ...baseGroup,
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
      reportingAllocationPercent: null,
      fxStatus: "missing",
    }]);
    root = rendered.root;
    container = rendered.container;

    const row = container.querySelector("[data-testid='holding-group-row-AAPL-US']");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain(dict.holdings.fxStatusMissing);
    expect(row?.textContent).toContain("-");
    expect(row?.textContent).not.toContain("$1,100");
    expect(row?.textContent).not.toContain("$1,000");
    expect(row?.textContent).not.toContain("NT$1,100");
    expect(row?.textContent).not.toContain("NT$1,000");
  });

  it("keeps shadcn single-toggle controls selected when the active item is clicked again", () => {
    const rendered = renderTable([baseGroup], { controlledAllocationBasis: false });
    root = rendered.root;
    container = rendered.container;

    const groupedMode = container.querySelector('[data-testid="holdings-display-mode-expanded"]');
    const marketValueBasis = container.querySelector('[data-testid="holdings-allocation-basis-market-value"]');
    const layoutStyleControl = container.querySelector('[data-testid="holdings-layout-style-control"]');
    const portfolioSection = container.querySelector('[data-testid="portfolio-holdings-section"]');
    const tickerHeader = container.querySelector('[data-testid="holdings-column-drag-ticker"]')?.closest("th");
    const tickerCell = container.querySelector("[data-testid='holding-group-row-AAPL-US'] td");
    expect(portfolioSection).not.toBeNull();
    expect(groupedMode?.getAttribute("data-state")).toBe("on");
    expect(marketValueBasis?.getAttribute("data-state")).toBe("on");
    expect(layoutStyleControl).toBeNull();
    expect(tickerHeader?.className).toContain("sticky");
    expect(tickerCell?.className).toContain("sticky");

    act(() => {
      groupedMode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      marketValueBasis?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(groupedMode?.getAttribute("data-state")).toBe("on");
    expect(marketValueBasis?.getAttribute("data-state")).toBe("on");
  });

  it("keeps mixed-status tickers visible when account-row status filters match a child row", () => {
    const mixedGroup: DashboardOverviewHoldingGroupDto = {
      ...baseGroup,
      ticker: "MIXED",
      quoteStatus: "missing",
      accountCount: 2,
      children: [
        {
          ...baseGroup,
          accountId: "acc-current",
          accountName: "Current account",
          ticker: "MIXED",
          quoteStatus: "current",
          reportingAllocationPercent: 70,
        },
        {
          ...baseGroup,
          accountId: "acc-missing",
          accountName: "Missing account",
          ticker: "MIXED",
          quoteStatus: "missing",
          currentUnitPrice: null,
          marketValueAmount: null,
          unrealizedPnlAmount: null,
          reportingMarketValueAmount: null,
          reportingUnrealizedPnlAmount: null,
          reportingAllocationPercent: 30,
        },
      ],
    };

    expect(holdingGroupMatchesStatusFilter(mixedGroup, ["current"], "aggregated")).toBe(false);
    expect(holdingGroupMatchesStatusFilter(mixedGroup, ["current"], "expanded")).toBe(true);
    expect(holdingGroupMatchesStatusFilter(mixedGroup, ["current"], "accounts")).toBe(true);
  });
});
