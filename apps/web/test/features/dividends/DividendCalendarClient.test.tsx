import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DividendCalendarClient } from "../../../components/dividends/DividendCalendarClient";
import { getDictionary } from "../../../lib/i18n";
import type { DividendCalendarSnapshot, DividendEventListItem, DividendLedgerEntryDetails } from "../../../features/dividends/types";

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendCalendarSnapshot: vi.fn(),
  updateDividendReconciliation: vi.fn(),
}));

vi.mock("../../../hooks/useEventStream", () => ({
  useEventStream: () => undefined,
}));

import {
  fetchDividendCalendarSnapshot,
  updateDividendReconciliation,
} from "../../../features/dividends/services/dividendService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildEvent(overrides: Partial<DividendEventListItem>): DividendEventListItem {
  return {
    id: overrides.id ?? "event-1",
    accountId: overrides.accountId ?? "acc-1",
    ticker: overrides.ticker ?? "2330",
    marketCode: overrides.marketCode ?? "TW",
    instrumentType: overrides.instrumentType ?? "STOCK",
    eventType: overrides.eventType ?? "CASH",
    exDividendDate: overrides.exDividendDate ?? "2026-04-10",
    paymentDate: overrides.paymentDate === undefined ? "2026-04-20" : overrides.paymentDate,
    cashDividendCurrency: overrides.cashDividendCurrency ?? "TWD",
    expectedCashAmount: overrides.expectedCashAmount ?? 100,
    expectedStockQuantity: overrides.expectedStockQuantity ?? 0,
    eligibleQuantity: overrides.eligibleQuantity ?? 1_000,
    hasPostedLedgerEntry: overrides.hasPostedLedgerEntry ?? false,
    dividendLedgerEntryId: overrides.dividendLedgerEntryId === undefined ? null : overrides.dividendLedgerEntryId,
  };
}

function buildLedger(overrides: Partial<DividendLedgerEntryDetails>): DividendLedgerEntryDetails {
  return {
    id: overrides.id ?? "ledger-1",
    dividendEventId: overrides.dividendEventId ?? "event-1",
    accountId: overrides.accountId ?? "acc-1",
    ticker: overrides.ticker ?? "2330",
    marketCode: overrides.marketCode ?? "TW",
    instrumentType: overrides.instrumentType ?? "STOCK",
    eventType: overrides.eventType ?? "CASH",
    paymentDate: overrides.paymentDate ?? "2026-04-20",
    exDividendDate: overrides.exDividendDate ?? "2026-04-10",
    cashCurrency: overrides.cashCurrency ?? "TWD",
    postingStatus: overrides.postingStatus ?? "posted",
    reconciliationStatus: overrides.reconciliationStatus ?? "matched",
    sourceCompositionStatus: overrides.sourceCompositionStatus ?? "provided",
    version: overrides.version ?? 1,
    reconciliationNote: overrides.reconciliationNote ?? null,
    expectedCashAmount: overrides.expectedCashAmount ?? 100,
    receivedCashAmount: overrides.receivedCashAmount ?? 100,
    expectedStockQuantity: overrides.expectedStockQuantity ?? 0,
    receivedStockQuantity: overrides.receivedStockQuantity ?? 0,
    eligibleQuantity: overrides.eligibleQuantity ?? 1_000,
    sourceLines: overrides.sourceLines ?? [],
    deductions: overrides.deductions ?? [],
  };
}

describe("DividendCalendarClient", () => {
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
    vi.mocked(fetchDividendCalendarSnapshot).mockReset();
    vi.mocked(updateDividendReconciliation).mockReset();
  });

  it("renders the empty state when there are no rows for the month", async () => {
    const snapshot: DividendCalendarSnapshot = { events: [], ledgerEntries: [] };
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue(snapshot);
    window.history.replaceState(null, "", "/dividends?view=calendar&ticker=2330&marketCode=TW&status=open");

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={snapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });

    await act(async () => {});

    expect(container.textContent).toContain(dict.dividends.emptyState);
    expect(window.location.search).toBe("?month=2026-04");
  });

  it("renders overview metrics and marks open rows as matched", async () => {
    const snapshot: DividendCalendarSnapshot = {
      events: [
        buildEvent({ id: "event-open", ticker: "2330", hasPostedLedgerEntry: true, dividendLedgerEntryId: "ledger-open" }),
        buildEvent({ id: "event-posted", ticker: "2317", hasPostedLedgerEntry: true, dividendLedgerEntryId: "ledger-posted" }),
        buildEvent({ id: "event-variance", ticker: "0050", instrumentType: "ETF", hasPostedLedgerEntry: true, dividendLedgerEntryId: "ledger-variance" }),
        buildEvent({ id: "event-resolved", ticker: "2891", hasPostedLedgerEntry: true, dividendLedgerEntryId: "ledger-resolved" }),
        buildEvent({ id: "event-stock", ticker: "2603", eventType: "STOCK", paymentDate: "2026-04-18", expectedCashAmount: 0, expectedStockQuantity: 50, hasPostedLedgerEntry: true, dividendLedgerEntryId: "ledger-stock" }),
        buildEvent({ id: "event-expected", ticker: "1199", hasPostedLedgerEntry: true, dividendLedgerEntryId: "ledger-expected" }),
        buildEvent({ id: "event-unposted", ticker: "2882", hasPostedLedgerEntry: false, dividendLedgerEntryId: null }),
        buildEvent({ id: "event-tbd", ticker: "1101", paymentDate: null, hasPostedLedgerEntry: false }),
      ],
      ledgerEntries: [
        buildLedger({ id: "ledger-open", dividendEventId: "event-open", ticker: "2330", reconciliationStatus: "open" }),
        buildLedger({ id: "ledger-posted", dividendEventId: "event-posted", ticker: "2317", reconciliationStatus: "matched" }),
        buildLedger({ id: "ledger-variance", dividendEventId: "event-variance", ticker: "0050", instrumentType: "ETF", reconciliationStatus: "matched", receivedCashAmount: 95, expectedCashAmount: 100 }),
        buildLedger({ id: "ledger-resolved", dividendEventId: "event-resolved", ticker: "2891", reconciliationStatus: "resolved" }),
        buildLedger({
          id: "ledger-stock",
          dividendEventId: "event-stock",
          ticker: "2603",
          eventType: "STOCK",
          expectedCashAmount: 0,
          receivedCashAmount: 0,
          expectedStockQuantity: 50,
          receivedStockQuantity: 50,
        }),
        buildLedger({ id: "ledger-expected", dividendEventId: "event-expected", ticker: "1199", postingStatus: "expected", receivedCashAmount: 0, expectedCashAmount: 70 }),
      ],
    };

    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue(snapshot);
    vi.mocked(updateDividendReconciliation).mockResolvedValue(
      buildLedger({ id: "ledger-open", dividendEventId: "event-open", reconciliationStatus: "matched" }),
    );

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={snapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });

    await act(async () => {});

    expect(container.textContent).toContain("NT$");
    expect(container.textContent).toContain("2 open items.");
    expect(document.querySelector("[data-testid='dividends-action-queue']")?.textContent ?? "").toContain(dict.dividends.form.reconciliation.statusOpen);
    expect(document.querySelector("[data-testid='dividends-action-queue']")?.textContent ?? "").toContain(dict.dividends.badge.unposted);
    expect(document.querySelector("[data-testid='dividends-action-queue']")?.textContent ?? "").toContain(dict.dividends.action.postDividend);
    expect(document.querySelector("[data-testid='dividends-this-month']")?.textContent ?? "").toContain("2330");
    expect(document.querySelector("[data-testid='dividends-recent-receipts']")?.textContent ?? "").not.toContain("ledger-expected");
    expect(
      Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).some((link) => (
        link.href.includes("view=ledger") && link.href.includes("month=2026-04")
      )),
    ).toBe(true);

    const markMatchedButton = document.querySelector("[data-testid='dividend-mark-matched-event-open']") as HTMLButtonElement;
    await act(async () => {
      markMatchedButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updateDividendReconciliation).toHaveBeenCalledWith("ledger-open", "matched");
    expect(fetchDividendCalendarSnapshot).toHaveBeenCalledTimes(1);
  });

  it("renders reconciliation labels for matched and explained rows", async () => {
    const snapshot: DividendCalendarSnapshot = {
      events: [
        buildEvent({ id: "event-matched", ticker: "1111", hasPostedLedgerEntry: true, dividendLedgerEntryId: "ledger-matched" }),
        buildEvent({ id: "event-explained", ticker: "2222", hasPostedLedgerEntry: true, dividendLedgerEntryId: "ledger-explained" }),
      ],
      ledgerEntries: [
        buildLedger({ id: "ledger-matched", dividendEventId: "event-matched", ticker: "1111", reconciliationStatus: "matched" }),
        buildLedger({ id: "ledger-explained", dividendEventId: "event-explained", ticker: "2222", reconciliationStatus: "explained", receivedCashAmount: 90, expectedCashAmount: 100 }),
      ],
    };
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue(snapshot);

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={snapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });
    await act(async () => {});

    expect(container.textContent).toContain(dict.dividends.badge.matched);
    expect(container.textContent).toContain(dict.dividends.badge.explained);
  });

  it("changes the active month from the direct month picker and updates the URL state", async () => {
    const snapshot: DividendCalendarSnapshot = {
      events: [
        buildEvent({
          id: "event-eligible",
          ticker: "2330",
          expectedCashAmount: 54_000,
          hasPostedLedgerEntry: false,
        }),
      ],
      ledgerEntries: [],
    };
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue(snapshot);
    window.history.replaceState(null, "", "/dividends");

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={snapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });
    await act(async () => {});

    const nextMonthButton = document.querySelector("[aria-label='Next month']") as HTMLButtonElement;
    await act(async () => {
      nextMonthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(window.location.search).toContain("month=2026-05");
    expect(fetchDividendCalendarSnapshot).toHaveBeenCalledWith({
      fromPaymentDate: "2026-05-01",
      toPaymentDate: "2026-05-31",
      limit: 500,
    }, { signal: expect.any(AbortSignal) });
  });

  it("keeps the latest month snapshot when earlier requests resolve out of order", async () => {
    const initialSnapshot: DividendCalendarSnapshot = {
      events: [buildEvent({ id: "event-july", ticker: "JULY" })],
      ledgerEntries: [],
    };
    const juneSnapshot: DividendCalendarSnapshot = {
      events: [buildEvent({ id: "event-june", ticker: "JUNE", paymentDate: "2026-06-20", exDividendDate: "2026-06-10" })],
      ledgerEntries: [],
    };
    const maySnapshot: DividendCalendarSnapshot = {
      events: [buildEvent({ id: "event-may", ticker: "MAY", paymentDate: "2026-05-20", exDividendDate: "2026-05-10" })],
      ledgerEntries: [],
    };
    const juneRequest = createDeferred<DividendCalendarSnapshot>();
    const mayRequest = createDeferred<DividendCalendarSnapshot>();
    const onSnapshotChange = vi.fn();

    vi.mocked(fetchDividendCalendarSnapshot)
      .mockImplementationOnce(() => juneRequest.promise)
      .mockImplementationOnce(() => mayRequest.promise);

    act(() => {
      root.render(
        <DividendCalendarClient
          initialSnapshot={initialSnapshot}
          initialMonth="2026-07"
          dict={dict}
          locale="en"
          onSnapshotChange={onSnapshotChange}
        />,
      );
    });
    await act(async () => {});

    const previousMonthButton = document.querySelector("[aria-label='Previous month']") as HTMLButtonElement;
    await act(async () => {
      previousMonthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      previousMonthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      mayRequest.resolve(maySnapshot);
    });

    expect(window.location.search).toContain("month=2026-05");
    expect(container.textContent).toContain("MAY");
    expect(onSnapshotChange).toHaveBeenCalledWith(maySnapshot, "2026-05");

    await act(async () => {
      juneRequest.resolve(juneSnapshot);
    });

    expect(window.location.search).toContain("month=2026-05");
    expect(container.textContent).toContain("MAY");
    expect(container.textContent).not.toContain("JUNE");
    expect(onSnapshotChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[role='status']")).toBeNull();
  });

  it("refreshes when navigating back to the initial month after showing another month", async () => {
    const initialSnapshot: DividendCalendarSnapshot = {
      events: [buildEvent({ id: "event-july-initial", ticker: "JULY-INITIAL", paymentDate: "2026-07-20", exDividendDate: "2026-07-10" })],
      ledgerEntries: [],
    };
    const juneSnapshot: DividendCalendarSnapshot = {
      events: [buildEvent({ id: "event-june", ticker: "JUNE", paymentDate: "2026-06-20", exDividendDate: "2026-06-10" })],
      ledgerEntries: [],
    };
    const refreshedJulySnapshot: DividendCalendarSnapshot = {
      events: [buildEvent({ id: "event-july-refreshed", ticker: "JULY-REFRESHED", paymentDate: "2026-07-25", exDividendDate: "2026-07-15" })],
      ledgerEntries: [],
    };
    const onSnapshotChange = vi.fn();

    vi.mocked(fetchDividendCalendarSnapshot)
      .mockResolvedValueOnce(juneSnapshot)
      .mockResolvedValueOnce(refreshedJulySnapshot);

    act(() => {
      root.render(
        <DividendCalendarClient
          initialSnapshot={initialSnapshot}
          initialMonth="2026-07"
          dict={dict}
          locale="en"
          onSnapshotChange={onSnapshotChange}
        />,
      );
    });
    await act(async () => {});

    const previousMonthButton = document.querySelector("[aria-label='Previous month']") as HTMLButtonElement;
    const nextMonthButton = document.querySelector("[aria-label='Next month']") as HTMLButtonElement;

    await act(async () => {
      previousMonthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    expect(container.textContent).toContain("JUNE");
    expect(container.textContent).not.toContain("JULY-INITIAL");

    await act(async () => {
      nextMonthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    expect(fetchDividendCalendarSnapshot).toHaveBeenNthCalledWith(2, {
      fromPaymentDate: "2026-07-01",
      toPaymentDate: "2026-07-31",
      limit: 500,
    }, { signal: expect.any(AbortSignal) });
    expect(window.location.search).toContain("month=2026-07");
    expect(container.textContent).toContain("JULY-REFRESHED");
    expect(container.textContent).not.toContain("JUNE");
    expect(onSnapshotChange).toHaveBeenLastCalledWith(refreshedJulySnapshot, "2026-07");
  });

  it("aborts superseded requests, ignores AbortError, and preserves rapid July to April navigation", async () => {
    const initialSnapshot: DividendCalendarSnapshot = {
      events: [buildEvent({ id: "event-july", ticker: "JULY", paymentDate: "2026-07-20", exDividendDate: "2026-07-10" })],
      ledgerEntries: [],
    };
    const aprilSnapshot: DividendCalendarSnapshot = {
      events: [buildEvent({ id: "event-april", ticker: "APRIL", paymentDate: "2026-04-20", exDividendDate: "2026-04-10" })],
      ledgerEntries: [],
    };
    const juneRequest = createDeferred<DividendCalendarSnapshot>();
    const mayRequest = createDeferred<DividendCalendarSnapshot>();
    const aprilRequest = createDeferred<DividendCalendarSnapshot>();
    const capturedSignals: AbortSignal[] = [];
    const onSnapshotChange = vi.fn();

    vi.mocked(fetchDividendCalendarSnapshot).mockImplementation((_, options?: { signal?: AbortSignal }) => {
      const signal = options?.signal;
      if (!signal) {
        throw new Error("expected abort signal");
      }
      capturedSignals.push(signal);
      const deferred = [juneRequest, mayRequest, aprilRequest][capturedSignals.length - 1];
      signal.addEventListener("abort", () => {
        deferred.reject(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
      }, { once: true });
      return deferred.promise;
    });

    act(() => {
      root.render(
        <DividendCalendarClient
          initialSnapshot={initialSnapshot}
          initialMonth="2026-07"
          dict={dict}
          locale="en"
          onSnapshotChange={onSnapshotChange}
        />,
      );
    });
    await act(async () => {});

    const previousMonthButton = document.querySelector("[aria-label='Previous month']") as HTMLButtonElement;
    expect(previousMonthButton.disabled).toBe(false);

    await act(async () => {
      previousMonthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      previousMonthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      previousMonthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(previousMonthButton.disabled).toBe(false);
    expect(window.location.search).toContain("month=2026-04");
    expect(fetchDividendCalendarSnapshot).toHaveBeenNthCalledWith(1, {
      fromPaymentDate: "2026-06-01",
      toPaymentDate: "2026-06-30",
      limit: 500,
    }, { signal: expect.any(AbortSignal) });
    expect(fetchDividendCalendarSnapshot).toHaveBeenNthCalledWith(2, {
      fromPaymentDate: "2026-05-01",
      toPaymentDate: "2026-05-31",
      limit: 500,
    }, { signal: expect.any(AbortSignal) });
    expect(fetchDividendCalendarSnapshot).toHaveBeenNthCalledWith(3, {
      fromPaymentDate: "2026-04-01",
      toPaymentDate: "2026-04-30",
      limit: 500,
    }, { signal: expect.any(AbortSignal) });
    expect(capturedSignals[0]?.aborted).toBe(true);
    expect(capturedSignals[1]?.aborted).toBe(true);
    expect(capturedSignals[2]?.aborted).toBe(false);

    await act(async () => {
      aprilRequest.resolve(aprilSnapshot);
    });

    expect(window.location.search).toContain("month=2026-04");
    expect(container.textContent).toContain("APRIL");
    expect(container.textContent).not.toContain("Request aborted");
    expect(onSnapshotChange).toHaveBeenCalledTimes(1);
    expect(onSnapshotChange).toHaveBeenCalledWith(aprilSnapshot, "2026-04");
  });

  it("prompts before discarding unsaved changes when Cancel is clicked", async () => {
    const snapshot: DividendCalendarSnapshot = {
      events: [
        buildEvent({
          id: "event-dirty",
          ticker: "2330",
          eligibleQuantity: 1_000,
          expectedCashAmount: 100,
          hasPostedLedgerEntry: false,
        }),
      ],
      ledgerEntries: [],
    };
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue(snapshot);
    const confirmSpy = vi.spyOn(window, "confirm");

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={snapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });
    await act(async () => {});

    // Open the drawer.
    const postButton = document.querySelector("[data-testid='dividend-post-event-dirty']") as HTMLButtonElement;
    await act(async () => {
      postButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Dirty the form by adding an extra deduction row. Clicking Add Deduction
    // calls the setState setter directly, which React flushes inside act().
    // We avoid driving value changes through the input DOM because React's
    // internal value tracker ignores direct `.value` assignment in jsdom.
    const addDeductionButton = document.querySelector("[data-testid='dividend-add-deduction']") as HTMLButtonElement;
    await act(async () => {
      addDeductionButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Click Cancel — user declines the confirmation → drawer stays open.
    const cancelButton = document.querySelector("[data-testid='dividend-cancel']") as HTMLButtonElement;
    confirmSpy.mockReturnValueOnce(false);
    await act(async () => {
      cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(confirmSpy).toHaveBeenCalledWith(dict.dividends.form.unsavedChangesConfirm);
    expect(document.querySelector("[data-testid='dividend-posting-form']")).not.toBeNull();

    // Click Cancel again — user accepts → drawer closes.
    confirmSpy.mockReturnValueOnce(true);
    await act(async () => {
      cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector("[data-testid='dividend-posting-form']")).toBeNull();

    confirmSpy.mockRestore();
  });
});
