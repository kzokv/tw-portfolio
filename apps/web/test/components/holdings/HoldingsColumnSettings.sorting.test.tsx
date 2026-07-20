import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdingsTableSettingsPreferenceSchema } from "@vakwen/shared-types";
import * as HoldingsSettings from "../../../components/holdings/HoldingsColumnSettings";
import { getJson, patchJson } from "../../../lib/api";
import { getDictionary } from "../../../lib/i18n";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(async () => ({ preferences: {} })),
  patchJson: vi.fn(async () => ({ preferences: {} })),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false;
if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => undefined;
if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => undefined;
if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => undefined;

const dict = getDictionary("en");
const columns: Array<HoldingsSettings.HoldingsGridColumnDefinition<"ticker" | "marketValue">> = [
  { id: "ticker", label: "Ticker", defaultWidth: 120, canHide: false, sortField: "ticker" },
  { id: "marketValue", label: "Market value", defaultWidth: 160, align: "right" as const, sortField: "marketValue" },
];
const legacyAliasColumns: Array<HoldingsSettings.HoldingsGridColumnDefinition<"ticker" | "pnl" | "health">> = [
  { id: "ticker", label: "Ticker", defaultWidth: 120 },
  { id: "pnl", label: "Unrealized P/L", defaultWidth: 160 },
  { id: "health", label: "Data health", defaultWidth: 140 },
];

type ProposedSortSettings = HoldingsSettings.HoldingsColumnSettingsState<"ticker" | "marketValue"> & {
  resetSort(): void;
  setCustomSort(): void;
  setSort(field: "ticker" | "marketValue", direction?: "asc" | "desc"): void;
  sortDirection?: "asc" | "desc";
  sortField?: "ticker" | "marketValue";
  sortMode: "custom" | "field";
};

type DefaultSort =
  | { sortDirection: "asc" | "desc"; sortField: "ticker" | "marketValue"; sortMode: "field" }
  | { sortMode: "custom" };

let latestSettings: ProposedSortSettings | null = null;
let latestAdminSettings: HoldingsSettings.HoldingsColumnSettingsState<"ticker" | "marketValue"> | null = null;
let latestLegacyAliasSettings: HoldingsSettings.HoldingsColumnSettingsState<"ticker" | "pnl" | "health"> | null = null;

function HookHarness({
  defaultSort = { sortDirection: "desc", sortField: "marketValue", sortMode: "field" },
  supportedSortFields = ["ticker", "marketValue"],
}: {
  defaultSort?: DefaultSort;
  supportedSortFields?: Array<"ticker" | "marketValue">;
}) {
  latestSettings = HoldingsSettings.useHoldingsColumnSettings({
    columns,
    contextKey: "dashboard.topHoldings",
    defaultSort,
    supportedSortFields,
  } as unknown as Parameters<typeof HoldingsSettings.useHoldingsColumnSettings<"ticker" | "marketValue">>[0]) as unknown as ProposedSortSettings;
  return <div data-testid="sort-state">{latestSettings.sortMode}:{latestSettings.sortField}:{latestSettings.sortDirection}</div>;
}

function AdminHookHarness() {
  latestAdminSettings = HoldingsSettings.useHoldingsColumnSettings<"ticker" | "marketValue">({
    columns,
    contextKey: "admin.test",
    preferenceNamespace: "adminMarketDataTableSettings",
  });
  return <button type="button" onClick={() => latestAdminSettings?.toggleColumn("marketValue")}>Toggle admin column</button>;
}

function LegacyAliasHookHarness() {
  latestLegacyAliasSettings = HoldingsSettings.useHoldingsColumnSettings({
    columns: legacyAliasColumns,
    contextKey: "dashboard.topHoldings",
  });
  return null;
}

describe("shared holdings sort state and controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    latestSettings = null;
    latestAdminSettings = null;
    latestLegacyAliasSettings = null;
    vi.clearAllMocks();
    vi.mocked(getJson).mockResolvedValue({ preferences: {} });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("hydrates a stored sort without persisting and persists exactly once for a committed sort", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "dashboard.topHoldings": { sortDirection: "asc", sortField: "ticker", sortMode: "field" },
          },
        },
      },
    });
    act(() => root.render(<HookHarness />));
    await flush();
    expect(latestSettings?.sortField).toBe("ticker");
    expect(patchJson).not.toHaveBeenCalled();
    expect(latestSettings?.setSort).toBeTypeOf("function");

    act(() => latestSettings?.setSort("marketValue", "desc"));
    await flush();
    expect(patchJson).toHaveBeenCalledTimes(1);
  });

  it("keeps the optimistic local sort and exposes settings error when persistence fails", async () => {
    vi.mocked(patchJson).mockRejectedValueOnce(new Error("offline"));
    act(() => root.render(<HookHarness />));
    await flush();
    expect(latestSettings?.setSort).toBeTypeOf("function");
    act(() => latestSettings?.setSort("ticker", "asc"));
    await flush();
    expect(latestSettings).toMatchObject({ sortDirection: "asc", sortField: "ticker", sortMode: "field" });
    expect(latestSettings?.settingsError).not.toBe("");
  });

  it("enters Custom optimistically once while preserving local state and sending a strict-schema-safe dirty context", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "dashboard.topHoldings": {
              columnOrder: ["ticker", "marketValue"],
              futureSurfaceState: { density: "comfortable" },
              rowOrder: ["TW:2330", "US:AAPL"],
              selectedMarketCodes: ["TW"],
              sortDirection: "desc",
              sortField: "marketValue",
              sortMode: "field",
            },
          },
        },
      },
    });
    act(() => root.render(<HookHarness />));
    await flush();
    expect(latestSettings?.setCustomSort).toBeTypeOf("function");

    act(() => latestSettings?.setCustomSort());
    expect(latestSettings).toMatchObject({ rowOrder: ["TW:2330", "US:AAPL"], sortMode: "custom" });
    expect(latestSettings?.sortField).toBeUndefined();
    expect(latestSettings?.sortDirection).toBeUndefined();
    await flush();

    expect(patchJson).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(patchJson).mock.calls[0]?.[1] as {
      holdingsTableSettings?: { contexts?: Record<string, Record<string, unknown>> };
    };
    expect(payload.holdingsTableSettings?.contexts?.["dashboard.topHoldings"]).toEqual(expect.objectContaining({
      rowOrder: ["TW:2330", "US:AAPL"],
      selectedMarketCodes: ["TW"],
      sortMode: "custom",
    }));
    expect(payload.holdingsTableSettings?.contexts?.["dashboard.topHoldings"]).not.toHaveProperty("futureSurfaceState");
    expect(payload.holdingsTableSettings?.contexts?.["dashboard.topHoldings"]).not.toHaveProperty("sortField");
    expect(payload.holdingsTableSettings?.contexts?.["dashboard.topHoldings"]).not.toHaveProperty("sortDirection");
    expect(holdingsTableSettingsPreferenceSchema.safeParse(payload.holdingsTableSettings).success).toBe(true);
  });

  it("omits an unsupported future sort from an ordinary edit instead of forwarding or deleting it", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "dashboard.topHoldings": {
              columnOrder: ["ticker", "marketValue"],
              futureSurfaceState: { density: "comfortable" },
              sortDirection: "desc",
              sortField: "futureMetric",
              sortMode: "field",
            },
          },
        },
      },
    });
    act(() => root.render(<HookHarness />));
    await flush();

    act(() => latestSettings?.toggleColumn("marketValue"));
    await flush();

    const payload = vi.mocked(patchJson).mock.calls[0]?.[1] as {
      holdingsTableSettings?: { contexts?: Record<string, Record<string, unknown>> };
    };
    const dirtyContext = payload.holdingsTableSettings?.contexts?.["dashboard.topHoldings"];
    expect(dirtyContext).not.toHaveProperty("futureSurfaceState");
    expect(dirtyContext).not.toHaveProperty("sortMode");
    expect(dirtyContext).not.toHaveProperty("sortField");
    expect(dirtyContext).not.toHaveProperty("sortDirection");
    expect(holdingsTableSettingsPreferenceSchema.safeParse(payload.holdingsTableSettings).success).toBe(true);
  });

  it("keeps the optimistic Custom transition and inline error when its single PATCH fails", async () => {
    vi.mocked(patchJson).mockRejectedValueOnce(new Error("custom offline"));
    act(() => root.render(<HookHarness />));
    await flush();

    act(() => latestSettings?.setCustomSort());
    await flush();
    expect(latestSettings).toMatchObject({ sortMode: "custom", settingsError: "custom offline" });
    expect(latestSettings?.sortField).toBeUndefined();
    expect(latestSettings?.sortDirection).toBeUndefined();
    expect(patchJson).toHaveBeenCalledTimes(1);
  });

  it("keeps Reset Columns and Reset Rows isolated while Reset Sort restores the surface default", async () => {
    act(() => root.render(<HookHarness />));
    await flush();
    expect(latestSettings?.setSort).toBeTypeOf("function");
    act(() => latestSettings?.setSort("ticker", "asc"));
    act(() => latestSettings?.resetColumns());
    expect(latestSettings?.sortField).toBe("ticker");
    act(() => latestSettings?.resetRowOrder());
    expect(latestSettings?.sortField).toBe("ticker");
    expect(latestSettings?.resetSort).toBeTypeOf("function");
    act(() => latestSettings?.resetSort());
    expect(latestSettings).toMatchObject({ sortDirection: "desc", sortField: "marketValue", sortMode: "field" });
  });

  it("resets field and Custom defaults with one PATCH while preserving non-sort settings", async () => {
    act(() => root.render(<HookHarness />));
    await flush();
    act(() => latestSettings?.setSort("ticker", "asc"));
    await flush();
    vi.mocked(patchJson).mockClear();

    act(() => latestSettings?.resetSort());
    await flush();
    expect(patchJson).toHaveBeenCalledTimes(1);
    const fieldPayload = vi.mocked(patchJson).mock.calls[0]?.[1] as {
      holdingsTableSettings?: { contexts?: Record<string, Record<string, unknown>> };
    };
    expect(fieldPayload.holdingsTableSettings?.contexts?.["dashboard.topHoldings"]).toMatchObject({
      columnOrder: ["ticker", "marketValue"],
      hiddenColumns: [],
      rowOrder: [],
      sortDirection: "desc",
      sortField: "marketValue",
      sortMode: "field",
    });

    act(() => root.render(<HookHarness defaultSort={{ sortMode: "custom" }} />));
    await flush();
    act(() => latestSettings?.setSort("ticker", "asc"));
    await flush();
    vi.mocked(patchJson).mockClear();
    act(() => latestSettings?.resetSort());
    await flush();
    expect(patchJson).toHaveBeenCalledTimes(1);
    const customPayload = vi.mocked(patchJson).mock.calls[0]?.[1] as {
      holdingsTableSettings?: { contexts?: Record<string, Record<string, unknown>> };
    };
    expect(customPayload.holdingsTableSettings?.contexts?.["dashboard.topHoldings"]).toMatchObject({ sortMode: "custom" });
    expect(customPayload.holdingsTableSettings?.contexts?.["dashboard.topHoldings"]).not.toHaveProperty("sortField");
    expect(customPayload.holdingsTableSettings?.contexts?.["dashboard.topHoldings"]).not.toHaveProperty("sortDirection");
  });

  it("toggles the same field in two states and applies the type-aware default for a new field", async () => {
    act(() => root.render(<HookHarness />));
    await flush();
    expect(latestSettings).toMatchObject({ sortDirection: "desc", sortField: "marketValue", sortMode: "field" });
    expect(latestSettings?.setSort).toBeTypeOf("function");
    act(() => latestSettings?.setSort("marketValue"));
    expect(latestSettings?.sortDirection).toBe("asc");
    act(() => latestSettings?.setSort("marketValue"));
    expect(latestSettings?.sortDirection).toBe("desc");
    act(() => latestSettings?.setSort("ticker"));
    expect(latestSettings).toMatchObject({ sortDirection: "asc", sortField: "ticker", sortMode: "field" });
  });

  it("supports Portfolio detailed Custom as its explicit surface default", async () => {
    act(() => root.render(<HookHarness defaultSort={{ sortMode: "custom" }} />));
    await flush();
    expect(latestSettings).toMatchObject({ sortMode: "custom" });
    expect(latestSettings?.sortField).toBeUndefined();
    expect(latestSettings?.sortDirection).toBeUndefined();
    expect(latestSettings?.setSort).toBeTypeOf("function");
    act(() => latestSettings?.setSort("ticker"));
    expect(latestSettings).toMatchObject({ sortDirection: "asc", sortField: "ticker", sortMode: "field" });
    act(() => latestSettings?.resetSort());
    expect(latestSettings).toMatchObject({ sortMode: "custom" });
  });

  it("falls back from a valid but surface-unsupported stored field without erasing persistence", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "dashboard.topHoldings": { sortDirection: "desc", sortField: "accountCount", sortMode: "field" },
          },
        },
      },
    });
    act(() => root.render(<HookHarness supportedSortFields={["ticker", "marketValue"]} />));
    await flush();
    expect(latestSettings).toMatchObject({ sortDirection: "desc", sortField: "marketValue", sortMode: "field" });
    expect(patchJson).not.toHaveBeenCalled();
  });

  it("hydrates canonical stored IDs and keeps canonical IDs across a legacy-surface write", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            "dashboard.topHoldings": {
              columnOrder: ["ticker", "unrealizedPnl", "dataHealth"],
              columnWidths: { accounts: 112, allocation: 113, dataHealth: 172, quantity: 111, unrealizedPnl: 188 },
              hiddenColumns: ["unrealizedPnl", "dataHealth"],
            },
          },
        },
      },
    });
    act(() => root.render(<LegacyAliasHookHarness />));
    await flush();

    expect(latestLegacyAliasSettings?.orderedColumns.map((column) => column.id)).toEqual(["ticker", "pnl", "health"]);
    expect(latestLegacyAliasSettings?.visibleColumns).toEqual(["ticker"]);
    expect(latestLegacyAliasSettings?.getColumnWidth("pnl")).toBe(188);
    expect(latestLegacyAliasSettings?.getColumnWidth("health")).toBe(172);
    expect(patchJson).not.toHaveBeenCalled();

    act(() => latestLegacyAliasSettings?.toggleColumn("pnl"));
    await flush();
    const payload = vi.mocked(patchJson).mock.calls[0]?.[1] as {
      holdingsTableSettings?: { contexts?: Record<string, Record<string, unknown>> };
    };
    expect(payload.holdingsTableSettings?.contexts?.["dashboard.topHoldings"]).toMatchObject({
      columnOrder: ["ticker", "unrealizedPnl", "dataHealth"],
      columnWidths: {
        accounts: 112,
        allocation: 113,
        dataHealth: 172,
        quantity: 111,
        ticker: 120,
        unrealizedPnl: 188,
      },
      hiddenColumns: ["dataHealth"],
    });
    expect(JSON.stringify(payload)).not.toMatch(/"(?:pnl|health)"/);
  });

  it("renders a dedicated keyboard-operable sort button with an accessible hover/focus tooltip and isolated drag/resize targets", async () => {
    const settings = {
      headerProps: () => ({ draggable: true }),
      resizeProps: () => ({}),
      setSort: vi.fn(),
      sortDirection: "desc",
      sortField: "marketValue",
      sortMode: "field",
    } as unknown as ProposedSortSettings;
    act(() => root.render(
      <HoldingsSettings.HoldingsColumnHeaderContent
        column="marketValue"
        dict={dict}
        label="Market value"
        settings={settings}
      />,
    ));
    const drag = container.querySelector('[data-testid="holdings-column-drag-marketValue"]');
    const sort = container.querySelector<HTMLButtonElement>('[data-testid="holdings-column-sort-marketValue"]');
    const resize = container.querySelector('[data-testid="holdings-column-resize-marketValue"]');
    expect(sort).not.toBeNull();
    expect(sort?.getAttribute("aria-label")).toMatch(/Market value.*descending/i);
    expect(sort?.querySelector("svg")).not.toBeNull();
    expect(drag).not.toBe(sort);
    expect(resize).not.toBe(sort);
    expect(drag?.contains(sort)).toBe(false);

    await act(async () => {
      sort!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      sort!.focus();
      await Promise.resolve();
    });
    await flush();
    const tooltipContent = document.querySelector('[data-testid="holdings-column-sort-tooltip-marketValue"]');
    expect(tooltipContent?.textContent).toMatch(/Market value.*descending/i);
    const renderedTooltip = document.querySelector('[role="tooltip"]');
    expect(renderedTooltip).not.toBeNull();
    expect(renderedTooltip?.textContent).toMatch(/Market value.*descending/i);

    type HeaderCellProps = (settings: ProposedSortSettings, column: "ticker" | "marketValue") => { "aria-sort"?: string };
    const headerCellProps = (HoldingsSettings as unknown as { holdingsSortableHeaderCellProps?: HeaderCellProps })
      .holdingsSortableHeaderCellProps;
    expect(headerCellProps).toBeTypeOf("function");
    expect(headerCellProps!(settings, "marketValue")).toEqual({ "aria-sort": "descending" });
    expect(headerCellProps!(settings, "ticker")).toEqual({});
  });

  it("announces an action for an inactive ticker header instead of claiming it is sorted", () => {
    const setSort = vi.fn();
    const settings = {
      headerProps: () => ({ draggable: true }),
      resizeProps: () => ({}),
      setSort,
      sortDirection: "desc",
      sortField: "marketValue",
      sortMode: "field",
    } as unknown as ProposedSortSettings;
    act(() => root.render(
      <HoldingsSettings.HoldingsColumnHeaderContent
        column="ticker"
        dict={dict}
        label="Ticker"
        settings={settings}
      />,
    ));
    const sort = container.querySelector<HTMLButtonElement>('[data-testid="holdings-column-sort-ticker"]');
    expect(sort?.getAttribute("aria-label")).toMatch(/Sort Ticker ascending/i);
    expect(sort?.getAttribute("aria-label")).not.toMatch(/sorted/i);
    act(() => sort?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(setSort).toHaveBeenCalledWith("ticker");
  });

  it("synchronizes mobile field selection and direction changes with shared settings", async () => {
    const MobileSortControls = (HoldingsSettings as unknown as { HoldingsMobileSortControls?: React.ComponentType<Record<string, unknown>> })
      .HoldingsMobileSortControls;
    expect(MobileSortControls).toBeTypeOf("function");
    if (!MobileSortControls) throw new Error("HoldingsMobileSortControls is not implemented");
    const setSort = vi.fn();
    const settings = {
      setSort,
      sortDirection: "desc",
      sortField: "marketValue",
      sortMode: "field",
    } as unknown as ProposedSortSettings;
    act(() => root.render(<MobileSortControls columns={columns} dict={dict} settings={settings} testIdPrefix="test" />));
    const fieldTrigger = container.querySelector('[data-testid="test-mobile-sort-field"]');
    const directionToggle = container.querySelector('[data-testid="test-mobile-sort-direction"]');
    expect(fieldTrigger?.textContent).toContain("Market value");
    expect(directionToggle?.getAttribute("aria-label")).toMatch(/ascending/i);
    act(() => directionToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(setSort).toHaveBeenCalledWith("marketValue", "asc");

    pointerDown(fieldTrigger!);
    await flush();
    const tickerOption = Array.from(document.body.querySelectorAll('[role="option"]'))
      .find((option) => option.textContent?.includes("Ticker"));
    expect(tickerOption).not.toBeUndefined();
    act(() => tickerOption?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(setSort).toHaveBeenCalledWith("ticker", "asc");
  });

  it("exposes Reset sort independently in both settings and mobile controls", async () => {
    act(() => root.render(<HookHarness />));
    await flush();
    if (!latestSettings) throw new Error("settings did not hydrate");
    const resetSort = vi.spyOn(latestSettings, "resetSort");

    act(() => root.render(
      <>
        <HoldingsSettings.HoldingsColumnSettingsMenu
          dict={dict}
          settings={latestSettings!}
          testIdPrefix="independent"
        />
        <HoldingsSettings.HoldingsMobileSortControls
          columns={columns}
          dict={dict}
          settings={latestSettings!}
          testIdPrefix="independent"
        />
      </>,
    ));
    pointerDown(container.querySelector('[data-testid="independent-column-settings"]')!);
    await flush();
    const menuReset = document.body.querySelector('[data-testid="independent-reset-sort"]');
    const mobileReset = container.querySelector('[data-testid="independent-mobile-reset-sort"]');
    expect(menuReset).not.toBeNull();
    expect(mobileReset).not.toBeNull();
    act(() => mobileReset?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(resetSort).toHaveBeenCalledTimes(1);
  });

  it("lets mobile switch from field sorting to Custom once, disable direction, and reactivate a type-aware field default", async () => {
    const MobileSortControls = (HoldingsSettings as unknown as { HoldingsMobileSortControls?: React.ComponentType<Record<string, unknown>> })
      .HoldingsMobileSortControls;
    expect(MobileSortControls).toBeTypeOf("function");
    if (!MobileSortControls) throw new Error("HoldingsMobileSortControls is not implemented");
    const setCustomSort = vi.fn();
    const setSort = vi.fn();
    const fieldSettings = {
      setCustomSort,
      setSort,
      sortDirection: "desc",
      sortField: "marketValue",
      sortMode: "field",
    } as unknown as ProposedSortSettings;
    act(() => root.render(<MobileSortControls columns={columns} dict={dict} settings={fieldSettings} testIdPrefix="custom" />));
    const fieldTrigger = container.querySelector('[data-testid="custom-mobile-sort-field"]');
    expect(fieldTrigger?.textContent).toContain("Market value");

    pointerDown(fieldTrigger!);
    await flush();
    const customOption = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'))
      .find((option) => option.textContent?.includes("Custom order"));
    expect(customOption).not.toBeUndefined();
    expect(customOption?.getAttribute("data-disabled")).toBeNull();
    act(() => customOption?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(setCustomSort).toHaveBeenCalledTimes(1);

    const customSettings = { setCustomSort, setSort, sortMode: "custom" } as unknown as ProposedSortSettings;
    act(() => root.render(<MobileSortControls columns={columns} dict={dict} settings={customSettings} testIdPrefix="custom" />));
    const customFieldTrigger = container.querySelector('[data-testid="custom-mobile-sort-field"]');
    const directionToggle = container.querySelector<HTMLButtonElement>('[data-testid="custom-mobile-sort-direction"]');
    expect(customFieldTrigger?.textContent).toContain("Custom order");
    expect(directionToggle?.disabled).toBe(true);

    pointerDown(customFieldTrigger!);
    await flush();
    const tickerOption = Array.from(document.body.querySelectorAll('[role="option"]'))
      .find((option) => option.textContent?.includes("Ticker"));
    expect(tickerOption).not.toBeUndefined();
    act(() => tickerOption?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(setSort).toHaveBeenCalledWith("ticker", "asc");
  });

  it("lets the hidden-active-sort chip change or reset the invisible sort", () => {
    const HiddenSortChip = (HoldingsSettings as unknown as { HoldingsHiddenSortChip?: React.ComponentType<Record<string, unknown>> })
      .HoldingsHiddenSortChip;
    expect(HiddenSortChip).toBeTypeOf("function");
    if (!HiddenSortChip) throw new Error("HoldingsHiddenSortChip is not implemented");
    const resetSort = vi.fn();
    const setSort = vi.fn();
    const settings = {
      resetSort,
      setSort,
      sortDirection: "desc",
      sortField: "marketValue",
      sortMode: "field",
    } as unknown as ProposedSortSettings;
    act(() => root.render(
      <HiddenSortChip
        columns={columns}
        dict={dict}
        settings={settings}
        testIdPrefix="test"
        visibleSortFields={["ticker"]}
      />,
    ));
    const chip = container.querySelector('[data-testid="test-hidden-sort-chip"]');
    const direction = container.querySelector('[data-testid="test-hidden-sort-direction"]');
    const reset = container.querySelector('[data-testid="test-hidden-sort-reset"]');
    expect(chip?.textContent).toContain("Market value");
    expect(chip?.textContent).toMatch(/descending/i);
    act(() => direction?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(setSort).toHaveBeenCalledWith("marketValue", "asc");
    act(() => reset?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(resetSort).toHaveBeenCalledTimes(1);
  });

  it("does not render the hidden-sort chip when the active sort field is visible", () => {
    const HiddenSortChip = (HoldingsSettings as unknown as { HoldingsHiddenSortChip?: React.ComponentType<Record<string, unknown>> })
      .HoldingsHiddenSortChip;
    expect(HiddenSortChip).toBeTypeOf("function");
    if (!HiddenSortChip) throw new Error("HoldingsHiddenSortChip is not implemented");
    const settings = {
      resetSort: vi.fn(),
      setSort: vi.fn(),
      sortDirection: "desc",
      sortField: "marketValue",
      sortMode: "field",
    } as unknown as ProposedSortSettings;
    act(() => root.render(
      <HiddenSortChip
        columns={columns}
        dict={dict}
        settings={settings}
        testIdPrefix="test"
        visibleSortFields={["ticker", "marketValue"]}
      />,
    ));
    expect(container.querySelector('[data-testid="test-hidden-sort-chip"]')).toBeNull();
  });

  it("keeps admin-market-data preferences free of sort state and sort serialization", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({
      preferences: {
        adminMarketDataTableSettings: {
          version: 1,
          contexts: {
            "admin.test": {
              columnOrder: ["ticker", "marketValue"],
              columnWidths: { marketValue: 160, ticker: 120 },
              hiddenColumns: [],
              layoutStyle: "portfolio",
            },
          },
        },
      },
    });
    act(() => root.render(<AdminHookHarness />));
    await flush();
    expect(latestAdminSettings).not.toHaveProperty("sortMode");
    expect(latestAdminSettings).not.toHaveProperty("sortField");
    expect(latestAdminSettings).not.toHaveProperty("sortDirection");
    expect(latestAdminSettings).not.toHaveProperty("setCustomSort");
    expect(latestAdminSettings).not.toHaveProperty("setSort");
    expect(container.querySelector('[data-testid^="admin-market-data-column-sort-"]')).toBeNull();

    act(() => container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();
    expect(patchJson).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(patchJson).mock.calls[0]?.[1] as {
      adminMarketDataTableSettings?: { contexts?: Record<string, Record<string, unknown>> };
    };
    const serialized = payload.adminMarketDataTableSettings?.contexts?.["admin.test"];
    expect(serialized).toBeDefined();
    expect(serialized).not.toHaveProperty("sortMode");
    expect(serialized).not.toHaveProperty("sortField");
    expect(serialized).not.toHaveProperty("sortDirection");
  });
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function pointerDown(element: Element) {
  act(() => {
    const event = new MouseEvent("pointerdown", { bubbles: true, button: 0, cancelable: true });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    element.dispatchEvent(event);
  });
}
