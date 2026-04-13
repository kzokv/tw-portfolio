import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CashLedgerClient } from "../../../features/cash-ledger/components/CashLedgerClient";
import { getDictionary } from "../../../lib/i18n";
import type {
  CashLedgerListResponse,
  EnrichedCashLedgerEntry,
} from "../../../features/cash-ledger/types";

vi.mock("../../../features/cash-ledger/services/cashLedgerService", () => ({
  fetchCashLedgerEntries: vi.fn(),
}));

vi.mock("../../../hooks/useEventStream", () => ({
  useEventStream: () => undefined,
}));

import { fetchCashLedgerEntries } from "../../../features/cash-ledger/services/cashLedgerService";

const mockFetch = vi.mocked(fetchCashLedgerEntries);

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function buildEntry(overrides: Partial<EnrichedCashLedgerEntry> = {}): EnrichedCashLedgerEntry {
  return {
    id: overrides.id ?? "entry-1",
    userId: overrides.userId ?? "user-1",
    accountId: overrides.accountId ?? "acc-1",
    entryDate: overrides.entryDate ?? "2026-04-10",
    entryType: overrides.entryType ?? "TRADE_SETTLEMENT_IN",
    amount: overrides.amount ?? 1000,
    currency: overrides.currency ?? "TWD",
    source: overrides.source ?? "trade",
    ticker: overrides.ticker ?? "2330",
    side: overrides.side ?? "BUY",
    ...overrides,
  };
}

function buildResponse(total: number, count: number): CashLedgerListResponse {
  const entries: EnrichedCashLedgerEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push(buildEntry({ id: `entry-${i + 1}` }));
  }
  return { entries, summary: [], total };
}

describe("CashLedgerClient pagination", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockFetch.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders pagination when total exceeds PAGE_SIZE", () => {
    const data = buildResponse(100, 50);
    act(() => root.render(<CashLedgerClient initialData={data} dict={dict} locale="en" />));

    const pagination = container.querySelector('[data-testid="pagination"]');
    expect(pagination).toBeTruthy();
    expect(pagination!.textContent).toContain("Page");
    expect(pagination!.textContent).toContain("1");
    expect(pagination!.textContent).toContain("of");
    expect(pagination!.textContent).toContain("2");
  });

  it("does not render pagination when total fits in one page", () => {
    const data = buildResponse(10, 10);
    act(() => root.render(<CashLedgerClient initialData={data} dict={dict} locale="en" />));

    const pagination = container.querySelector('[data-testid="pagination"]');
    expect(pagination).toBeNull();
  });

  it("disables prev button on page 1", () => {
    const data = buildResponse(100, 50);
    act(() => root.render(<CashLedgerClient initialData={data} dict={dict} locale="en" />));

    const prevBtn = container.querySelector('[data-testid="pagination-prev"]') as HTMLButtonElement;
    expect(prevBtn).toBeTruthy();
    expect(prevBtn.disabled).toBe(true);
  });

  it("enables next button when not on last page", () => {
    const data = buildResponse(100, 50);
    act(() => root.render(<CashLedgerClient initialData={data} dict={dict} locale="en" />));

    const nextBtn = container.querySelector('[data-testid="pagination-next"]') as HTMLButtonElement;
    expect(nextBtn).toBeTruthy();
    expect(nextBtn.disabled).toBe(false);
  });

  it("calls service with page when next is clicked", async () => {
    mockFetch.mockResolvedValue(buildResponse(100, 50));
    const data = buildResponse(100, 50);
    act(() => root.render(<CashLedgerClient initialData={data} dict={dict} locale="en" />));

    const nextBtn = container.querySelector('[data-testid="pagination-next"]') as HTMLButtonElement;
    await act(async () => nextBtn.click());

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });

  it("renders sortable column headers with sort indicators", () => {
    const data = buildResponse(5, 5);
    act(() => root.render(<CashLedgerClient initialData={data} dict={dict} locale="en" />));

    // entryDate is the default sort column
    const headers = container.querySelectorAll("th");
    const dateHeader = Array.from(headers).find((th) => th.textContent?.includes("Date"));
    expect(dateHeader).toBeTruthy();
    // Default sort is entryDate desc, so it should show the down indicator
    expect(dateHeader!.textContent).toContain("\u2193");
  });

  it("toggles sort direction on clicking active column header", async () => {
    mockFetch.mockResolvedValue(buildResponse(5, 5));
    const data = buildResponse(5, 5);
    act(() => root.render(<CashLedgerClient initialData={data} dict={dict} locale="en" />));

    // Click the Date header (already active with desc) to toggle to asc
    const headers = container.querySelectorAll("th");
    const dateHeader = Array.from(headers).find((th) => th.textContent?.includes("Date"));
    await act(async () => dateHeader!.click());

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "entryDate", sortOrder: "asc" }),
    );
  });

  it("sets new column and desc when clicking a different column header", async () => {
    mockFetch.mockResolvedValue(buildResponse(5, 5));
    const data = buildResponse(5, 5);
    act(() => root.render(<CashLedgerClient initialData={data} dict={dict} locale="en" />));

    // Click the Amount header (not active)
    const headers = container.querySelectorAll("th");
    const amountHeader = Array.from(headers).find((th) => th.textContent?.includes("Amount"));
    await act(async () => amountHeader!.click());

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "amount", sortOrder: "desc" }),
    );
  });

  it("resets page to 1 when filter changes trigger refresh", async () => {
    mockFetch.mockResolvedValue(buildResponse(100, 50));
    const data = buildResponse(100, 50);
    act(() => root.render(<CashLedgerClient initialData={data} dict={dict} locale="en" />));

    // Navigate to page 2 first
    const nextBtn = container.querySelector('[data-testid="pagination-next"]') as HTMLButtonElement;
    await act(async () => nextBtn.click());

    // Toggle an entry-type chip — triggers fetch immediately with page reset to 1
    const chip = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="cash-ledger-filter-toolbar"] button'))
      .find((b) => b.textContent?.includes("Reversal"));
    await act(async () => chip!.click());

    // The most recent call should have page: 1
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]![0];
    expect(lastCall).toEqual(expect.objectContaining({ page: 1 }));
  });
});
