import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardOverviewHoldingGroupDto } from "@vakwen/shared-types";
import { HoldingsTable } from "../../../components/portfolio/HoldingsTable";
import * as holdingsSorting from "../../../components/holdings/holdingsSorting";
import { getJson, patchJson } from "../../../lib/api";
import { getDictionary } from "../../../lib/i18n";
import { formatCurrencyAmount } from "../../../lib/utils";
import { testPriceState } from "../../fixtures/priceState";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(async () => ({ preferences: {} })),
  patchJson: vi.fn(async () => ({ preferences: {} })),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const dict = getDictionary("en");

beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => undefined;
  if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false;
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => undefined;
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => undefined;
});

function group(
  ticker: string,
  marketCode: DashboardOverviewHoldingGroupDto["marketCode"],
  marketValue: number | null,
  childNames: Array<[string, string]> = [],
  overrides: Partial<DashboardOverviewHoldingGroupDto> = {},
): DashboardOverviewHoldingGroupDto {
  const costBasis = marketValue === null ? 0 : Math.max(0, marketValue - 100);
  const base: DashboardOverviewHoldingGroupDto = {
    ticker,
    marketCode,
    instrumentName: `${ticker} Holdings`,
    quantity: marketValue === null ? 1 : marketValue / 10,
    costBasisAmount: costBasis,
    currency: "TWD",
    averageCostPerShare: costBasis,
    currentUnitPrice: marketValue,
    marketValueAmount: marketValue,
    unrealizedPnlAmount: marketValue === null ? null : marketValue - costBasis,
    allocationPct: 0,
    change: 1,
    changePercent: 1,
    previousClose: marketValue === null ? null : marketValue - 1,
    quoteStatus: marketValue === null ? "missing" : "current",
    nextDividendDate: null,
    lastDividendPostedDate: null,
    priceState: testPriceState(),
    accountCount: Math.max(1, childNames.length),
    reportingCurrency: "TWD",
    reportingCostBasisAmount: costBasis,
    reportingMarketValueAmount: marketValue,
    reportingUnrealizedPnlAmount: marketValue === null ? null : marketValue - costBasis,
    reportingAllocationPercent: 0,
    fxStatus: marketValue === null ? "missing" : "complete",
    allocationBasisUsed: "market_value",
    allocationBasisFallbackReason: null,
    children: [],
    ...overrides,
  };
  return {
    ...base,
    children: childNames.map(([accountId, accountName], index) => ({
      ...base,
      accountId,
      accountName,
      accountCount: undefined,
      children: undefined,
      quantity: index + 1,
      reportingMarketValueAmount: marketValue === null ? null : marketValue - index * 10,
      reportingAllocationPercent: 0,
    })) as DashboardOverviewHoldingGroupDto["children"],
  };
}

const fixtures = [
  group("TIE-B", "US", 500, [
    ["acc-z", "Zulu"],
    ["acc-a", "Alpha"],
  ]),
  group("MISS", "JP", null, [["acc-m", "Missing"]]),
  group("TOP", "TW", 900, [["acc-top", "Top account"]]),
  group("TIE-A", "TW", 500, [
    ["acc-2", "Same"],
    ["acc-1", "Same"],
  ]),
];

function response(contextKey: string, context: Record<string, unknown> = {}) {
  return {
    preferences: {
      holdingsTableSettings: {
        version: 1,
        contexts: { [contextKey]: context },
      },
    },
  };
}

function renderPortfolio({
  groups = fixtures,
  contextKey = "portfolio.surface-contract",
  locale = "en",
  variant = "default",
}: {
  groups?: DashboardOverviewHoldingGroupDto[];
  contextKey?: string;
  locale?: "en" | "zh-TW";
  variant?: "default" | "compact";
} = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const renderDict = getDictionary(locale);
  act(() => {
    root.render(<HoldingsTable accounts={[]} allocationBasis="market_value" dict={renderDict} holdingGroups={groups} holdings={[]} instruments={[]} locale={locale} settingsContextKey={contextKey} variant={variant} />);
  });
  return { container, root };
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

function pointerDown(element: Element) {
  act(() => {
    const event = new MouseEvent("pointerdown", { bubbles: true, button: 0, cancelable: true });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    element.dispatchEvent(event);
  });
}

function changeInput(element: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function required(container: ParentNode, selector: string): Element {
  const element = container.querySelector(selector);
  expect(element, selector).not.toBeNull();
  return element!;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function selectOption(trigger: Element, text: string) {
  click(trigger);
  await flush();
  const option = Array.from(document.querySelectorAll("[role='option']")).find((candidate) => candidate.textContent?.includes(text));
  expect(option, `option ${text}`).toBeDefined();
  click(option!);
  await flush();
}

function groupOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-testid^='holding-group-row-']")).map((row) => row.dataset.testid!.replace("holding-group-row-", ""));
}

function childOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-testid^='holding-child-row-']")).map((row) => row.dataset.testid!.replace("holding-child-row-", ""));
}

describe("HoldingsTable sorting surface contract", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getJson).mockResolvedValue({ preferences: {} });
    vi.mocked(patchJson).mockResolvedValue({ preferences: {} });
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it("uses canonical column identifiers and vocabulary on both Portfolio styles", async () => {
    ({ root, container } = renderPortfolio({ variant: "compact" }));
    await flush();

    const canonicalIds = ["ticker", "accounts", "quantity", "averageCost", "unitPnl", "price", "dailyChange", "marketValue", "unrealizedPnl", "dataHealth", "costBasis", "allocation", "nextDividendDate", "lastDividendDate"];
    for (const id of canonicalIds) {
      expect(container.querySelector(`[data-testid='holdings-column-drag-${id}']`), id).not.toBeNull();
    }
    expect(container.querySelector("[data-testid='holdings-column-drag-avgCost']")).toBeNull();
    expect(container.querySelector("[data-testid='holdings-column-drag-pnl']")).toBeNull();
    expect(container.textContent).toContain("Unrealized P&L");
    expect(container.textContent).toContain("Daily change");
    expect(container.textContent).toContain("Cost basis");
    expect(container.textContent).not.toContain("Total Cost");
    expect(dict.holdings.pnlTerm).toBe("Unrealized P&L");
    expect(dict.holdings.visibleRowsCurrencyDetail).toBe("{currency} holdings");
  });

  it("keeps detailed Portfolio Custom by default but compact Portfolio Market value descending, without hydration PATCHes", async () => {
    ({ root, container } = renderPortfolio());
    await flush();
    expect(groupOrder(container)).toEqual(["TIE-B-US", "MISS-JP", "TOP-TW", "TIE-A-TW"]);
    expect(container.querySelector("th[aria-sort]")).toBeNull();
    expect(vi.mocked(patchJson)).not.toHaveBeenCalled();

    act(() => root?.unmount());
    container.remove();
    ({ root, container } = renderPortfolio({
      variant: "compact",
      contextKey: "portfolio.compact-contract",
    }));
    await flush();
    expect(groupOrder(container)).toEqual(["TOP-TW", "TIE-A-TW", "TIE-B-US", "MISS-JP"]);
    expect(container.querySelector("[data-testid='holdings-column-sort-marketValue']")?.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(vi.mocked(patchJson)).not.toHaveBeenCalled();
  });

  it("keeps all filtered children and aggregate values when search matches only the market code", async () => {
    ({ root, container } = renderPortfolio());
    await flush();

    changeInput(required(container, "[data-testid='holdings-filter-input']") as HTMLInputElement, "US");
    await flush();
    await flush();

    expect(groupOrder(container)).toEqual(["TIE-B-US"]);
    const aggregate = required(container, "[data-testid='holding-group-row-TIE-B-US']");
    expect(aggregate.querySelectorAll("td")[1]?.textContent).toBe("2");
    await selectOption(required(container, "[data-testid='holdings-display-mode-select']"), dict.holdings.displayModeExpanded);
    expect(childOrder(container)).toEqual(["TIE-B-US-acc-a", "TIE-B-US-acc-z"]);
  });

  it("feeds the visible field-sorted order into row settings", async () => {
    vi.mocked(getJson).mockResolvedValue(
      response("portfolio.row-settings-sorted", {
        sortMode: "field",
        sortField: "ticker",
        sortDirection: "asc",
      }),
    );
    ({ root, container } = renderPortfolio({ contextKey: "portfolio.row-settings-sorted" }));
    await flush();

    expect(groupOrder(container)).toEqual(["MISS-JP", "TIE-A-TW", "TIE-B-US", "TOP-TW"]);
    pointerDown(required(container, "[data-testid='holdings-row-settings']"));
    await flush();
    const settingsOrder = Array.from(document.querySelectorAll<HTMLElement>("[data-testid^='holdings-row-drag-']"))
      .map((row) => row.dataset.testid!.replace("holdings-row-drag-", ""));
    expect(settingsOrder).toEqual(["JP:MISS", "TW:TIE-A", "US:TIE-B", "TW:TOP"]);
  });

  it("localizes Portfolio mobile and hidden-sort field labels in zh-TW", async () => {
    const zhDict = getDictionary("zh-TW");
    vi.mocked(getJson).mockResolvedValue(
      response("portfolio.localized-sort", {
        hiddenColumns: ["allocation"],
        sortMode: "field",
        sortField: "allocation",
        sortDirection: "desc",
      }),
    );
    ({ root, container } = renderPortfolio({ contextKey: "portfolio.localized-sort", locale: "zh-TW" }));
    await flush();

    const hiddenSortChip = required(container, "[data-testid='holdings-hidden-sort-chip']");
    expect(hiddenSortChip.textContent).toContain(zhDict.holdings.allocationTerm);
    expect(hiddenSortChip.parentElement?.className).toContain("lg:flex");
    expect(hiddenSortChip.parentElement?.className).not.toContain("sm:flex");
    click(required(container, "[data-testid='holdings-mobile-sort-field']"));
    await flush();
    const allocationOption = Array.from(document.querySelectorAll("[role='option']"))
      .find((option) => option.textContent === zhDict.holdings.allocationTerm);
    expect(allocationOption).toBeDefined();
  });

  it("sorts aggregates, each expanded group's children, and Accounts mode with the documented hierarchy semantics", async () => {
    ({ root, container } = renderPortfolio());
    await flush();

    click(required(container, "[data-testid='holdings-column-sort-ticker']"));
    await flush();
    expect(groupOrder(container)).toEqual(["MISS-JP", "TIE-A-TW", "TIE-B-US", "TOP-TW"]);

    await selectOption(container.querySelector("[data-testid='holdings-display-mode-select']")!, dict.holdings.displayModeExpanded);
    expect(groupOrder(container)).toEqual(["MISS-JP", "TIE-A-TW", "TIE-B-US", "TOP-TW"]);
    expect(childOrder(container).filter((id) => id.startsWith("TIE-A-TW-"))).toEqual(["TIE-A-TW-acc-1", "TIE-A-TW-acc-2"]);

    await selectOption(container.querySelector("[data-testid='holdings-display-mode-select']")!, dict.holdings.displayModeAccounts);
    expect(groupOrder(container)).toEqual([]);
    expect(childOrder(container)).toEqual(["MISS-JP-acc-m", "TIE-A-TW-acc-1", "TIE-A-TW-acc-2", "TIE-B-US-acc-a", "TIE-B-US-acc-z", "TOP-TW-acc-top"]);
  });

  it("rederives aggregate values and Allocation order from account-filtered children", async () => {
    const mixed = group("MIXED", "US", 1_000, [
      ["acc-a", "Account A"],
      ["acc-b", "Account B"],
    ]);
    mixed.children = mixed.children.map((child) =>
      child.accountId === "acc-a"
        ? {
            ...child,
            quantity: 2,
            costBasisAmount: 160,
            marketValueAmount: 200,
            unrealizedPnlAmount: 40,
            reportingCostBasisAmount: 160,
            reportingMarketValueAmount: 200,
            reportingUnrealizedPnlAmount: 40,
          }
        : {
            ...child,
            quantity: 8,
            costBasisAmount: 640,
            marketValueAmount: 800,
            unrealizedPnlAmount: 160,
            reportingCostBasisAmount: 640,
            reportingMarketValueAmount: 800,
            reportingUnrealizedPnlAmount: 160,
          },
    );
    const focused = group("FOCUS", "TW", 600, [["acc-a", "Account A"]]);
    focused.children = focused.children.map((child) => ({
      ...child,
      quantity: 6,
      costBasisAmount: 500,
      marketValueAmount: 600,
      unrealizedPnlAmount: 100,
      reportingCostBasisAmount: 500,
      reportingMarketValueAmount: 600,
      reportingUnrealizedPnlAmount: 100,
    }));
    vi.mocked(getJson).mockResolvedValue(
      response("portfolio.filtered-projection", {
        selectedAccountIds: ["acc-a"],
        sortMode: "field",
        sortField: "allocation",
        sortDirection: "desc",
      }),
    );

    ({ root, container } = renderPortfolio({
      groups: [mixed, focused],
      contextKey: "portfolio.filtered-projection",
    }));
    await flush();

    expect(groupOrder(container)).toEqual(["FOCUS-TW", "MIXED-US"]);
    const aggregate = required(container, "[data-testid='holding-group-row-MIXED-US']");
    const aggregateCells = aggregate.querySelectorAll("td");
    expect(aggregateCells[1]?.textContent).toBe("1");
    expect(aggregateCells[2]?.textContent).toBe("2");
    expect(aggregate.textContent).toContain("25%");

    await selectOption(required(container, "[data-testid='holdings-display-mode-select']"), dict.holdings.displayModeExpanded);
    expect(groupOrder(container)).toEqual(["FOCUS-TW", "MIXED-US"]);
    expect(childOrder(container)).toEqual(["FOCUS-TW-acc-a", "MIXED-US-acc-a"]);
    expect(required(container, "[data-testid='holding-group-row-MIXED-US']").textContent).toContain("25%");
  });

  it("preserves available aggregate values when a projected group also contains a missing lot", async () => {
    const partial = group("PARTIAL", "US", 1_000, [
      ["acc-valid", "Valid account"],
      ["acc-missing", "Missing account"],
      ["acc-excluded", "Excluded account"],
    ]);
    partial.children = partial.children.map((child) => {
      if (child.accountId === "acc-valid") {
        return {
          ...child,
          quantity: 2,
          marketValueAmount: 200,
          unrealizedPnlAmount: 40,
          reportingMarketValueAmount: 200,
          reportingUnrealizedPnlAmount: 40,
        };
      }
      if (child.accountId === "acc-missing") {
        return {
          ...child,
          quantity: 3,
          currentUnitPrice: null,
          marketValueAmount: null,
          unrealizedPnlAmount: null,
          reportingCurrentUnitPrice: null,
          reportingMarketValueAmount: null,
          reportingUnrealizedPnlAmount: null,
        };
      }
      return {
        ...child,
        quantity: 8,
        marketValueAmount: 800,
        unrealizedPnlAmount: 160,
        reportingMarketValueAmount: 800,
        reportingUnrealizedPnlAmount: 160,
      };
    });
    const focused = group("FOCUS", "TW", 600, [["acc-valid", "Valid account"]]);
    vi.mocked(getJson).mockResolvedValue(
      response("portfolio.partial-projection", {
        selectedAccountIds: ["acc-valid", "acc-missing"],
        sortMode: "field",
        sortField: "allocation",
        sortDirection: "desc",
      }),
    );

    ({ root, container } = renderPortfolio({
      groups: [partial, focused],
      contextKey: "portfolio.partial-projection",
    }));
    await flush();

    expect(groupOrder(container)).toEqual(["FOCUS-TW", "PARTIAL-US"]);
    const aggregate = required(container, "[data-testid='holding-group-row-PARTIAL-US']");
    expect(aggregate.querySelectorAll("td")[1]?.textContent).toBe("2");
    expect(aggregate.querySelectorAll("td")[2]?.textContent).toBe("5");
    expect(aggregate.textContent).toContain("200");
    expect(aggregate.textContent).toContain("40");
    expect(aggregate.textContent).toContain("25%");
  });

  it("sorts Price by finite reporting-currency unit price across currencies", async () => {
    const usd = group("USD-HIGH", "US", 1_000, [], {
      currency: "USD",
      currentUnitPrice: 100,
      reportingCurrentUnitPrice: 10,
    });
    const twd = group("TWD-LOW", "TW", 1_000, [], {
      currency: "TWD",
      currentUnitPrice: 20,
      reportingCurrentUnitPrice: 20,
    });
    vi.mocked(getJson).mockResolvedValue(
      response("portfolio.reporting-price", {
        sortMode: "field",
        sortField: "price",
        sortDirection: "asc",
      }),
    );

    ({ root, container } = renderPortfolio({
      groups: [usd, twd],
      contextKey: "portfolio.reporting-price",
    }));
    await flush();

    expect(groupOrder(container)).toEqual(["USD-HIGH-US", "TWD-LOW-TW"]);
    const usdRow = required(container, "[data-testid='holding-group-row-USD-HIGH-US']");
    expect(usdRow.textContent).toContain(formatCurrencyAmount(10, "TWD", "en"));
    expect(usdRow.textContent).toContain(formatCurrencyAmount(100, "USD", "en"));
    const twdRow = required(container, "[data-testid='holding-group-row-TWD-LOW-TW']");
    expect(twdRow.textContent).toContain(formatCurrencyAmount(20, "TWD", "en"));
  });

  it("keeps detailed desktop headers readable after narrow persisted resizes", async () => {
    const readableMinimums = {
      ticker: 224,
      accounts: 160,
      quantity: 160,
      price: 144,
      dailyChange: 192,
      marketValue: 192,
      unrealizedPnl: 224,
      dataHealth: 192,
      costBasis: 176,
      allocation: 168,
      nextDividendDate: 200,
      lastDividendDate: 192,
    } as const;
    const narrowWidths = Object.fromEntries(
      ["ticker", "accounts", "quantity", "averageCost", "unitPnl", "price", "dailyChange", "marketValue", "unrealizedPnl", "dataHealth", "costBasis", "allocation", "nextDividendDate", "lastDividendDate"].map((column) => [column, 72]),
    );
    vi.mocked(getJson).mockResolvedValue(
      response("portfolio.readable-headers", {
        columnWidths: narrowWidths,
      }),
    );

    ({ root, container } = renderPortfolio({
      contextKey: "portfolio.readable-headers",
    }));
    await flush();

    const table = required(container, "[data-testid='holdings-table']") as HTMLElement;
    const scrollFrame = required(container, "[data-testid='portfolio-holdings-desktop-scroll']");
    expect(scrollFrame.className).toContain("overflow-x-auto");
    expect(scrollFrame.className).toContain("overflow-y-auto");
    expect(scrollFrame.className).toContain("overscroll-x-contain");
    expect(table.className).toContain("min-w-max");
    const sortControls = Array.from(table.querySelectorAll<HTMLElement>("[data-testid^='holdings-column-sort-']"));
    expect(sortControls).toHaveLength(Object.keys(readableMinimums).length);
    for (const control of sortControls) {
      const header = control.closest("th");
      expect(header?.className).toContain("whitespace-nowrap");
      const column = control.dataset.testid?.replace("holdings-column-sort-", "");
      expect(Number.parseFloat(header?.style.minWidth ?? "0")).toBeGreaterThanOrEqual(readableMinimums[column as keyof typeof readableMinimums]);
      expect(table.querySelector(`[data-testid='holdings-column-drag-${column}']`)).not.toBeNull();
      expect(table.querySelector(`[data-testid='holdings-column-resize-${column}']`)).not.toBeNull();
    }
    expect(Number.parseFloat(table.style.minWidth)).toBeGreaterThanOrEqual(Object.values(readableMinimums).reduce((total, width) => total + width, 0));
  });

  it("applies Custom holding order in Accounts mode and deterministic account name then ID order", async () => {
    vi.mocked(getJson).mockResolvedValue(
      response("portfolio.surface-contract", {
        rowOrder: ["TW:TIE-A", "US:TIE-B", "TW:TOP"],
        sortMode: "custom",
      }),
    );
    ({ root, container } = renderPortfolio());
    await flush();
    await selectOption(container.querySelector("[data-testid='holdings-display-mode-select']")!, dict.holdings.displayModeAccounts);

    expect(childOrder(container)).toEqual(["TIE-A-TW-acc-1", "TIE-A-TW-acc-2", "TIE-B-US-acc-a", "TIE-B-US-acc-z", "TOP-TW-acc-top", "MISS-JP-acc-m"]);
  });

  it("offers mobile Custom activation, preserves rowOrder, and restores a text field's ascending default", async () => {
    vi.mocked(getJson).mockResolvedValue(
      response("portfolio.surface-contract", {
        rowOrder: ["TW:TOP", "US:TIE-B"],
        sortMode: "field",
        sortField: "marketValue",
        sortDirection: "desc",
      }),
    );
    ({ root, container } = renderPortfolio());
    await flush();
    vi.mocked(patchJson).mockClear();

    const field = required(container, "[data-testid='holdings-mobile-sort-field']");
    const direction = required(container, "[data-testid='holdings-mobile-sort-direction']") as HTMLButtonElement;
    const mobileSortWrapper = field.closest("label")?.parentElement?.parentElement;
    expect(mobileSortWrapper?.className).toContain("lg:hidden");
    expect(mobileSortWrapper?.className).not.toContain("sm:hidden");
    await selectOption(field, "Custom order");
    expect(direction.disabled).toBe(true);
    expect(groupOrder(container).slice(0, 2)).toEqual(["TOP-TW", "TIE-B-US"]);
    expect(vi.mocked(patchJson)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(patchJson)).toHaveBeenLastCalledWith(
      "/user-preferences",
      expect.objectContaining({
        holdingsTableSettings: expect.objectContaining({
          contexts: expect.objectContaining({
            "portfolio.surface-contract": expect.objectContaining({
              rowOrder: ["TW:TOP", "US:TIE-B"],
              sortMode: "custom",
            }),
          }),
        }),
      }),
      { contextScope: "session" },
    );

    vi.mocked(patchJson).mockClear();
    await selectOption(field, "Ticker");
    expect(direction.disabled).toBe(false);
    expect(groupOrder(container)).toEqual(["MISS-JP", "TIE-A-TW", "TIE-B-US", "TOP-TW"]);
    expect(vi.mocked(patchJson)).toHaveBeenCalledTimes(1);
  });

  it("isolates context persistence and keeps optimistic order plus an inline error after a failed PATCH", async () => {
    vi.mocked(patchJson).mockRejectedValue(new Error("preferences unavailable"));
    ({ root, container } = renderPortfolio({
      contextKey: "portfolio.only-this-context",
    }));
    await flush();
    vi.mocked(patchJson).mockClear();

    click(required(container, "[data-testid='holdings-column-sort-marketValue']"));
    await flush();
    expect(groupOrder(container)).toEqual(["TOP-TW", "TIE-A-TW", "TIE-B-US", "MISS-JP"]);
    expect(container.textContent).toContain("preferences unavailable");
    expect(vi.mocked(patchJson)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(patchJson).mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        holdingsTableSettings: expect.objectContaining({
          contexts: { "portfolio.only-this-context": expect.any(Object) },
        }),
      }),
    );
  });

  it("derives and sorts one aggregate projection for both responsive render paths without mutating input", async () => {
    const source = structuredClone(fixtures);
    const snapshot = structuredClone(source);
    const sortSpy = vi.spyOn(holdingsSorting, "sortHoldingsRows");
    vi.mocked(getJson).mockResolvedValue(
      response("portfolio.compact-contract", {
        sortMode: "field",
        sortField: "marketValue",
        sortDirection: "desc",
      }),
    );
    ({ root, container } = renderPortfolio({
      groups: source,
      variant: "compact",
      contextKey: "portfolio.compact-contract",
    }));
    await flush();

    expect(sortSpy).toHaveBeenCalledTimes(1);
    expect(source).toEqual(snapshot);
    expect(groupOrder(container)).toEqual(["TOP-TW", "TIE-A-TW", "TIE-B-US", "MISS-JP"]);
    expect(Array.from(container.querySelectorAll("[data-testid^='holding-group-mobile-row-']"))).toHaveLength(4);
  });
});
