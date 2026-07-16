import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  resetHoldingsSelectionStateForTest,
  useHoldingsSelection,
} from "../../../components/holdings/useHoldingsSelection";
import {
  fetchHoldingsPreferences,
  fetchHoldingsSelectionUniverseTickerIds,
  persistHoldingsSelectionPreference,
} from "../../../components/holdings/holdingsPreferenceHelpers";

vi.mock("../../../components/holdings/holdingsPreferenceHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../components/holdings/holdingsPreferenceHelpers")>();
  return {
    ...actual,
    fetchHoldingsPreferences: vi.fn(),
    fetchHoldingsSelectionUniverseTickerIds: vi.fn(),
    persistHoldingsSelectionPreference: vi.fn(),
  };
});

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const universe = [
  { marketCode: "TW", ticker: "2330", label: "TSMC" },
  { marketCode: "TW", ticker: "2454", label: "MediaTek" },
  { marketCode: "US", ticker: "AAPL", label: "Apple" },
];

function SelectionHarness() {
  const selection = useHoldingsSelection(universe);
  return (
    <div>
      <span data-testid="mode">{selection.selectionMode}</span>
      <span data-testid="selected">{selection.selectedTickerIds.join(",")}</span>
      <span data-testid="2330-selected">{String(selection.isTickerSelected("TW:2330"))}</span>
      <span data-testid="2454-selected">{String(selection.isTickerSelected("TW:2454"))}</span>
      <span data-testid="aapl-selected">{String(selection.isTickerSelected("US:AAPL"))}</span>
      <span data-testid="unknown-selected">{String(selection.isTickerSelected("TW:9999"))}</span>
      <button type="button" onClick={() => selection.toggleTicker("TW:2330")}>Toggle TSMC</button>
    </div>
  );
}

describe("useHoldingsSelection", () => {
  let root: Root;
  let container: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetHoldingsSelectionStateForTest();
    vi.clearAllMocks();
  });

  it("shows all universe tickers selected and removes only the toggled ticker when leaving all mode", async () => {
    vi.mocked(fetchHoldingsPreferences).mockResolvedValue({
      holdingsSelection: { version: 1, mode: "all" },
      holdingsTableSettings: { version: 1, contexts: {} },
      migratedHoldingsTableSettings: false,
    });
    vi.mocked(persistHoldingsSelectionPreference).mockResolvedValue();
    vi.mocked(fetchHoldingsSelectionUniverseTickerIds).mockResolvedValue([
      "TW:2330",
      "TW:2454",
      "US:AAPL",
    ]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<SelectionHarness />);
    });

    expect(container.querySelector("[data-testid='2330-selected']")?.textContent).toBe("true");
    expect(container.querySelector("[data-testid='2454-selected']")?.textContent).toBe("true");
    expect(container.querySelector("[data-testid='aapl-selected']")?.textContent).toBe("true");
    expect(container.querySelector("[data-testid='unknown-selected']")?.textContent).toBe("false");

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='mode']")?.textContent).toBe("custom");
    expect(container.querySelector("[data-testid='selected']")?.textContent).toBe("TW:2454,US:AAPL");
    expect(container.querySelector("[data-testid='2330-selected']")?.textContent).toBe("false");
    expect(container.querySelector("[data-testid='2454-selected']")?.textContent).toBe("true");
    expect(container.querySelector("[data-testid='aapl-selected']")?.textContent).toBe("true");
    expect(persistHoldingsSelectionPreference).toHaveBeenCalledWith({
      version: 1,
      mode: "custom",
      tickerIds: ["TW:2454", "US:AAPL"],
    });
  });

  it("preserves tickers outside a scoped universe when leaving all mode", async () => {
    vi.mocked(fetchHoldingsPreferences).mockResolvedValue({
      holdingsSelection: { version: 1, mode: "all" },
      holdingsTableSettings: { version: 1, contexts: {} },
      migratedHoldingsTableSettings: false,
    });
    vi.mocked(fetchHoldingsSelectionUniverseTickerIds).mockResolvedValue([
      "TW:2330",
      "TW:2454",
      "US:AAPL",
    ]);
    vi.mocked(persistHoldingsSelectionPreference).mockResolvedValue();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function ScopedSelectionHarness() {
      const selection = useHoldingsSelection(universe.slice(0, 2));
      return (
        <div>
          <span data-testid="selected">{selection.selectedTickerIds.join(",")}</span>
          <button type="button" onClick={() => selection.toggleTicker("TW:2330")}>Toggle TSMC</button>
        </div>
      );
    }

    await act(async () => {
      root.render(<ScopedSelectionHarness />);
    });
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='selected']")?.textContent).toBe("TW:2454,US:AAPL");
    expect(persistHoldingsSelectionPreference).toHaveBeenCalledWith({
      version: 1,
      mode: "custom",
      tickerIds: ["TW:2454", "US:AAPL"],
    });
  });
});
