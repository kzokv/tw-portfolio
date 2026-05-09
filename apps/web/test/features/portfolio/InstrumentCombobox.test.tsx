import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../../features/portfolio/services/portfolioService", () => ({
  fetchTransactionInstrumentCatalog: vi.fn(),
}));

import { InstrumentCombobox } from "../../../components/portfolio/InstrumentCombobox";
import { getDictionary } from "../../../lib/i18n";
import { fetchTransactionInstrumentCatalog } from "../../../features/portfolio/services/portfolioService";

const dict = getDictionary("en");

// KZO-169 — Frontend Implementer's TDD red specs for the InstrumentCombobox
// changes (slice 5, D5d / D5e):
//   - ALL mode renders TICKER · MARKET on every row + the committed input.
//   - Specific-market mode renders just TICKER (no suffix).
//   - Commit invokes onSelect with BOTH ticker AND marketCode.

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("InstrumentCombobox — KZO-169 ALL-mode disambiguation", () => {
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
    vi.mocked(fetchTransactionInstrumentCatalog).mockReset();
  });

  it("forwards marketCodeFilter to the catalog fetcher (specific market)", async () => {
    vi.mocked(fetchTransactionInstrumentCatalog).mockResolvedValue({ instruments: [] });
    act(() => {
      root.render(
        <InstrumentCombobox
          value=""
          marketCodeFilter="AU"
          dict={dict}
          onSelect={() => undefined}
        />,
      );
    });
    await act(async () => {});
    expect(vi.mocked(fetchTransactionInstrumentCatalog)).toHaveBeenCalledWith("AU");
  });

  it("forwards 'ALL' when marketCodeFilter is null (chip = All)", async () => {
    vi.mocked(fetchTransactionInstrumentCatalog).mockResolvedValue({ instruments: [] });
    act(() => {
      root.render(
        <InstrumentCombobox
          value=""
          marketCodeFilter={null}
          dict={dict}
          onSelect={() => undefined}
        />,
      );
    });
    await act(async () => {});
    expect(vi.mocked(fetchTransactionInstrumentCatalog)).toHaveBeenCalledWith("ALL");
  });

  it("renders TICKER · MARKET suffix for the committed value when in ALL mode", async () => {
    vi.mocked(fetchTransactionInstrumentCatalog).mockResolvedValue({
      instruments: [
        {
          ticker: "BHP",
          name: "BHP Group",
          instrumentType: "STOCK",
          marketCode: "AU",
          barsBackfillStatus: "ready",
          lastRepairAt: null,
          repairAvailableAt: null,
        gicsIndustryGroup: null,
        },
        {
          ticker: "BHP",
          name: "BHP Group",
          instrumentType: "STOCK",
          marketCode: "US",
          barsBackfillStatus: "ready",
          lastRepairAt: null,
          repairAvailableAt: null,
        gicsIndustryGroup: null,
        },
      ],
    });

    act(() => {
      root.render(
        <InstrumentCombobox
          value="BHP"
          marketCodeFilter={null}
          dict={dict}
          onSelect={() => undefined}
        />,
      );
    });
    await act(async () => {});

    // The combobox <input> initial committedValue is the FIRST matching row in
    // ALL mode (BHP·AU), formatted with the market suffix.
    const inputEl = container.querySelector('[data-testid="tx-ticker-combobox"]') as HTMLInputElement | null;
    expect(inputEl).not.toBeNull();
    expect(inputEl!.value).toContain("BHP · AU");
  });

  it("uses selectedMarketCode to disambiguate the committed value in ALL mode", async () => {
    vi.mocked(fetchTransactionInstrumentCatalog).mockResolvedValue({
      instruments: [
        {
          ticker: "BHP",
          name: "BHP Group",
          instrumentType: "STOCK",
          marketCode: "AU",
          barsBackfillStatus: "ready",
          lastRepairAt: null,
          repairAvailableAt: null,
        gicsIndustryGroup: null,
        },
        {
          ticker: "BHP",
          name: "BHP Group ADR",
          instrumentType: "STOCK",
          marketCode: "US",
          barsBackfillStatus: "ready",
          lastRepairAt: null,
          repairAvailableAt: null,
        gicsIndustryGroup: null,
        },
      ],
    });

    act(() => {
      root.render(
        <InstrumentCombobox
          value="BHP"
          selectedMarketCode="US"
          marketCodeFilter={null}
          dict={dict}
          onSelect={() => undefined}
        />,
      );
    });
    await act(async () => {});

    const inputEl = container.querySelector('[data-testid="tx-ticker-combobox"]') as HTMLInputElement | null;
    expect(inputEl).not.toBeNull();
    expect(inputEl!.value).toContain("BHP · US");
  });

  it("does NOT render the · suffix for the committed input in specific-market mode", async () => {
    vi.mocked(fetchTransactionInstrumentCatalog).mockResolvedValue({
      instruments: [
        {
          ticker: "2330",
          name: "TSMC",
          instrumentType: "STOCK",
          marketCode: "TW",
          barsBackfillStatus: "ready",
          lastRepairAt: null,
          repairAvailableAt: null,
        gicsIndustryGroup: null,
        },
      ],
    });

    act(() => {
      root.render(
        <InstrumentCombobox
          value="2330"
          marketCodeFilter="TW"
          dict={dict}
          onSelect={() => undefined}
        />,
      );
    });
    await act(async () => {});

    const inputEl = container.querySelector('[data-testid="tx-ticker-combobox"]') as HTMLInputElement | null;
    expect(inputEl).not.toBeNull();
    expect(inputEl!.value).toContain("2330");
    expect(inputEl!.value).not.toContain("· TW");
  });

  it("emits BOTH ticker AND marketCode on commit (D5e)", async () => {
    vi.mocked(fetchTransactionInstrumentCatalog).mockResolvedValue({
      instruments: [
        {
          ticker: "BHP",
          name: "BHP Group",
          instrumentType: "STOCK",
          marketCode: "AU",
          barsBackfillStatus: "ready",
          lastRepairAt: null,
          repairAvailableAt: null,
        gicsIndustryGroup: null,
        },
      ],
    });

    const onSelect = vi.fn();
    act(() => {
      root.render(
        <InstrumentCombobox
          value=""
          marketCodeFilter={null}
          dict={dict}
          onSelect={onSelect}
        />,
      );
    });
    await act(async () => {});

    // Open the listbox via focus — `tx-ticker-listbox` becomes visible.
    const inputEl = container.querySelector('[data-testid="tx-ticker-combobox"]') as HTMLInputElement;
    act(() => {
      inputEl.focus();
    });

    // Click the BHP·AU option directly.
    const optionEl = container.querySelector('[data-testid="tx-ticker-option-BHP-AU"]') as HTMLButtonElement | null;
    expect(optionEl).not.toBeNull();
    act(() => {
      optionEl!.click();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("BHP", "AU");
  });
});
