import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// vi.mock calls are hoisted by Vitest before imports. The module factories run
// first so both the component and the test file see the same mocked class
// reference — `instanceof SearchUnavailableError` in the component works.

vi.mock("../../../features/portfolio/services/portfolioService", () => ({
  fetchTransactionInstrumentCatalog: vi.fn(),
}));

vi.mock("../../../features/settings/services/instrumentSearchService", () => {
  // Re-declare SearchUnavailableError inside the factory so the class reference
  // is shared between the component and this test file. The component imports
  // the same mocked class and uses it in its `instanceof` catch guard.
  class SearchUnavailableError extends Error {
    readonly status: number;
    readonly errorCode: string | undefined;

    constructor(status: number, errorCode: string | undefined, message?: string) {
      super(message ?? "search temporarily unavailable");
      this.name = "SearchUnavailableError";
      this.status = status;
      this.errorCode = errorCode;
    }
  }

  return { searchInstruments: vi.fn(), SearchUnavailableError };
});

import { InstrumentCombobox } from "../../../components/portfolio/InstrumentCombobox";
import { getDictionary } from "../../../lib/i18n";
import { fetchTransactionInstrumentCatalog } from "../../../features/portfolio/services/portfolioService";
import {
  searchInstruments,
  SearchUnavailableError,
} from "../../../features/settings/services/instrumentSearchService";

const dict = getDictionary("en");

// ── KZO-188 — CBA instrument fixture (reserved ticker per
//    e2e-shared-memory-bars-ticker-hygiene.md) ───────────────────────────────
const CBA_INSTRUMENT = {
  ticker: "CBA",
  name: "Commonwealth Bank of Australia",
  instrumentType: "STOCK" as const,
  marketCode: "AU",
  barsBackfillStatus: "pending",
  lastRepairAt: null,
  repairAvailableAt: null,
  sector: null,
  gicsIndustryGroup: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Trigger a React controlled input onChange via the native property setter.
 *
 * React 18 intercepts the native "input" event at the root. Setting the DOM
 * value via the HTMLInputElement prototype setter (bypassing React's internal
 * tracker) then dispatching a bubbling "input" event produces a synthetic
 * onChange whose `event.target.value` is the new value — the standard pattern
 * for driving controlled inputs in jsdom tests.
 */
function typeIntoInput(inputEl: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(inputEl, value);
  inputEl.dispatchEvent(new Event("input", { bubbles: true }));
}

// ── Suite setup ───────────────────────────────────────────────────────────────

beforeAll(() => {
  // React 18 strict-mode / concurrent-mode act() integration.
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("InstrumentCombobox — KZO-188 AU live-search results", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // Fake setTimeout so we can advance useDebouncedValue's 300ms timer
    // deterministically. Promises (microtasks) are NOT faked.
    vi.useFakeTimers();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Return an empty AU catalog so the live-search gate condition
    // `filtered.items.length === 0` is satisfied for every query.
    vi.mocked(fetchTransactionInstrumentCatalog).mockResolvedValue({ instruments: [] });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(fetchTransactionInstrumentCatalog).mockReset();
    vi.mocked(searchInstruments).mockReset();
    vi.useRealTimers();
  });

  // ── Test 1: happy path ────────────────────────────────────────────────────

  it("renders a live option row with LIVE badge after debounce and commits (ticker, marketCode)", async () => {
    vi.mocked(searchInstruments).mockResolvedValue([CBA_INSTRUMENT]);

    const onSelect = vi.fn();

    // Render with an empty `value` and `marketCodeFilter="AU"` so live-search
    // is eligible (specific-market AU mode, debouncedQuery.length >= 2,
    // filtered.items.length === 0).
    act(() => {
      root.render(
        <InstrumentCombobox
          value=""
          marketCodeFilter="AU"
          dict={dict}
          onSelect={onSelect}
        />,
      );
    });

    // Flush the fetchTransactionInstrumentCatalog promise → catalog = [].
    await act(async () => {});

    // Open the combobox listbox by focusing the input.
    const inputEl = container.querySelector(
      '[data-testid="tx-ticker-combobox"]',
    ) as HTMLInputElement;
    act(() => {
      inputEl.focus();
    });

    // Type "CBA" — sets query = "CBA" via onChange. The debounce timer starts.
    act(() => {
      typeIntoInput(inputEl, "CBA");
    });

    // Advance debounce timer: debouncedQuery → "CBA", liveSearchEnabled →
    // true, the live-search useEffect fires, searchInstruments() is called.
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Flush the searchInstruments mock promise → setLiveOptions([CBA_INSTRUMENT]).
    await act(async () => {});

    // ── Assert 1: live option row with the LIVE badge is visible ─────────────
    const liveOption = container.querySelector('[data-testid="tx-ticker-option-CBA-AU"]');
    expect(liveOption).not.toBeNull();

    const liveBadge = container.querySelector('[data-testid="tx-ticker-live-badge-CBA"]');
    expect(liveBadge).not.toBeNull();
    // Badge text is the `tickersSearchLiveBadge` i18n key value.
    expect(liveBadge!.textContent).toBe(dict.settings.tickersSearchLiveBadge);

    // No error state while search succeeded.
    const unavailableEl = container.querySelector('[data-testid="tx-ticker-live-unavailable"]');
    expect(unavailableEl).toBeNull();

    // ── Act 2: click the live option ─────────────────────────────────────────
    act(() => {
      (liveOption as HTMLButtonElement).click();
    });
    await act(async () => {});

    // ── Assert 2: onSelect fires with both ticker and marketCode ─────────────
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("CBA", "AU");

    // ── Assert 3: post-commit inputValue drawn from liveResults Map ──────────
    // Simulate the parent propagating the selection back as `value="CBA"` +
    // `selectedMarketCode="AU"`. `selectedInstrument` falls back to the
    // liveResults Map (CBA is not in the local catalog), producing a
    // committedValue that the effect sets as inputValue when isOpen=false.
    await act(async () => {
      root.render(
        <InstrumentCombobox
          value="CBA"
          selectedMarketCode="AU"
          marketCodeFilter="AU"
          dict={dict}
          onSelect={onSelect}
        />,
      );
    });
    // Flush the committedValue → inputValue effect.
    await act(async () => {});

    const inputAfterCommit = container.querySelector(
      '[data-testid="tx-ticker-combobox"]',
    ) as HTMLInputElement;
    // In specific-market mode (not ALL-mode), the display format is
    // "{ticker} — {name}" i.e. "CBA — Commonwealth Bank of Australia".
    expect(inputAfterCommit.value).toContain("CBA");
    expect(inputAfterCommit.value).toContain("Commonwealth Bank of Australia");
  });

  // ── Test 2: SearchUnavailableError path ───────────────────────────────────

  it("renders the live-unavailable error message when searchInstruments throws SearchUnavailableError", async () => {
    // Wire mock to reject with a SearchUnavailableError (the component's
    // `instanceof` guard catches this and sets liveError).
    vi.mocked(searchInstruments).mockRejectedValue(
      new SearchUnavailableError(503, "search_unavailable"),
    );

    const onSelect = vi.fn();

    act(() => {
      root.render(
        <InstrumentCombobox
          value=""
          marketCodeFilter="AU"
          dict={dict}
          onSelect={onSelect}
        />,
      );
    });
    await act(async () => {});

    const inputEl = container.querySelector(
      '[data-testid="tx-ticker-combobox"]',
    ) as HTMLInputElement;
    act(() => {
      inputEl.focus();
    });

    act(() => {
      typeIntoInput(inputEl, "CBA");
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Flush the rejected searchInstruments promise → catch block runs →
    // setLiveError(err) → setLiveOptions([]).
    await act(async () => {});

    // ── Assert: unavailable error element is visible ──────────────────────────
    const unavailableEl = container.querySelector('[data-testid="tx-ticker-live-unavailable"]');
    expect(unavailableEl).not.toBeNull();
    // i18n en: "Search temporarily unavailable. Try again in a few minutes."
    expect(unavailableEl!.textContent).toContain("Search temporarily unavailable");

    // ── Assert: no live option row rendered ───────────────────────────────────
    const liveOption = container.querySelector('[data-testid="tx-ticker-option-CBA-AU"]');
    expect(liveOption).toBeNull();

    // onSelect is never called (user never committed).
    expect(onSelect).not.toHaveBeenCalled();
  });
});
