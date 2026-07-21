import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DividendCalendarClient } from "../../../components/dividends/DividendCalendarClient";
import { getDictionary } from "../../../lib/i18n";
import type { DividendDailyHighlightsDto } from "@vakwen/shared-types";
import type { DividendCalendarSnapshot, DividendEventListItem, DividendLedgerEntryDetails } from "../../../features/dividends/types";

let capturedEventStreamConfig: { onEvent?: (event: unknown) => void } | null = null;
const shellContext = vi.hoisted(() => ({ value: null as null | {
  isSharedContext: boolean;
  sharedContextPermissions: { canWriteDividends: boolean };
  contextRefreshSignal: number;
  contextOwnerId: string | null;
  sessionUserId: string | null;
} }));

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendCalendarSnapshot: vi.fn(),
  fetchDividendDailyHighlights: vi.fn(),
  fetchDividendLedgerEntry: vi.fn(),
  submitDividendPosting: vi.fn(),
  updateDividendReconciliation: vi.fn(),
}));

vi.mock("../../../hooks/useEventStream", () => ({
  useEventStream: (config: { onEvent?: (event: unknown) => void }) => {
    capturedEventStreamConfig = config;
  },
}));

vi.mock("../../../components/layout/AppShellDataContext", () => ({
  useOptionalAppShellData: () => shellContext.value,
}));

import {
  fetchDividendCalendarSnapshot,
  fetchDividendDailyHighlights,
  fetchDividendLedgerEntry,
  submitDividendPosting,
  updateDividendReconciliation,
} from "../../../features/dividends/services/dividendService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");
const emptyDailyHighlights: DividendDailyHighlightsDto = {
  payingToday: [],
  exDividendToday: [],
};

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
    stockDistributionRatio: overrides.stockDistributionRatio ?? null,
    stockDistributionRatioState: overrides.stockDistributionRatioState ?? "unresolved",
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
    expectedStockCalcState: overrides.expectedStockCalcState ?? null,
    stockDistributionRatioState: overrides.stockDistributionRatioState ?? null,
    stockDistributionRatio: overrides.stockDistributionRatio ?? null,
    eligibleQuantity: overrides.eligibleQuantity ?? 1_000,
    sourceLines: overrides.sourceLines ?? [],
    deductions: overrides.deductions ?? [],
  };
}

function buildDailyHighlight(overrides: Partial<DividendDailyHighlightsDto["payingToday"][number]>): DividendDailyHighlightsDto["payingToday"][number] {
  return {
    id: overrides.id ?? "daily-1",
    accountId: overrides.accountId ?? "acc-1",
    accountName: overrides.accountName ?? "Main",
    ticker: overrides.ticker ?? "2330",
    tickerName: overrides.tickerName ?? "Ticker",
    marketCode: overrides.marketCode ?? "TW",
    instrumentType: overrides.instrumentType ?? "STOCK",
    eventType: overrides.eventType ?? "CASH",
    exDividendDate: overrides.exDividendDate ?? "2026-04-10",
    paymentDate: overrides.paymentDate ?? "2026-04-20",
    cashDividendCurrency: overrides.cashDividendCurrency ?? "TWD",
    expectedCashAmount: overrides.expectedCashAmount ?? 100,
    expectedStockQuantity: overrides.expectedStockQuantity ?? 0,
    eligibleQuantity: overrides.eligibleQuantity ?? 100,
    hasPostedLedgerEntry: overrides.hasPostedLedgerEntry ?? false,
    dividendLedgerEntryId: overrides.dividendLedgerEntryId ?? null,
    applicableLocalDate: overrides.applicableLocalDate ?? "2026-04-20",
  };
}

describe("DividendCalendarClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    capturedEventStreamConfig = null;
    shellContext.value = null;
    vi.mocked(fetchDividendDailyHighlights).mockResolvedValue(emptyDailyHighlights);
    vi.mocked(fetchDividendLedgerEntry).mockImplementation(async (id) => buildLedger({ id }) as never);
    vi.mocked(submitDividendPosting).mockResolvedValue({
      dividendLedgerEntry: {
        id: "ledger-posted",
        accountId: "acc-1",
        dividendEventId: "event-1",
        version: 1,
        reconciliationStatus: "open",
        sourceCompositionStatus: "unknown_pending_disclosure",
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(fetchDividendCalendarSnapshot).mockReset();
    vi.mocked(fetchDividendDailyHighlights).mockReset();
    vi.mocked(fetchDividendLedgerEntry).mockReset();
    vi.mocked(submitDividendPosting).mockReset();
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

  it("renders server-provided daily highlights on the first render without a false empty state", async () => {
    const snapshot: DividendCalendarSnapshot = { events: [], ledgerEntries: [] };
    const highlights: DividendDailyHighlightsDto = {
      payingToday: [buildDailyHighlight({ ticker: "4952", tickerName: "Ling Yue" })],
      exDividendToday: [buildDailyHighlight({ id: "daily-2", ticker: "0056", tickerName: "Yuanta High Dividend" })],
    };

    act(() => {
      root.render(
        <DividendCalendarClient
          initialSnapshot={snapshot}
          initialMonth="2026-04"
          initialDailyHighlights={{
            payingToday: { status: "success", data: highlights.payingToday, error: "" },
            exDividendToday: { status: "success", data: highlights.exDividendToday, error: "" },
          }}
          dict={dict}
          locale="en"
        />,
      );
    });

    expect(document.querySelector("[data-testid='dividends-paying-today']")?.textContent).toContain("4952 Ling Yue");
    expect(document.querySelector("[data-testid='dividends-paying-today']")?.textContent).not.toContain(dict.dividends.overview.noPayingToday);
    expect(document.querySelector("[data-testid='dividends-ex-dividend-today']")?.textContent).toContain("0056 Yuanta High Dividend");
    expect(fetchDividendDailyHighlights).not.toHaveBeenCalled();
  });

  it("isolates a Paying Today failure and retry without replacing or remounting the Ex-dividend Today card", async () => {
    const snapshot: DividendCalendarSnapshot = { events: [], ledgerEntries: [] };
    const payingToday = buildDailyHighlight({ ticker: "4952", tickerName: "Ling Yue" });
    const exDividendToday = buildDailyHighlight({ id: "daily-2", ticker: "0056", tickerName: "Yuanta High Dividend" });
    const retry = createDeferred<DividendDailyHighlightsDto>();
    vi.mocked(fetchDividendDailyHighlights).mockImplementationOnce(() => retry.promise);

    act(() => {
      root.render(
        <DividendCalendarClient
          initialSnapshot={snapshot}
          initialMonth="2026-04"
          initialDailyHighlights={{
            payingToday: { status: "error", data: [payingToday], error: "daily read failed" },
            exDividendToday: { status: "success", data: [exDividendToday], error: "" },
          }}
          dict={dict}
          locale="en"
        />,
      );
    });
    await act(async () => {});

    const calendarPage = document.querySelector("[data-testid='dividends-calendar-page']");
    expect(document.querySelector("[data-testid='dividends-paying-today']")?.textContent).toContain("4952 Ling Yue");
    expect(document.querySelector("[data-testid='paying-today-error']")).not.toBeNull();
    expect(document.querySelector("[data-testid='ex-dividend-today-error']")).toBeNull();
    expect(document.querySelector("[data-testid='dividends-ex-dividend-today']")?.textContent).toContain("0056 Yuanta High Dividend");

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='paying-today-retry']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector("[data-testid='dividends-paying-today']")?.textContent).toContain("4952 Ling Yue");
    expect(document.querySelector("[data-testid='paying-today-refreshing']")).not.toBeNull();
    expect(document.querySelector("[data-testid='ex-dividend-today-refreshing']")).toBeNull();
    expect(document.querySelector("[data-testid='dividends-ex-dividend-today']")?.textContent).toContain("0056 Yuanta High Dividend");

    await act(async () => {
      retry.resolve({
        payingToday: [buildDailyHighlight({ ticker: "2886", tickerName: "Mega Financial" })],
        exDividendToday: [buildDailyHighlight({ id: "daily-3", ticker: "3714", tickerName: "Must Not Replace Sibling" })],
      });
    });

    expect(document.querySelector("[data-testid='dividends-paying-today']")?.textContent).toContain("2886 Mega Financial");
    expect(document.querySelector("[data-testid='paying-today-error']")).toBeNull();
    expect(document.querySelector("[data-testid='dividends-ex-dividend-today']")?.textContent).toContain("0056 Yuanta High Dividend");
    expect(document.querySelector("[data-testid='dividends-ex-dividend-today']")?.textContent).not.toContain("3714");
    expect(document.querySelector("[data-testid='dividends-calendar-page']")).toBe(calendarPage);
    expect(fetchDividendCalendarSnapshot).not.toHaveBeenCalled();
  });

  it("renders unresolved expected stock as unavailable and keeps a received 150-share fact", async () => {
    const snapshot: DividendCalendarSnapshot = {
      events: [buildEvent({
        id: "event-2886",
        ticker: "2886",
        eventType: "STOCK",
        expectedCashAmount: 0,
        expectedStockQuantity: 0,
        stockDistributionRatioState: "unresolved",
        hasPostedLedgerEntry: true,
        dividendLedgerEntryId: "ledger-2886",
      })],
      ledgerEntries: [buildLedger({
        id: "ledger-2886",
        dividendEventId: "event-2886",
        ticker: "2886",
        eventType: "STOCK",
        expectedCashAmount: 0,
        receivedCashAmount: 0,
        expectedStockQuantity: 0,
        receivedStockQuantity: 150,
        expectedStockCalcState: "needs_action",
        stockDistributionRatioState: "unresolved",
      })],
    };
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue(snapshot);

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={snapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });
    await act(async () => {});

    const eventRow = document.querySelector("[data-testid='dividend-row-event-2886']");
    const receiptRow = document.querySelector("[data-testid='dividend-receipt-ledger-2886']");
    expect(eventRow?.textContent).toContain("Expected stock: —");
    expect(receiptRow?.textContent).toContain("Received stock: 150 shares");
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
    expect(container.textContent).toContain("3 open items.");
    expect(document.querySelector("[data-testid='dividends-action-queue']")?.textContent ?? "").toContain(dict.dividends.form.reconciliation.statusOpen);
    expect(document.querySelector("[data-testid='dividends-action-queue']")?.textContent ?? "").toContain(dict.dividends.badge.unposted);
    expect(document.querySelector("[data-testid='dividends-action-queue']")?.textContent ?? "").toContain(dict.dividends.action.postDividend);
    expect(document.querySelector("[data-testid='dividends-this-month']")?.textContent ?? "").toContain("2330");
    expect(document.querySelector("[data-testid='dividend-post-event-expected']")?.textContent).toBe(dict.dividends.action.postDividend);
    expect(document.querySelector("[data-testid='dividend-edit-event-expected']")).toBeNull();
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
    expect(vi.mocked(fetchDividendCalendarSnapshot).mock.calls).toContainEqual([
      expect.objectContaining({
        fromPaymentDate: "2026-04-01",
        toPaymentDate: "2026-04-30",
        limit: 500,
      }),
      { signal: expect.any(AbortSignal) },
    ]);
  });

  it("uses the same desktop five-column grid for the This Month header and rows", async () => {
    const snapshot: DividendCalendarSnapshot = {
      events: [buildEvent({ id: "aligned-event" })],
      ledgerEntries: [],
    };

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={snapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });
    await act(async () => {});

    const header = document.querySelector("[data-testid='dividends-this-month-grid-header']");
    const row = document.querySelector("[data-testid='dividend-row-aligned-event']");
    const headerGrid = Array.from(header?.classList ?? []).find((name) => name.startsWith("xl:grid-cols-"));
    const rowGrid = Array.from(row?.classList ?? []).find((name) => name.startsWith("xl:grid-cols-"));

    expect(header).not.toBeNull();
    expect(rowGrid).toBe(headerGrid);
    expect(rowGrid).toContain("minmax(220px,1.5fr)");
  });

  it("refreshes Needs Action, This Month, totals, and receipts after posting an expected row", async () => {
    const event = buildEvent({ id: "event-expected", ticker: "2886", expectedCashAmount: 300 });
    const initialSnapshot: DividendCalendarSnapshot = {
      events: [event],
      ledgerEntries: [buildLedger({
        id: "expected:acc-1:event-expected",
        dividendEventId: event.id,
        ticker: event.ticker,
        postingStatus: "expected",
        expectedCashAmount: 300,
        receivedCashAmount: 0,
      })],
    };
    const postedLedger = buildLedger({
      id: "ledger-posted",
      dividendEventId: event.id,
      ticker: event.ticker,
      postingStatus: "posted",
      expectedCashAmount: 300,
      receivedCashAmount: 290,
      reconciliationStatus: "matched",
    });
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue({ events: [event], ledgerEntries: [postedLedger] });

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={initialSnapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });
    await act(async () => {});

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='dividend-post-event-expected']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='dividend-save']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(submitDividendPosting).toHaveBeenCalledWith(
      expect.objectContaining({ dividendEventId: "event-expected", accountId: "acc-1", receivedCashAmount: 300 }),
    );
    expect(document.querySelector("[data-testid='dividends-needs-action']")?.textContent).toContain(dict.dividends.overview.noActionItems);
    expect(document.querySelector("[data-testid='dividend-edit-event-expected']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividends-recent-receipts']")?.textContent).toContain("2886");
    expect(document.querySelector("[data-testid='dividends-recent-receipts']")?.textContent).toContain("NT$290");
  });

  it("hides dividend write actions in a shared read-only context", async () => {
    const snapshot: DividendCalendarSnapshot = {
      events: [
        buildEvent({ id: "event-open", hasPostedLedgerEntry: true, dividendLedgerEntryId: "ledger-open" }),
        buildEvent({ id: "event-unposted", ticker: "2317" }),
      ],
      ledgerEntries: [
        buildLedger({ id: "ledger-open", dividendEventId: "event-open", reconciliationStatus: "open" }),
      ],
    };
    shellContext.value = {
      isSharedContext: true,
      sharedContextPermissions: { canWriteDividends: false },
      contextRefreshSignal: 0,
      contextOwnerId: "owner-1",
      sessionUserId: "viewer-1",
    };
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue(snapshot);

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={snapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });
    await act(async () => {});

    expect(container.querySelector("[data-testid='dividend-mark-matched-event-open']")).toBeNull();
    expect(container.querySelector("[data-testid='dividend-edit-event-open']")).toBeNull();
    expect(container.querySelector("[data-testid='dividend-post-event-unposted']")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("[data-testid='dividend-receipt-ledger-open']")?.disabled).toBe(true);
    expect(container.textContent).toContain(dict.dividends.overview.openReview);
  });

  it("keeps stock calculation details inspectable in a shared read-only context", async () => {
    const snapshot: DividendCalendarSnapshot = {
      events: [
        buildEvent({
          id: "event-stock",
          eventType: "STOCK",
          hasPostedLedgerEntry: true,
          dividendLedgerEntryId: "ledger-stock",
        }),
      ],
      ledgerEntries: [
        buildLedger({
          id: "ledger-stock",
          dividendEventId: "event-stock",
          eventType: "STOCK",
          reconciliationStatus: "open",
        }),
      ],
    };
    shellContext.value = {
      isSharedContext: true,
      sharedContextPermissions: { canWriteDividends: false },
      contextRefreshSignal: 0,
      contextOwnerId: "owner-1",
      sessionUserId: "viewer-1",
    };
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue(snapshot);

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={snapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });
    await act(async () => {});

    const detailsButton = container.querySelector<HTMLButtonElement>("[data-testid='dividend-view-details-event-stock']");
    expect(detailsButton?.textContent).toContain(dict.dividends.action.viewDetails);
    expect(container.querySelector("[data-testid='dividend-edit-event-stock']")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("[data-testid='dividend-receipt-ledger-stock']")?.disabled).toBe(false);
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

  it("keeps daily highlights independent from month navigation", async () => {
    const initialSnapshot: DividendCalendarSnapshot = {
      events: [buildEvent({ id: "month-event", ticker: "MONTH", paymentDate: "2026-04-20", exDividendDate: "2026-04-10" })],
      ledgerEntries: [],
    };
    const maySnapshot: DividendCalendarSnapshot = {
      events: [buildEvent({ id: "month-event-may", ticker: "MAY", paymentDate: "2026-05-20", exDividendDate: "2026-05-10" })],
      ledgerEntries: [],
    };
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValueOnce(maySnapshot);
    vi.mocked(fetchDividendDailyHighlights).mockResolvedValue({
      payingToday: [
        buildDailyHighlight({
          id: "paying-today",
          ticker: "2330",
          tickerName: "TSMC",
          marketCode: "TW",
          exDividendDate: "2026-06-12",
          paymentDate: "2026-07-10",
          eligibleQuantity: 1_000,
          applicableLocalDate: "2026-07-10",
        }),
      ],
      exDividendToday: [
        buildDailyHighlight({
          id: "ex-today",
          ticker: "AAPL",
          tickerName: "Apple",
          marketCode: "US",
          paymentDate: "2026-08-14",
          cashDividendCurrency: "USD",
          expectedCashAmount: 5,
          eligibleQuantity: 10,
          exDividendDate: "2026-07-10",
          applicableLocalDate: "2026-07-10",
        }),
      ],
    });

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={initialSnapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });

    await act(async () => {});

    expect(fetchDividendDailyHighlights).toHaveBeenCalledTimes(1);

    expect(document.querySelector("[data-testid='dividends-paying-today']")?.textContent ?? "").toContain("2330");
    expect(document.querySelector("[data-testid='dividends-paying-today']")?.textContent ?? "").toContain("TW");
    expect(document.querySelector("[data-testid='dividends-ex-dividend-today']")?.textContent ?? "").toContain("AAPL");
    expect(document.querySelector("[data-testid='dividends-ex-dividend-today']")?.textContent ?? "").toContain("US");
    expect(document.querySelector("[data-testid='dividends-this-month']")?.textContent ?? "").toContain("MONTH");

    const nextMonthButton = document.querySelector("[aria-label='Next month']") as HTMLButtonElement;
    await act(async () => {
      nextMonthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    expect(fetchDividendDailyHighlights).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-testid='dividends-paying-today']")?.textContent ?? "").toContain("2330");
    expect(document.querySelector("[data-testid='dividends-ex-dividend-today']")?.textContent ?? "").toContain("AAPL");
    expect(window.location.search).toContain("month=2026-05");
    expect(document.querySelector("[data-testid='dividends-this-month']")?.textContent ?? "").toContain("MAY");
  });

  it("refreshes daily highlights once per SSE refresh and keeps drawer state in place", async () => {
    const initialSnapshot: DividendCalendarSnapshot = {
      events: [
        buildEvent({
          id: "event-open",
          ticker: "2330",
          eventType: "CASH_AND_STOCK",
          expectedStockQuantity: 12,
          hasPostedLedgerEntry: true,
          dividendLedgerEntryId: "ledger-open",
        }),
      ],
      ledgerEntries: [
        buildLedger({
          id: "ledger-open",
          dividendEventId: "event-open",
          ticker: "2330",
          eventType: "CASH_AND_STOCK",
          expectedStockQuantity: 12,
          reconciliationStatus: "open",
        }),
      ],
    };
    const refreshedSnapshot: DividendCalendarSnapshot = {
      events: [
        buildEvent({
          id: "event-open",
          ticker: "2330",
          eventType: "CASH_AND_STOCK",
          expectedStockQuantity: 12,
          hasPostedLedgerEntry: true,
          dividendLedgerEntryId: "ledger-open",
        }),
      ],
      ledgerEntries: [
        buildLedger({
          id: "ledger-open",
          dividendEventId: "event-open",
          ticker: "2330",
          eventType: "CASH_AND_STOCK",
          expectedStockQuantity: 12,
          reconciliationStatus: "matched",
        }),
      ],
    };
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValueOnce(refreshedSnapshot);
    vi.mocked(fetchDividendDailyHighlights)
      .mockResolvedValueOnce(emptyDailyHighlights)
      .mockResolvedValueOnce({
        payingToday: [
          buildDailyHighlight({
            id: "daily-1",
            ticker: "0050",
            tickerName: null,
            marketCode: "TW",
            instrumentType: "ETF",
            expectedCashAmount: 10,
            applicableLocalDate: "2026-04-20",
          }),
        ],
        exDividendToday: [],
      });
    vi.mocked(fetchDividendLedgerEntry).mockResolvedValueOnce({
      ...initialSnapshot.ledgerEntries[0],
      calculationHistory: [
        {
          id: "calc-history-2",
          calculationVersion: 2,
          status: "amended",
          method: "custom_ratio",
          expectedWholeShares: 12,
          confirmedAt: "2026-07-17T04:00:00.000Z",
          priorCalculationId: "calc-history-1",
        },
      ],
    } as never);

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={initialSnapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });
    await act(async () => {});

    const openButton = document.querySelector("[data-testid='dividend-edit-event-open']") as HTMLButtonElement;
    await act(async () => {
      openButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector("[data-testid='dividend-posting-form']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividend-calculation-history-version-2']")).not.toBeNull();
    expect(capturedEventStreamConfig?.onEvent).toBeTypeOf("function");

    await act(async () => {
      capturedEventStreamConfig?.onEvent?.({ type: "dividend_updated" });
    });
    await act(async () => {});

    expect(fetchDividendDailyHighlights).toHaveBeenCalledTimes(2);
    expect(fetchDividendCalendarSnapshot).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-testid='dividend-posting-form']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividends-paying-today']")?.textContent ?? "").toContain("0050");
  });

  it("keeps one needs-action card with only the top three rows and a filtered review link", async () => {
    const snapshot: DividendCalendarSnapshot = {
      events: [
        buildEvent({ id: "action-1", ticker: "1111", paymentDate: "2026-04-11", hasPostedLedgerEntry: false }),
        buildEvent({ id: "action-2", ticker: "2222", paymentDate: "2026-04-12", hasPostedLedgerEntry: false }),
        buildEvent({ id: "action-3", ticker: "3333", paymentDate: "2026-04-13", hasPostedLedgerEntry: false }),
        buildEvent({ id: "action-4", ticker: "4444", paymentDate: "2026-04-14", hasPostedLedgerEntry: false }),
      ],
      ledgerEntries: [],
    };
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue({ events: [], ledgerEntries: [] });

    act(() => {
      root.render(<DividendCalendarClient initialSnapshot={snapshot} initialMonth="2026-04" dict={dict} locale="en" />);
    });

    await act(async () => {});

    const actionCard = document.querySelector("[data-testid='dividends-needs-action']");
    expect(actionCard).not.toBeNull();
    expect(actionCard?.textContent).toContain("1111");
    expect(actionCard?.textContent).toContain("2222");
    expect(actionCard?.textContent).toContain("3333");
    expect(actionCard?.textContent).not.toContain("4444");

    const viewAllLink = document.querySelector<HTMLAnchorElement>("[data-testid='dividends-needs-action-view-all']");
    expect(viewAllLink?.getAttribute("href")).toContain("view=ledger");
    expect(viewAllLink?.getAttribute("href")).toContain("status=needsReconciliation");
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

    vi.mocked(fetchDividendCalendarSnapshot)
      .mockImplementation((_, options?: { signal?: AbortSignal }) => {
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
