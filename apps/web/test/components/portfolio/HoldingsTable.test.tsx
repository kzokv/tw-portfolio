import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdingsTableSettingsPreferenceSchema, type DashboardOverviewHoldingGroupDto } from "@vakwen/shared-types";
import {
  HoldingsRowSettingsMenu,
  useHoldingsColumnSettings,
  type HoldingsColumnSettingsState,
  type HoldingsGridColumnDefinition,
} from "../../../components/holdings/HoldingsColumnSettings";
import { holdingGroupMatchesStatusFilter, HoldingsTable } from "../../../components/portfolio/HoldingsTable";
import { getJson, patchJson } from "../../../lib/api";
import { getDictionary } from "../../../lib/i18n";
import { testPriceState } from "../../fixtures/priceState";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(async () => ({ preferences: {} })),
  patchJson: vi.fn(async () => ({ preferences: {} })),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const dict = getDictionary("en");
type TestColumn = "ticker" | "marketValue";

const testColumns: Array<HoldingsGridColumnDefinition<TestColumn>> = [
  { id: "ticker", label: "Ticker", defaultWidth: 120, canHide: false },
  { id: "marketValue", label: "Market value", defaultWidth: 160, align: "right" },
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
  priceState: testPriceState(),
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
    contextKey: "holdings.shared",
  });
  return (
    <div>
      <p data-testid="visible-columns">{settings.visibleColumns.join(",")}</p>
      <p data-testid="selected-markets">{settings.selectedMarketCodes.join(",")}</p>
      <p data-testid="selected-accounts">{settings.selectedAccountIds.join(",")}</p>
      <button type="button" data-testid="toggle-market-value" onClick={() => settings.toggleColumn("marketValue")}>
        Toggle market value
      </button>
      <button type="button" data-testid="set-market-filters" onClick={() => settings.setSelectedMarketCodes(["US", "TW", "US"])}>
        Set market filters
      </button>
      <button type="button" data-testid="set-account-filters" onClick={() => settings.setSelectedAccountIds(["acc-1", "acc-2", "acc-1"])}>
        Set account filters
      </button>
      <button type="button" data-testid="set-row-order" onClick={() => settings.setRowOrder(["US:AAPL"])}>
        Set row order
      </button>
      <button type="button" data-testid="set-top-holdings-limit" onClick={() => settings.setTopHoldingsLimit(8)}>
        Set top holdings limit
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

function pointerDown(el: Element) {
  act(() => {
    const event = new MouseEvent("pointerdown", { bubbles: true, button: 0, cancelable: true, ctrlKey: false });
    Object.defineProperty(event, "button", { value: 0 });
    Object.defineProperty(event, "ctrlKey", { value: false });
    el.dispatchEvent(event);
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }));
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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

  it("renders price-state chips only for ticker group rows and aligns them by viewport", () => {
    const child = {
      ...baseGroup,
      accountId: "acc-1",
      accountName: "Brokerage",
      reportingAllocationPercent: 100,
    } as DashboardOverviewHoldingGroupDto["children"][number];
    const rendered = renderTable([{ ...baseGroup, accountCount: 1, children: [child] }]);
    root = rendered.root;
    container = rendered.container;

    const desktopGroupChip = container.querySelector("[data-testid='holdings-price-state-AAPL-US']");
    const mobileGroupChip = container.querySelector("[data-testid='holdings-mobile-price-state-AAPL-US']");
    expect(desktopGroupChip).not.toBeNull();
    expect(mobileGroupChip).not.toBeNull();
    expect(container.querySelector("[data-testid='holdings-price-state-acc-1-AAPL']")).toBeNull();
    expect(container.querySelector("[data-testid='holdings-mobile-price-state-acc-1-AAPL']")).toBeNull();
    expect(desktopGroupChip?.parentElement?.className).toContain("justify-end");
    expect(desktopGroupChip?.className).toContain("text-right");
    expect(mobileGroupChip?.parentElement?.className).toContain("justify-start");
  });

  it("renders portfolio holdings with aggregated dropdown defaults and sticky desktop headers", () => {
    const rendered = renderTable([baseGroup], { controlledAllocationBasis: false });
    root = rendered.root;
    container = rendered.container;

    const displayMode = container.querySelector('[data-testid="holdings-display-mode-select"]');
    const allocationBasis = container.querySelector('[data-testid="holdings-allocation-basis-select"]');
    const layoutStyleControl = container.querySelector('[data-testid="holdings-layout-style-control"]');
    const portfolioSection = container.querySelector('[data-testid="portfolio-holdings-section"]');
    const tickerHeader = container.querySelector('[data-testid="holdings-column-drag-ticker"]')?.closest("th");
    const tickerCell = container.querySelector("[data-testid='holding-group-row-AAPL-US'] td");
    expect(portfolioSection).not.toBeNull();
    expect(displayMode?.textContent).toContain(dict.holdings.displayModeAggregated);
    expect(allocationBasis?.textContent).toContain(dict.dashboardHome.allocationBasisMarketValue);
    expect(layoutStyleControl).toBeNull();
    expect(tickerHeader?.className).toContain("sticky");
    expect(tickerCell?.className).toContain("sticky");
  });

  it("ignores stale persisted market filters without cleaning stored preferences", async () => {
    vi.mocked(getJson).mockResolvedValue({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "holdings.shared": {
              columnOrder: ["ticker", "marketValue"],
              hiddenColumns: [],
              columnWidths: {},
              layoutStyle: "portfolio",
              selectedMarketCodes: ["JP"],
              selectedAccountIds: [],
            },
          },
        },
      },
    });
    const rendered = renderTable([baseGroup]);
    root = rendered.root;
    container = rendered.container;

    await flushPromises();

    expect(container.querySelector("[data-testid='holding-group-row-AAPL-US']")).not.toBeNull();
    expect(vi.mocked(patchJson)).not.toHaveBeenCalled();
  });

  it("keeps market filter menu open while selecting multiple markets", async () => {
    const rendered = renderTable([
      baseGroup,
      {
        ...baseGroup,
        ticker: "2330",
        instrumentName: "Taiwan Semiconductor Manufacturing",
        marketCode: "TW",
        currency: "TWD",
      },
    ]);
    root = rendered.root;
    container = rendered.container;

    const marketFilter = container.querySelector('[data-testid="holdings-filter-market"]');
    expect(marketFilter).not.toBeNull();
    pointerDown(marketFilter!);
    await flushPromises();

    const usOption = document.body.querySelector('[role="menuitemcheckbox"][data-radix-collection-item]');
    expect(usOption).not.toBeNull();
    click(usOption!);
    await flushPromises();

    expect(document.body.textContent).toContain(dict.holdings.marketFilterLabel);
    expect(document.body.textContent).toContain("TW");
  });

  it("preserves hidden row-order entries when visible rows are reordered", async () => {
    const setRowOrder = vi.fn();
    const settings = {
      rowOrder: ["US:AAPL", "JP:7203", "TW:2330", "KR:005930"],
      setRowOrder,
      settingsError: "",
      topHoldingsLimit: 12,
    } as unknown as HoldingsColumnSettingsState<TestColumn>;
    const rendered = (() => {
      const testContainer = document.createElement("div");
      document.body.appendChild(testContainer);
      const testRoot = createRoot(testContainer);
      act(() => {
        testRoot.render(
          <HoldingsRowSettingsMenu
            dict={dict}
            rows={[
              { id: "US:AAPL", label: "AAPL", description: "US" },
              { id: "TW:2330", label: "2330", description: "TW" },
            ]}
            settings={settings}
            testIdPrefix="test-holdings"
          />,
        );
      });
      return { container: testContainer, root: testRoot };
    })();
    root = rendered.root;
    container = rendered.container;

    const rowSettings = container.querySelector('[data-testid="test-holdings-row-settings"]');
    expect(rowSettings).not.toBeNull();
    pointerDown(rowSettings!);
    await flushPromises();

    const moveAaplDown = document.body.querySelector('[data-testid="test-holdings-row-move-down-US:AAPL"]');
    expect(moveAaplDown).not.toBeNull();
    click(moveAaplDown!);
    await flushPromises();

    expect(setRowOrder).toHaveBeenCalledWith(["TW:2330", "JP:7203", "US:AAPL", "KR:005930"]);
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
              "holdings.shared": {
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

  it("applies hydrated column preferences after an early filter-only edit", async () => {
    let resolvePreferences: (value: unknown) => void = () => undefined;
    vi.mocked(getJson).mockReturnValueOnce(new Promise((resolve) => {
      resolvePreferences = resolve;
    }) as ReturnType<typeof getJson>);

    const rendered = renderColumnSettingsHarness();
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector("[data-testid='visible-columns']")?.textContent).toBe("ticker,marketValue");

    await act(async () => {
      container?.querySelector("[data-testid='set-market-filters']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[data-testid='selected-markets']")?.textContent).toBe("US,TW");

    await act(async () => {
      resolvePreferences({
        preferences: {
          holdingsTableSettings: {
            version: 1,
            contexts: {
              "holdings.shared": {
                columnOrder: ["marketValue", "ticker"],
                hiddenColumns: ["marketValue"],
                columnWidths: {
                  ticker: 132,
                  marketValue: 188,
                },
                layoutStyle: "portfolio",
                selectedMarketCodes: ["JP"],
                selectedAccountIds: ["acc-9"],
              },
            },
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='visible-columns']")?.textContent).toBe("ticker");
    expect(container.querySelector("[data-testid='selected-markets']")?.textContent).toBe("US,TW");
    expect(container.querySelector("[data-testid='selected-accounts']")?.textContent).toBe("acc-9");
    expect(vi.mocked(patchJson)).toHaveBeenLastCalledWith(
      "/user-preferences",
      {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "holdings.shared": {
              selectedMarketCodes: ["US", "TW"],
            },
          },
        },
      },
      { contextScope: "session" },
    );
  });

  it("hydrates persisted market/account filters from holdings shared context", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "holdings.shared": {
              columnOrder: ["ticker", "marketValue"],
              hiddenColumns: [],
              columnWidths: {},
              layoutStyle: "portfolio",
              selectedMarketCodes: ["US", "TW"],
              selectedAccountIds: ["acc-1", "acc-2"],
            },
          },
        },
      },
    });

    const rendered = renderColumnSettingsHarness();
    root = rendered.root;
    container = rendered.container;

    await flushPromises();

    expect(container.querySelector("[data-testid='selected-markets']")?.textContent).toBe("US,TW");
    expect(container.querySelector("[data-testid='selected-accounts']")?.textContent).toBe("acc-1,acc-2");
  });

  it("persists market/account filter changes through the existing context merge path", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "holdings.shared": {
              columnOrder: ["ticker", "marketValue"],
              hiddenColumns: [],
              columnWidths: { ticker: 120, marketValue: 160 },
              layoutStyle: "portfolio",
              mobileSummaryCount: 2,
              rowOrder: [],
              selectedMarketCodes: [],
              selectedAccountIds: [],
              topHoldingsLimit: 5,
            },
            "holdings.other": {
              columnOrder: ["ticker", "marketValue"],
              hiddenColumns: [],
              columnWidths: {},
              layoutStyle: "portfolio",
              selectedMarketCodes: ["JP"],
              selectedAccountIds: ["acc-9"],
            },
          },
        },
      },
    });

    const rendered = renderColumnSettingsHarness();
    root = rendered.root;
    container = rendered.container;

    await flushPromises();

    await act(async () => {
      container?.querySelector("[data-testid='set-row-order']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container?.querySelector("[data-testid='set-top-holdings-limit']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container?.querySelector("[data-testid='set-market-filters']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container?.querySelector("[data-testid='set-account-filters']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector("[data-testid='selected-markets']")?.textContent).toBe("US,TW");
    expect(container.querySelector("[data-testid='selected-accounts']")?.textContent).toBe("acc-1,acc-2");
    expect(vi.mocked(patchJson)).toHaveBeenLastCalledWith(
      "/user-preferences",
      {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "holdings.shared": {
              selectedAccountIds: ["acc-1", "acc-2"],
            },
          },
        },
      },
      { contextScope: "session" },
    );
  });

  it("persists filter-only changes without rewriting unrelated shared column preferences", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "holdings.shared": {
              columnOrder: ["ticker", "accounts", "quantity", "marketValue"],
              hiddenColumns: ["quantity"],
              columnWidths: {
                ticker: 144,
                accounts: 116,
                quantity: 88,
                marketValue: 176,
              },
              layoutStyle: "portfolio",
              mobileSummaryCount: 3,
              rowOrder: ["US:AAPL"],
              selectedMarketCodes: ["JP"],
              selectedAccountIds: ["acc-9"],
              topHoldingsLimit: 9,
            },
          },
        },
      },
    });

    const rendered = renderColumnSettingsHarness();
    root = rendered.root;
    container = rendered.container;

    await flushPromises();

    await act(async () => {
      container?.querySelector("[data-testid='set-market-filters']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(vi.mocked(patchJson)).toHaveBeenLastCalledWith(
      "/user-preferences",
      {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "holdings.shared": {
              selectedMarketCodes: ["US", "TW"],
            },
          },
        },
      },
      { contextScope: "session" },
    );
    const payload = vi.mocked(patchJson).mock.calls.at(-1)?.[1] as { holdingsTableSettings?: unknown };
    expect(holdingsTableSettingsPreferenceSchema.safeParse(payload.holdingsTableSettings).success).toBe(true);
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

  it("preserves full ticker totals when an aggregated status filter matches the group", async () => {
    const mixedGroup: DashboardOverviewHoldingGroupDto = {
      ...baseGroup,
      ticker: "MIXED",
      quantity: 579,
      quoteStatus: "missing",
      accountCount: 2,
      children: [
        {
          ...baseGroup,
          accountId: "acc-current",
          accountName: "Current account",
          ticker: "MIXED",
          quantity: 123,
          quoteStatus: "current",
        },
        {
          ...baseGroup,
          accountId: "acc-missing",
          accountName: "Missing account",
          ticker: "MIXED",
          quantity: 456,
          quoteStatus: "missing",
          currentUnitPrice: null,
          marketValueAmount: null,
          unrealizedPnlAmount: null,
          reportingMarketValueAmount: null,
          reportingUnrealizedPnlAmount: null,
        },
      ],
    };
    const rendered = renderTable([mixedGroup]);
    root = rendered.root;
    container = rendered.container;

    pointerDown(container.querySelector("[data-testid='holdings-filter-status']")!);
    await flushPromises();
    const missingStatusLabel = Array.from(document.body.querySelectorAll("label"))
      .find((label) => label.textContent?.includes(dict.holdings.statusMissing));
    expect(missingStatusLabel).toBeDefined();
    click(missingStatusLabel!.querySelector("[role='checkbox']")!);
    await flushPromises();

    const aggregateRow = container.querySelector("[data-testid='holding-group-row-MIXED-US']");
    expect(aggregateRow).not.toBeNull();
    expect(aggregateRow?.textContent).toContain("579");
    expect(aggregateRow?.textContent).toContain("2");
  });

  it("keeps mobile current price comparisons on the fixed success/destructive palette", async () => {
    vi.mocked(getJson).mockResolvedValue({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "holdings.shared": {
              columnOrder: ["price", "unitPnl", "dailyChange", "ticker", "accounts", "quantity", "avgCost", "marketValue", "pnl", "health", "costBasis", "allocation", "nextDividend", "lastDividend"],
              hiddenColumns: [],
              columnWidths: {},
              layoutStyle: "portfolio",
              mobileSummaryCount: 1,
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
    const label = Array.from(mobileRow?.querySelectorAll("p") ?? [])
      .find((node) => node.textContent === dict.holdings.priceTerm);
    expect(label).toBeDefined();
    const value = label?.nextElementSibling;
    expect(value?.className).toContain("text-success");
    expect(value?.className).not.toContain("finance-gain");
  });

  it("keeps hidden portfolio mobile columns out of card and details content", async () => {
    vi.mocked(getJson).mockResolvedValue({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "holdings.shared": {
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
