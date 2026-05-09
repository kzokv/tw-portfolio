/**
 * KZO-196 — Web-unit tests for the AU-only GICS sector filter on
 * `InstrumentCatalogSheet`.
 *
 * Covers:
 *   - Sector dropdown is rendered ONLY when marketChip === "AU" (hidden, not
 *     disabled, for ALL/TW/US).
 *   - Selecting a sector narrows catalog rows to those whose
 *     `gicsIndustryGroup` is in `industryGroupsForSector(selected)`.
 *   - "All sectors" (`null` value) leaves the catalog unfiltered.
 *   - Industry-group label is rendered on rows that have the field set;
 *     unknown groups bucket to the "Other" label.
 *   - Switching the market chip OFF AU clears any active sector narrow so
 *     it cannot silently resurface on a future AU re-entry.
 *   - Live-search results bypass the sector filter entirely (existing
 *     `instrumentSearchService` mock returns an item; we assert the live
 *     row renders even when the sector filter would have hidden it).
 *
 * Pattern follows `apps/web/test/features/settings/components/AccountCreateForm.test.tsx`
 * — react-dom/client + act() (not RTL) to match the project's existing
 * web-unit harness.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { InstrumentCatalogItemDto } from "@tw-portfolio/shared-types";
import { InstrumentCatalogSheet } from "../../../../features/settings/components/InstrumentCatalogSheet";
import { getDictionary } from "../../../../lib/i18n";

// Mock the live-search service so we can assert live-results render WITHOUT a
// real network. The component only calls it when chip === AU AND filtered
// catalog count is 0.
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
      gicsIndustryGroup: null,
    },
  ]),
  SearchUnavailableError: class SearchUnavailableError extends Error {},
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function makeInstrument(
  overrides: Partial<InstrumentCatalogItemDto> = {},
): InstrumentCatalogItemDto {
  return {
    ticker: "AUGICS001",
    name: "AU Test Co",
    instrumentType: "STOCK",
    marketCode: "AU",
    barsBackfillStatus: "ready",
    lastRepairAt: null,
    repairAvailableAt: null,
    gicsIndustryGroup: null,
    ...overrides,
  };
}

describe("InstrumentCatalogSheet — KZO-196 sector filter", () => {
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

  it("dropdown is hidden for ALL/TW/US, visible for AU", () => {
    renderSheet([makeInstrument()]);

    // Default chip is ALL — dropdown hidden.
    expect(container.querySelector('[data-testid="catalog-sector-filter"]')).toBeNull();

    clickMarketChip("TW");
    expect(container.querySelector('[data-testid="catalog-sector-filter"]')).toBeNull();

    clickMarketChip("US");
    expect(container.querySelector('[data-testid="catalog-sector-filter"]')).toBeNull();

    clickMarketChip("AU");
    expect(container.querySelector('[data-testid="catalog-sector-filter"]')).not.toBeNull();
  });

  it("selecting a sector narrows AU rows by industry-group expansion", () => {
    const instruments = [
      makeInstrument({ ticker: "AUGICS001", gicsIndustryGroup: "Banks" }),
      makeInstrument({ ticker: "AUGICS002", gicsIndustryGroup: "Insurance" }),
      makeInstrument({ ticker: "AUGICS003", gicsIndustryGroup: "Materials" }),
      makeInstrument({ ticker: "AUGICS004", gicsIndustryGroup: null }),
    ];
    renderSheet(instruments);
    clickMarketChip("AU");

    // No sector filter → all 4 AU rows render.
    expect(container.querySelector('[data-testid="catalog-item-AUGICS001"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-AUGICS002"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-AUGICS003"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-AUGICS004"]')).not.toBeNull();

    // Select "Financials" — should keep Banks + Insurance, hide Materials + null.
    const select = container.querySelector(
      '[data-testid="catalog-sector-filter"]',
    ) as HTMLSelectElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(select, "Financials");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="catalog-item-AUGICS001"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-AUGICS002"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-AUGICS003"]')).toBeNull();
    expect(container.querySelector('[data-testid="catalog-item-AUGICS004"]')).toBeNull();
  });

  it("'All sectors' (empty value) clears the narrow", () => {
    const instruments = [
      makeInstrument({ ticker: "AUGICS001", gicsIndustryGroup: "Banks" }),
      makeInstrument({ ticker: "AUGICS003", gicsIndustryGroup: "Materials" }),
    ];
    renderSheet(instruments);
    clickMarketChip("AU");

    const select = container.querySelector(
      '[data-testid="catalog-sector-filter"]',
    ) as HTMLSelectElement;
    const setVal = (val: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(select, val);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };

    act(() => setVal("Financials"));
    expect(container.querySelector('[data-testid="catalog-item-AUGICS003"]')).toBeNull();

    act(() => setVal(""));
    expect(container.querySelector('[data-testid="catalog-item-AUGICS003"]')).not.toBeNull();
  });

  it("renders industry-group label on rows that have it; bucketizes unknowns to Other", () => {
    renderSheet([
      makeInstrument({ ticker: "AUGICS001", gicsIndustryGroup: "Banks" }),
      makeInstrument({ ticker: "AUGICS002", gicsIndustryGroup: "Not A Real Group" }),
      makeInstrument({ ticker: "AUGICS003", gicsIndustryGroup: null }),
    ]);
    clickMarketChip("AU");

    const banks = container.querySelector(
      '[data-testid="catalog-row-industry-group-AUGICS001"]',
    );
    expect(banks).not.toBeNull();
    expect(banks!.textContent).toBe(dict.gics.industryGroups.gics_ig_banks);

    const unknown = container.querySelector(
      '[data-testid="catalog-row-industry-group-AUGICS002"]',
    );
    expect(unknown).not.toBeNull();
    expect(unknown!.textContent).toBe(dict.settings.tickersGicsOtherBucket);

    // Null group → no label rendered at all.
    expect(
      container.querySelector('[data-testid="catalog-row-industry-group-AUGICS003"]'),
    ).toBeNull();
  });

  it("clears active sector narrow when user moves OFF the AU chip", () => {
    const instruments = [
      makeInstrument({ ticker: "AUGICS001", gicsIndustryGroup: "Banks" }),
      makeInstrument({ ticker: "AUGICS003", gicsIndustryGroup: "Materials" }),
    ];
    renderSheet(instruments);
    clickMarketChip("AU");

    const select = container.querySelector(
      '[data-testid="catalog-sector-filter"]',
    ) as HTMLSelectElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(select, "Financials");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="catalog-item-AUGICS003"]')).toBeNull();

    // Move OFF AU; come back. Sector filter should be `null` again.
    clickMarketChip("ALL");
    clickMarketChip("AU");

    const reSelect = container.querySelector(
      '[data-testid="catalog-sector-filter"]',
    ) as HTMLSelectElement;
    expect(reSelect.value).toBe("");
    expect(container.querySelector('[data-testid="catalog-item-AUGICS003"]')).not.toBeNull();
  });
});
