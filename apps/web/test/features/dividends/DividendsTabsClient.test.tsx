import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DividendsTabsClient } from "../../../components/dividends/DividendsTabsClient";
import { getDictionary } from "../../../lib/i18n";

vi.mock("../../../components/dividends/DividendCalendarClient", () => ({
  DividendCalendarClient: () => <div data-testid="mock-calendar-client">calendar</div>,
}));

vi.mock("../../../components/dividends/DividendReviewClient", () => ({
  DividendReviewClient: () => <div data-testid="mock-review-client">review</div>,
}));

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendCalendarSnapshot: vi.fn(),
  fetchDividendLedgerReview: vi.fn(),
  fetchDividendLedgerYears: vi.fn(),
}));

import {
  fetchDividendCalendarSnapshot,
  fetchDividendLedgerReview,
  fetchDividendLedgerYears,
} from "../../../features/dividends/services/dividendService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("DividendsTabsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.history.replaceState(null, "", "/dividends");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue({ events: [], ledgerEntries: [] });
    vi.mocked(fetchDividendLedgerReview).mockResolvedValue({
      ledgerEntries: [],
      total: 0,
      aggregates: {
        totalExpectedCashAmount: {},
        totalReceivedCashAmount: {},
        openCount: 0,
        byMonth: {},
        byTicker: {},
      },
    });
    vi.mocked(fetchDividendLedgerYears).mockResolvedValue([2026]);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("fetches only the active tab payload on first render", async () => {
    const dict = getDictionary("en");

    act(() => {
      root.render(
        <DividendsTabsClient
          initialTab="calendar"
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale="en"
          accounts={[]}
          initialCalendarSnapshot={{ events: [], ledgerEntries: [] }}
          initialReviewData={null}
          initialYears={[]}
        />,
      );
    });

    await act(async () => {});

    expect(fetchDividendCalendarSnapshot).not.toHaveBeenCalled();
    expect(fetchDividendLedgerReview).not.toHaveBeenCalled();
  });

  it("hydrates ledger data when ledger is the active entry route", async () => {
    const dict = getDictionary("en");

    window.history.replaceState(null, "", "/dividends?view=ledger");

    act(() => {
      root.render(
        <DividendsTabsClient
          initialTab="ledger"
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale="en"
          accounts={[]}
          initialCalendarSnapshot={null}
          initialReviewData={null}
          initialYears={[]}
        />,
      );
    });

    await act(async () => {});

    expect(fetchDividendLedgerReview).toHaveBeenCalledTimes(1);
    expect(fetchDividendLedgerYears).toHaveBeenCalledTimes(1);
    expect(fetchDividendCalendarSnapshot).not.toHaveBeenCalled();
  });
});
