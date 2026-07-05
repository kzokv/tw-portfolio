import React, { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TickersSettingsClient } from "../../../components/settings/TickersSettingsClient";

const searchParamsMock = vi.hoisted(() => ({
  value: "repair=1&origin=data-health&market=TW&tickers=2330%2C2317&returnTo=%2Freports%3Ftab%3Dportfolio%26scope%3Dall%26health%3D1",
}));
const setRepairModeMock = vi.hoisted(() => vi.fn());
const setShowCatalogMock = vi.hoisted(() => vi.fn());
const submitRepairRequestsMock = vi.hoisted(() => vi.fn(async () => undefined));
const repairSelectionMock = vi.hoisted(() => ({ value: new Set<string>() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParamsMock.value),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("../../../components/settings/SettingsRouteProvider", () => ({
  useSettingsRouteContext: () => ({ locale: "en" }),
}));

vi.mock("../../../features/settings/hooks/useMonitoredTickers", () => ({
  useMonitoredTickers: () => ({
    monitoredTickers: [
      { key: "2330|TW", ticker: "2330", name: "Taiwan Semiconductor", marketCode: "TW", source: "manual", barsBackfillStatus: "ready" },
      { key: "2317|TW", ticker: "2317", name: "Hon Hai", marketCode: "TW", source: "manual", barsBackfillStatus: "ready" },
      { key: "0050|TW", ticker: "0050", name: "Taiwan 50 ETF", marketCode: "TW", source: "manual", barsBackfillStatus: "ready" },
      { key: "BHP|AU", ticker: "BHP", name: "BHP Group AU", marketCode: "AU", source: "manual", barsBackfillStatus: "ready" },
      { key: "BHP|US", ticker: "BHP", name: "BHP Group US", marketCode: "US", source: "manual", barsBackfillStatus: "ready" },
    ],
    instruments: [],
    selectedTickers: new Set(["2330|TW", "2317|TW", "0050|TW", "BHP|AU", "BHP|US"]),
    showCatalog: false,
    setShowCatalog: setShowCatalogMock,
    toggleTicker: vi.fn(),
    isDirty: false,
    save: vi.fn(async () => undefined),
    isSaving: false,
    saveError: "",
    saveSuccess: "",
    isLoading: false,
    isCatalogLoading: false,
    catalogError: "",
    retryTicker: vi.fn(async () => undefined),
    repairMode: true,
    setRepairMode: setRepairModeMock,
    repairSelection: repairSelectionMock.value,
    toggleRepairSelection: vi.fn(),
    clearRepairSelection: vi.fn(),
    submitRepairRequests: submitRepairRequestsMock,
    isRepairSubmitting: false,
    repairMessage: "",
    repairError: "",
  }),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("TickersSettingsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setRepairModeMock.mockReset();
    setShowCatalogMock.mockReset();
    submitRepairRequestsMock.mockClear();
    repairSelectionMock.value = new Set();
    searchParamsMock.value = "repair=1&origin=data-health&market=TW&tickers=2330%2C2317&returnTo=%2Freports%3Ftab%3Dportfolio%26scope%3Dall%26health%3D1";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("opens repair mode from Data Health query state with return and suggested ticker guidance", async () => {
    act(() => {
      root.render(<TickersSettingsClient />);
    });

    await act(async () => {});

    expect(setShowCatalogMock).toHaveBeenCalledWith(false);
    expect(setRepairModeMock).toHaveBeenCalledWith(true);
    expect(container.querySelector("[data-testid='settings-tickers-repair-origin']")?.textContent).toContain("Opened from Data Health");
    expect(container.querySelector("[data-testid='settings-tickers-repair-origin']")?.textContent).toContain("2330 · TW, 2317 · TW");
    expect(container.querySelector<HTMLAnchorElement>("[data-testid='settings-tickers-repair-return-link']")?.getAttribute("href")).toBe(
      "/reports?tab=portfolio&scope=all&health=1",
    );
    expect(container.querySelector("[data-testid='repair-row-2330']")?.textContent).toContain("Suggested by Data Health");
    expect(container.querySelector("[data-testid='repair-row-2317']")?.textContent).toContain("Suggested by Data Health");
    expect(container.querySelector("[data-testid='repair-row-0050']")?.textContent).not.toContain("Suggested by Data Health");
  });

  it("scopes Data Health repair suggestions to the linked market", async () => {
    searchParamsMock.value = "repair=1&origin=data-health&market=AU&tickers=BHP";

    act(() => {
      root.render(<TickersSettingsClient />);
    });

    await act(async () => {});

    const bhpRows = Array.from(container.querySelectorAll("[data-testid='repair-row-BHP']"));
    expect(bhpRows).toHaveLength(2);
    expect(bhpRows.find((row) => row.textContent?.includes("BHP · AU"))?.textContent).toContain("Suggested by Data Health");
    expect(bhpRows.find((row) => row.textContent?.includes("BHP · US"))?.textContent).not.toContain("Suggested by Data Health");
  });

  it("submits market-aware repair targets from selected keys", async () => {
    searchParamsMock.value = "repair=1&origin=data-health&market=AU&tickers=BHP";
    repairSelectionMock.value = new Set(["BHP|AU"]);

    act(() => {
      root.render(<TickersSettingsClient />);
    });

    await act(async () => {});
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='repair-continue-btn']")?.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='repair-submit']")?.click();
    });

    expect(submitRepairRequestsMock).toHaveBeenCalledWith([
      expect.objectContaining({
        tickers: [],
        targets: [{ ticker: "BHP", marketCode: "AU" }],
      }),
    ]);
  });

  it("keeps grouped market-aware repair targets out of the legacy ticker list", async () => {
    searchParamsMock.value = "repair=1&origin=data-health&market=AU&tickers=BHP";
    repairSelectionMock.value = new Set(["BHP|AU", "BHP|US"]);

    act(() => {
      root.render(<TickersSettingsClient />);
    });

    await act(async () => {});
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='repair-continue-btn']")?.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='repair-submit']")?.click();
    });

    expect(submitRepairRequestsMock).toHaveBeenCalledWith([
      expect.objectContaining({
        tickers: [],
        targets: [
          { ticker: "BHP", marketCode: "AU" },
          { ticker: "BHP", marketCode: "US" },
        ],
      }),
    ]);
  });

  it("does not show the Data Health origin banner for generic repair links", async () => {
    searchParamsMock.value = "repair=1&tickers=NVDA&returnTo=https%3A%2F%2Fevil.example";

    act(() => {
      root.render(<TickersSettingsClient />);
    });

    await act(async () => {});

    expect(setRepairModeMock).toHaveBeenCalledWith(true);
    expect(setShowCatalogMock).toHaveBeenCalledWith(false);
    expect(container.querySelector("[data-testid='settings-tickers-repair-origin']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-tickers-repair-return-link']")).toBeNull();
  });

  it("rejects backslash-prefixed Data Health return paths", async () => {
    searchParamsMock.value = "repair=1&origin=data-health&market=TW&tickers=2330&returnTo=%2F%5Cevil.example";

    act(() => {
      root.render(<TickersSettingsClient />);
    });

    await act(async () => {});

    expect(container.querySelector("[data-testid='settings-tickers-repair-origin']")).not.toBeNull();
    expect(container.querySelector("[data-testid='settings-tickers-repair-return-link']")).toBeNull();
  });
});
