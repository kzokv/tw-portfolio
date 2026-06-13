import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardOverviewHoldingGroupDto } from "@vakwen/shared-types";
import { useHoldingsColumnSettings, type HoldingsGridColumnDefinition } from "../../../components/holdings/HoldingsColumnSettings";
import { holdingGroupMatchesStatusFilter, HoldingsTable } from "../../../components/portfolio/HoldingsTable";
import { getJson } from "../../../lib/api";
import { getDictionary } from "../../../lib/i18n";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(async () => ({ preferences: {} })),
  patchJson: vi.fn(async () => ({ preferences: {} })),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const dict = getDictionary("en");
type TestColumn = "ticker" | "marketValue";

const testColumns: Array<HoldingsGridColumnDefinition<TestColumn>> = [
  { id: "ticker", label: "Ticker", defaultWidth: 120, canHide: false },
  { id: "marketValue", label: "Market Value", defaultWidth: 160, align: "right" },
];

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

function ColumnSettingsHarness() {
  const settings = useHoldingsColumnSettings<TestColumn>({
    columns: testColumns,
    contextKey: "portfolio",
  });
  return (
    <div>
      <p data-testid="visible-columns">{settings.visibleColumns.join(",")}</p>
      <button type="button" data-testid="toggle-market-value" onClick={() => settings.toggleColumn("marketValue")}>
        Toggle market value
      </button>
    </div>
  );
}

function renderColumnSettingsHarness() {
  const testContainer = document.createElement("div");
  document.body.appendChild(testContainer);
  const testRoot = createRoot(testContainer);
  act(() => {
    testRoot.render(<ColumnSettingsHarness />);
  });
  return { container: testContainer, root: testRoot };
}

describe("HoldingsTable", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getJson).mockResolvedValue({ preferences: {} });
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

  it("renders the instrument name beneath the ticker in portfolio rows", () => {
    const rendered = renderTable([{ ...baseGroup, instrumentName: "Apple Inc." }]);
    root = rendered.root;
    container = rendered.container;

    const row = container.querySelector("[data-testid='holding-group-row-AAPL-US']");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("AAPL");
    expect(row?.textContent).toContain("Apple Inc.");
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

  it("does not let late preference hydration overwrite local column edits", async () => {
    let resolvePreferences: (value: unknown) => void = () => undefined;
    vi.mocked(getJson).mockReturnValueOnce(new Promise((resolve) => {
      resolvePreferences = resolve;
    }) as ReturnType<typeof getJson>);

    const rendered = renderColumnSettingsHarness();
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector("[data-testid='visible-columns']")?.textContent).toContain("marketValue");

    await act(async () => {
      container?.querySelector("[data-testid='toggle-market-value']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[data-testid='visible-columns']")?.textContent).not.toContain("marketValue");

    await act(async () => {
      resolvePreferences({
        preferences: {
          holdingsTableSettings: {
            version: 1,
            contexts: {
              portfolio: {
                columnOrder: ["ticker", "marketValue"],
                columnWidths: {},
                hiddenColumns: [],
                layoutStyle: "portfolio",
              },
            },
          },
        },
      });
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='visible-columns']")?.textContent).not.toContain("marketValue");
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

  it("keeps hidden portfolio mobile columns out of card and details content", async () => {
    vi.mocked(getJson).mockResolvedValue({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "portfolio.holdings": {
              columnOrder: ["quantity", "avgCost", "unitPnl", "price", "dailyChange", "costBasis", "allocation", "ticker", "accounts", "marketValue", "pnl", "health", "nextDividend", "lastDividend"],
              hiddenColumns: ["accounts", "marketValue", "pnl", "health"],
              columnWidths: {},
              layoutStyle: "portfolio",
              mobileSummaryCount: 2,
            },
          },
        },
      },
    });
    const rendered = renderTable([baseGroup]);
    root = rendered.root;
    container = rendered.container;

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const mobileRow = container.querySelector("[data-testid='holding-group-mobile-row-AAPL-US']");
    expect(mobileRow).not.toBeNull();
    expect(mobileRow?.textContent).not.toContain(dict.holdings.marketValueTerm);
    expect(Array.from(mobileRow?.querySelectorAll("p") ?? []).some((node) => node.textContent === dict.holdings.pnlTerm)).toBe(false);
    expect(mobileRow?.textContent).not.toContain(dict.holdings.dataHealthTerm);
    expect(mobileRow?.textContent).not.toContain(dict.holdings.parentAccountCountLabel);

    const detailsButton = Array.from(mobileRow?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent?.includes(dict.reports.viewDetails));
    expect(detailsButton).toBeDefined();
    act(() => {
      detailsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mobileRow?.textContent).not.toContain(dict.holdings.marketValueTerm);
    expect(Array.from(mobileRow?.querySelectorAll("p") ?? []).some((node) => node.textContent === dict.holdings.pnlTerm)).toBe(false);
    expect(mobileRow?.textContent).not.toContain(dict.holdings.dataHealthTerm);
  });
});
