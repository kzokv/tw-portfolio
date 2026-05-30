import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { InstrumentCatalogItemDto } from "@vakwen/shared-types";
import { InstrumentCatalogSheet } from "../../../../features/settings/components/InstrumentCatalogSheet";
import { getDictionary } from "../../../../lib/i18n";

vi.mock("../../../../features/settings/services/instrumentSearchService", () => ({
  searchInstruments: vi.fn().mockResolvedValue([
    {
      ticker: "AUGICSLIVE",
      name: "Live Result Co",
      instrumentType: "STOCK",
      marketCode: "AU",
      barsBackfillStatus: "pending",
      lastRepairAt: null,
      repairAvailableAt: null,
      sector: null,
      gicsIndustryGroup: null,
    },
  ]),
  SearchUnavailableError: class SearchUnavailableError extends Error {},
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function makeInstrument(overrides: Partial<InstrumentCatalogItemDto> = {}): InstrumentCatalogItemDto {
  return {
    ticker: "TEST001",
    name: "Test Co",
    instrumentType: "STOCK",
    marketCode: "AU",
    barsBackfillStatus: "ready",
    lastRepairAt: null,
    repairAvailableAt: null,
    gicsIndustryGroup: null,
    sector: null,
    ...overrides,
  };
}

describe("InstrumentCatalogSheet sector filtering", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderSheet(instruments: InstrumentCatalogItemDto[]) {
    act(() =>
      root.render(
        <InstrumentCatalogSheet
          instruments={instruments}
          selectedTickers={new Set()}
          positionTickers={new Set()}
          onToggleTicker={vi.fn()}
          onBack={vi.fn()}
          dict={dict}
        />,
      ),
    );
  }

  function clickMarketChip(value: string) {
    const chip = container.querySelector(
      `[data-testid="catalog-market-chip-${value.toLowerCase()}"]`,
    ) as HTMLButtonElement | null;
    if (!chip) throw new Error(`market chip ${value} not rendered`);
    act(() => chip.click());
  }

  function setSectorFilter(value: string) {
    const select = container.querySelector(
      '[data-testid="catalog-sector-filter"]',
    ) as HTMLSelectElement | null;
    if (!select) throw new Error("sector select not rendered");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function setSearch(value: string) {
    const input = container.querySelector('[data-testid="catalog-search"]') as HTMLInputElement | null;
    if (!input) throw new Error("search input not rendered");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("shows the sector dropdown for TW/US/AU only", () => {
    renderSheet([makeInstrument()]);

    expect(container.querySelector('[data-testid="catalog-sector-filter"]')).toBeNull();

    clickMarketChip("TW");
    expect(container.querySelector('[data-testid="catalog-sector-filter"]')).not.toBeNull();

    clickMarketChip("US");
    expect(container.querySelector('[data-testid="catalog-sector-filter"]')).not.toBeNull();

    clickMarketChip("AU");
    expect(container.querySelector('[data-testid="catalog-sector-filter"]')).not.toBeNull();

    clickMarketChip("ALL");
    expect(container.querySelector('[data-testid="catalog-sector-filter"]')).toBeNull();
  });

  it("filters AU rows by industry-group expansion and keeps the industry-group subtitle", () => {
    renderSheet([
      makeInstrument({ ticker: "AUBANK", marketCode: "AU", gicsIndustryGroup: "Banks" }),
      makeInstrument({ ticker: "AUINS", marketCode: "AU", gicsIndustryGroup: "Insurance" }),
      makeInstrument({ ticker: "AUMAT", marketCode: "AU", gicsIndustryGroup: "Materials" }),
      makeInstrument({ ticker: "AUNONE", marketCode: "AU", gicsIndustryGroup: null }),
    ]);

    clickMarketChip("AU");
    setSectorFilter("Financials");

    expect(container.querySelector('[data-testid="catalog-item-AUBANK"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-AUINS"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-AUMAT"]')).toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-AUNONE"]')).toBeNull();

    const subtitle = container.querySelector('[data-testid="catalog-row-industry-group-AUBANK"]');
    expect(subtitle).not.toBeNull();
    expect(subtitle!.textContent).toBe(dict.gics.industryGroups.gics_ig_banks);
  });

  it("filters TW and US rows by normalized sector and shows sector subtitles", () => {
    renderSheet([
      makeInstrument({ ticker: "2330", marketCode: "TW", sector: "Information Technology" }),
      makeInstrument({ ticker: "2882", marketCode: "TW", sector: "Financials" }),
      makeInstrument({ ticker: "AAPL", marketCode: "US", sector: "Information Technology" }),
      makeInstrument({ ticker: "JPM", marketCode: "US", sector: "Financials" }),
      makeInstrument({ ticker: "IEF", marketCode: "US", instrumentType: "ETF", sector: null }),
    ]);

    clickMarketChip("TW");
    setSectorFilter("Information Technology");
    expect(container.querySelector('[data-testid="catalog-item-2330"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-2882"]')).toBeNull();

    const twSubtitle = container.querySelector('[data-testid="catalog-row-sector-2330"]');
    expect(twSubtitle).not.toBeNull();
    expect(twSubtitle!.textContent).toBe("Information Technology");

    clickMarketChip("US");
    expect(container.querySelector('[data-testid="catalog-item-AAPL"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-JPM"]')).toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-IEF"]')).toBeNull();

    const usSubtitle = container.querySelector('[data-testid="catalog-row-sector-AAPL"]');
    expect(usSubtitle).not.toBeNull();
    expect(usSubtitle!.textContent).toBe("Information Technology");
  });

  it("does not render subtitles for sectorless TW/US rows", () => {
    renderSheet([
      makeInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", sector: null }),
      makeInstrument({ ticker: "BND", marketCode: "US", instrumentType: "BOND_ETF", sector: null }),
    ]);

    clickMarketChip("TW");
    expect(container.querySelector('[data-testid="catalog-row-sector-0050"]')).toBeNull();

    clickMarketChip("US");
    expect(container.querySelector('[data-testid="catalog-row-sector-BND"]')).toBeNull();
  });

  it("search bypasses sector filtering for all supported markets", () => {
    renderSheet([
      makeInstrument({ ticker: "2330", marketCode: "TW", sector: "Information Technology" }),
      makeInstrument({ ticker: "2882", marketCode: "TW", sector: "Financials" }),
      makeInstrument({ ticker: "AAPL", marketCode: "US", sector: "Information Technology" }),
      makeInstrument({ ticker: "JPM", marketCode: "US", sector: "Financials" }),
      makeInstrument({ ticker: "AUBANK", marketCode: "AU", gicsIndustryGroup: "Banks" }),
      makeInstrument({ ticker: "AUMAT", marketCode: "AU", gicsIndustryGroup: "Materials" }),
    ]);

    clickMarketChip("TW");
    setSectorFilter("Information Technology");
    setSearch("2882");
    expect(container.querySelector('[data-testid="catalog-item-2882"]')).not.toBeNull();

    setSearch("");
    clickMarketChip("US");
    setSearch("JPM");
    expect(container.querySelector('[data-testid="catalog-item-JPM"]')).not.toBeNull();

    setSearch("");
    clickMarketChip("AU");
    setSearch("AUMAT");
    expect(container.querySelector('[data-testid="catalog-item-AUMAT"]')).not.toBeNull();
  });

  it("clears the active sector narrow when returning to ALL", () => {
    renderSheet([
      makeInstrument({ ticker: "2330", marketCode: "TW", sector: "Information Technology" }),
      makeInstrument({ ticker: "2882", marketCode: "TW", sector: "Financials" }),
    ]);

    clickMarketChip("TW");
    setSectorFilter("Information Technology");
    expect(container.querySelector('[data-testid="catalog-item-2882"]')).toBeNull();

    clickMarketChip("ALL");
    clickMarketChip("TW");

    const select = container.querySelector(
      '[data-testid="catalog-sector-filter"]',
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select!.value).toBe("");
    expect(container.querySelector('[data-testid="catalog-item-2882"]')).not.toBeNull();
  });
});
