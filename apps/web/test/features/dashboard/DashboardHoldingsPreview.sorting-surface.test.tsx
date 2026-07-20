import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardOverviewHoldingGroupDto } from "@vakwen/shared-types";
import { DashboardHoldingsPreview } from "../../../components/dashboard/DashboardHoldingsPreview";
import { getJson, patchJson } from "../../../lib/api";
import { getDictionary } from "../../../lib/i18n";
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
  overrides: Partial<DashboardOverviewHoldingGroupDto> = {},
): DashboardOverviewHoldingGroupDto {
  const costBasis = marketValue === null ? 0 : Math.max(0, marketValue - 100);
  const result: DashboardOverviewHoldingGroupDto = {
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
    priceState: testPriceState({ basis: marketValue === null ? "missing" : "today_close" }),
    accountCount: 1,
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
  if (overrides.children === undefined) {
    result.children = [{
      ...result,
      accountId: `acc-${ticker}`,
      accountName: `${ticker} account`,
      children: undefined,
      accountCount: undefined,
    } as unknown as DashboardOverviewHoldingGroupDto["children"][number]];
  }
  return result;
}

const fixtures = [
  group("TIE-B", "US", 500),
  group("MISS", "JP", null),
  group("TOP", "TW", 900),
  group("TIE-A", "TW", 500),
];

const presetFixtures = [
  group("LARGE", "TW", 900, { reportingUnrealizedPnlAmount: 50 }),
  group("BEST", "US", 500, {
    currency: "USD",
    reportingCostBasisAmount: 100,
    reportingUnrealizedPnlAmount: 400,
  }),
  group("WORST", "US", 400, {
    currency: "USD",
    reportingCostBasisAmount: 700,
    reportingUnrealizedPnlAmount: -300,
  }),
  group("STALE", "JP", 300, {
    quoteStatus: "provisional",
    priceState: testPriceState({ basis: "pending_today_close" }),
    reportingUnrealizedPnlAmount: 25,
  }),
  group("MISSING", "AU", null, {
    priceState: testPriceState({ basis: "missing", chipState: "missing" }),
    reportingUnrealizedPnlAmount: null,
  }),
];

function response(context: Record<string, unknown> = {}) {
  return {
    preferences: {
      holdingsTableSettings: {
        version: 1,
        contexts: { "dashboard.surface-contract": context },
      },
    },
  };
}

function renderDashboard(groups = fixtures) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DashboardHoldingsPreview
        groups={groups}
        locale="en"
        reportingCurrency="TWD"
        settingsContextKey="dashboard.surface-contract"
      />,
    );
  });
  return { container, root };
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

function required(container: ParentNode, selector: string): Element {
  const element = container.querySelector(selector);
  expect(element, selector).not.toBeNull();
  return element!;
}

function keyEnter(element: Element) {
  act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function desktopOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-testid^='dashboard-holding-table-row-']"))
    .map((row) => row.dataset.testid!.replace("dashboard-holding-table-row-", ""));
}

function presetButton(container: HTMLElement, label: string): Element {
  const presets = required(container, "[data-testid='dashboard-holdings-presets']");
  const button = Array.from(presets.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label));
  expect(button, `preset ${label}`).toBeDefined();
  return button!;
}

function expectActiveSort(container: HTMLElement, column: string, direction: "ascending" | "descending") {
  const control = required(container, `[data-testid='dashboard-holdings-column-sort-${column}']`);
  expect(control.closest("th")?.getAttribute("aria-sort")).toBe(direction);
}

describe("DashboardHoldingsPreview sorting surface contract", () => {
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
  });

  it("uses canonical holdings columns and vocabulary, with market code remaining inside Ticker", async () => {
    ({ root, container } = renderDashboard());
    await flush();

    const canonicalIds = [
      "ticker", "quantity", "accounts", "allocation", "averageCost", "price", "unitPnl",
      "marketValue", "costBasis", "dailyChange", "unrealizedPnl", "dataHealth", "actions",
    ];
    for (const id of canonicalIds) {
      expect(container.querySelector(`[data-testid='dashboard-holdings-column-drag-${id}']`), id).not.toBeNull();
    }
    expect(container.querySelector("[data-testid='dashboard-holdings-column-drag-position']")).toBeNull();
    expect(container.textContent).toContain("Unrealized P&L");
    expect(container.textContent).toContain("Daily change");
    expect(container.textContent).not.toContain("Position");
    expect(container.querySelector("[data-testid='dashboard-holding-table-row-TOP-TW']")?.textContent).toContain("TW");
  });

  it("keeps all six desktop presets readable without clipping against the right-side controls", async () => {
    ({ root, container } = renderDashboard(presetFixtures));
    await flush();

    const presets = required(container, "[data-testid='dashboard-holdings-presets']");
    expect(presets.className).toContain("flex-wrap");
    expect(presets.className).toContain("w-full");
    expect(presets.parentElement?.className).toContain("flex-1");
    expect(presets.parentElement?.className).not.toContain("overflow-x-auto");

    const buttons = Array.from(presets.querySelectorAll("button"));
    expect(buttons).toHaveLength(6);
    for (const label of [
      dict.dashboardHome.topHoldingsPresetLargest,
      dict.dashboardHome.topHoldingsPresetHighestAllocation,
      dict.dashboardHome.topHoldingsPresetWorstPnl,
      dict.dashboardHome.topHoldingsPresetBestPnl,
      dict.dashboardHome.topHoldingsPresetFxExposure,
      dict.dashboardHome.topHoldingsPresetStaleQuotes,
    ]) {
      expect(buttons.some((button) => button.textContent === label), label).toBe(true);
    }
    expect(container.querySelector("[data-testid='dashboard-holdings-preset-settings']")).not.toBeNull();
  });

  it("defaults to Market value descending without a hydration PATCH and exposes isolated accessible header controls", async () => {
    ({ root, container } = renderDashboard());
    await flush();

    expect(desktopOrder(container)).toEqual(["TOP-TW", "TIE-A-TW", "TIE-B-US", "MISS-JP"]);
    const sort = container.querySelector("[data-testid='dashboard-holdings-column-sort-marketValue']");
    const drag = container.querySelector("[data-testid='dashboard-holdings-column-drag-marketValue']");
    const resize = container.querySelector("[data-testid='dashboard-holdings-column-resize-marketValue']");
    expect(sort).not.toBeNull();
    expect(sort?.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(drag).not.toBeNull();
    expect(resize?.getAttribute("role")).toBe("separator");
    expect(vi.mocked(patchJson)).not.toHaveBeenCalled();

    click(required(container, "[data-testid='dashboard-holdings-column-drag-marketValue']"));
    click(required(container, "[data-testid='dashboard-holdings-column-resize-marketValue']"));
    expect(vi.mocked(patchJson)).not.toHaveBeenCalled();
    keyEnter(sort!);
    click(sort!);
    await flush();
    expect(sort?.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    expect(desktopOrder(container)).toEqual(["TIE-A-TW", "TIE-B-US", "TOP-TW", "MISS-JP"]);
    expect(vi.mocked(patchJson)).toHaveBeenCalledTimes(1);
  });

  it("renders synchronized mobile sorting and lets Custom be selected directly in one persistence action", async () => {
    vi.mocked(getJson).mockResolvedValue(response({
      rowOrder: ["TW:TOP", "US:TIE-B"],
      sortMode: "field",
      sortField: "ticker",
      sortDirection: "asc",
    }));
    ({ root, container } = renderDashboard());
    await flush();
    vi.mocked(patchJson).mockClear();

    const field = container.querySelector("[data-testid='dashboard-holdings-mobile-sort-field']");
    const direction = container.querySelector<HTMLButtonElement>("[data-testid='dashboard-holdings-mobile-sort-direction']");
    expect(field).not.toBeNull();
    expect(direction?.disabled).toBe(false);
    click(field!);
    const custom = Array.from(document.querySelectorAll("[role='option']"))
      .find((option) => option.textContent?.includes("Custom order"));
    expect(custom?.getAttribute("aria-disabled")).not.toBe("true");
    click(custom!);
    await flush();

    expect(direction?.disabled).toBe(true);
    expect(desktopOrder(container).slice(0, 2)).toEqual(["TOP-TW", "TIE-B-US"]);
    expect(vi.mocked(patchJson)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(patchJson)).toHaveBeenLastCalledWith(
      "/user-preferences",
      expect.objectContaining({
        holdingsTableSettings: expect.objectContaining({
          contexts: expect.objectContaining({
            "dashboard.surface-contract": expect.objectContaining({
              rowOrder: ["TW:TOP", "US:TIE-B"],
              sortMode: "custom",
            }),
          }),
        }),
      }),
      { contextScope: "session" },
    );
  });

  it("keeps a hidden active sort visible through a chip that can reverse and reset it", async () => {
    vi.mocked(getJson).mockResolvedValue(response({
      hiddenColumns: ["unrealizedPnl"],
      sortMode: "field",
      sortField: "unrealizedPnl",
      sortDirection: "desc",
    }));
    ({ root, container } = renderDashboard());
    await flush();

    const chip = required(container, "[data-testid='dashboard-holdings-hidden-sort-chip']");
    expect(chip.textContent).toContain("Unrealized P&L");
    click(required(container, "[data-testid='dashboard-holdings-hidden-sort-direction']"));
    await flush();
    expect(chip.textContent).toMatch(/ascending/i);
    click(required(container, "[data-testid='dashboard-holdings-hidden-sort-reset']"));
    await flush();
    expect(container.querySelector("[data-testid='dashboard-holdings-hidden-sort-chip']")).toBeNull();
  });

  it.each([
    {
      label: dict.dashboardHome.topHoldingsPresetLargest,
      column: "marketValue",
      direction: "descending" as const,
      order: ["LARGE-TW", "BEST-US", "WORST-US", "STALE-JP", "MISSING-AU"],
    },
    {
      label: dict.dashboardHome.topHoldingsPresetHighestAllocation,
      column: "allocation",
      direction: "descending" as const,
      // One missing market value makes the displayed allocation use the existing
      // cost-basis fallback, so sorting must consume that derived metric.
      order: ["LARGE-TW", "WORST-US", "STALE-JP", "BEST-US", "MISSING-AU"],
    },
    {
      label: dict.dashboardHome.topHoldingsPresetBestPnl,
      column: "unrealizedPnl",
      direction: "descending" as const,
      order: ["BEST-US", "LARGE-TW", "STALE-JP", "WORST-US", "MISSING-AU"],
    },
    {
      label: dict.dashboardHome.topHoldingsPresetWorstPnl,
      column: "unrealizedPnl",
      direction: "ascending" as const,
      order: ["WORST-US", "STALE-JP", "LARGE-TW", "BEST-US", "MISSING-AU"],
    },
    {
      label: dict.dashboardHome.topHoldingsPresetStaleQuotes,
      column: "dataHealth",
      direction: "descending" as const,
      order: ["MISSING-AU", "STALE-JP"],
    },
    {
      label: dict.dashboardHome.topHoldingsPresetFxExposure,
      column: "marketValue",
      direction: "descending" as const,
      order: ["BEST-US", "WORST-US"],
    },
  ])("maps the $label preset to its canonical filter and sort", async ({ label, column, direction, order }) => {
    ({ root, container } = renderDashboard(presetFixtures));
    await flush();

    if (label !== dict.dashboardHome.topHoldingsPresetLargest) {
      click(presetButton(container, label));
      await flush();
    }
    expect(desktopOrder(container)).toEqual(order);
    expectActiveSort(container, column, direction);
  });

  it("keeps the Stale Quotes filter during explicit sorting and reapplies Data health descending when reselected", async () => {
    ({ root, container } = renderDashboard(presetFixtures));
    await flush();

    click(presetButton(container, dict.dashboardHome.topHoldingsPresetStaleQuotes));
    await flush();
    click(required(container, "[data-testid='dashboard-holdings-column-sort-marketValue']"));
    await flush();
    expect(desktopOrder(container)).toEqual(["STALE-JP", "MISSING-AU"]);
    expectActiveSort(container, "marketValue", "descending");

    click(presetButton(container, dict.dashboardHome.topHoldingsPresetLargest));
    click(presetButton(container, dict.dashboardHome.topHoldingsPresetStaleQuotes));
    await flush();
    expect(desktopOrder(container)).toEqual(["MISSING-AU", "STALE-JP"]);
    expectActiveSort(container, "dataHealth", "descending");
  });

  it("keeps the FX Exposure filter during explicit sorting and reapplies Market value descending when reselected", async () => {
    ({ root, container } = renderDashboard(presetFixtures));
    await flush();

    click(presetButton(container, dict.dashboardHome.topHoldingsPresetFxExposure));
    await flush();
    click(required(container, "[data-testid='dashboard-holdings-column-sort-unrealizedPnl']"));
    await flush();
    expect(desktopOrder(container)).toEqual(["BEST-US", "WORST-US"]);
    expectActiveSort(container, "unrealizedPnl", "descending");

    click(presetButton(container, dict.dashboardHome.topHoldingsPresetLargest));
    click(presetButton(container, dict.dashboardHome.topHoldingsPresetFxExposure));
    await flush();
    expect(desktopOrder(container)).toEqual(["BEST-US", "WORST-US"]);
    expectActiveSort(container, "marketValue", "descending");
  });

  it("sorts before top-N and keeps optimistic order plus an inline error after persistence failure", async () => {
    vi.mocked(getJson).mockResolvedValue(response({ topHoldingsLimit: 2 }));
    vi.mocked(patchJson).mockRejectedValue(new Error("preferences unavailable"));
    ({ root, container } = renderDashboard());
    await flush();
    vi.mocked(patchJson).mockClear();

    click(required(container, "[data-testid='dashboard-holdings-column-sort-ticker']"));
    await flush();
    expect(desktopOrder(container)).toEqual(["MISS-JP", "TIE-A-TW"]);
    expect(container.textContent).toContain("preferences unavailable");
    expect(vi.mocked(patchJson)).toHaveBeenCalledTimes(1);
  });
});
