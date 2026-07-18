import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DividendReviewRowSummaryDto } from "@vakwen/shared-types";
import {
  DividendReviewDrawer,
  clearDividendReviewDrawerDetailCache,
  primeDividendReviewDrawerDetailCache,
} from "../../../components/dividends/DividendReviewDrawer";
import { getDictionary } from "../../../lib/i18n";

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendLedgerEntry: vi.fn(),
  updateDividendStockReconciliation: vi.fn(),
}));

vi.mock("../../../components/dividends/DividendPostingForm", () => ({
  DividendPostingForm: () => <div data-testid="posting-form" />,
}));

import { fetchDividendLedgerEntry, updateDividendStockReconciliation } from "../../../features/dividends/services/dividendService";

const dict = getDictionary("en");
const row: DividendReviewRowSummaryDto = {
  rowKind: "ledger", id: "ledger-1", version: 3, accountId: "acc-1", dividendEventId: "event-1",
  ticker: "2330", tickerName: "TSMC", marketCode: "TW", instrumentType: "STOCK", eventType: "CASH",
  exDividendDate: "2026-06-01", paymentDate: "2026-07-01", cashCurrency: "TWD", eligibleQuantity: 10,
  expectedCashAmount: 100, receivedCashAmount: 90, expectedStockQuantity: 0, receivedStockQuantity: 0,
  postingStatus: "posted", cashReconciliationStatus: "open", stockReconciliationStatus: null,
  reconciliationStatus: "open", sourceCompositionStatus: "provided",
};

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("DividendReviewDrawer lazy detail", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    clearDividendReviewDrawerDetailCache();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(entry: DividendReviewRowSummaryDto | null, allowMutations = true) {
    root.render(
      <DividendReviewDrawer
        entry={entry}
        cacheScope="session:a:context:self"
        dict={dict}
        locale="en"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        allowMutations={allowMutations}
      />,
    );
  }

  it("opens expected rows immediately without a detail request", async () => {
    act(() => render({ ...row, rowKind: "expected", id: "expected:1", postingStatus: "expected", version: 0 }));
    await act(async () => {});

    expect(fetchDividendLedgerEntry).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid='posting-form']")).not.toBeNull();
    expect(document.querySelector("[data-testid='review-drawer-loading']")).toBeNull();
    const guidance = document.querySelector("[data-testid='dividend-removal-guidance']");
    expect(guidance?.textContent).toContain("underlying transaction");
    expect(guidance?.querySelector("a")?.getAttribute("href")).toBe(
      "/tickers/2330?marketCode=TW&accountId=acc-1&tab=transactions",
    );
    expect(guidance?.querySelector("button")).toBeNull();
  });

  it("guides posted rows through amendment or reversal without offering direct deletion", async () => {
    vi.mocked(fetchDividendLedgerEntry).mockResolvedValue({ ...row, deductions: [], sourceLines: [] } as never);
    act(() => render(row));
    await act(async () => {});

    const guidance = document.querySelector("[data-testid='dividend-removal-guidance']");
    expect(guidance?.textContent).toContain("amendment or a reversal and replacement");
    expect(guidance?.textContent).not.toContain("Delete dividend");
  });

  it("shows unresolved expected stock as unavailable while retaining a factual 150-share receipt", async () => {
    const stockRow: DividendReviewRowSummaryDto = {
      ...row,
      ticker: "2886",
      eventType: "STOCK",
      expectedStockQuantity: 0,
      receivedStockQuantity: 150,
      expectedStockCalcState: "needs_action",
      stockDistributionRatioState: "unresolved",
    };
    vi.mocked(fetchDividendLedgerEntry).mockResolvedValue({
      ...stockRow,
      deductions: [],
      sourceLines: [],
    } as never);

    act(() => render(stockRow));
    await act(async () => {});

    expect(document.querySelector("[data-testid='review-drawer-stock-details']")).not.toBeNull();
    expect(document.querySelector("[data-testid='review-drawer-expected-stock']")?.textContent).toContain("—");
    expect(document.querySelector("[data-testid='review-drawer-received-stock']")?.textContent).toContain("150");
  });

  it("shows an unresolved raw stock provider value to read-only reviewers", async () => {
    const stockRow: DividendReviewRowSummaryDto = {
      ...row,
      eventType: "STOCK",
      expectedStockQuantity: 150,
      receivedStockQuantity: 150,
      stockDistributionRatioState: "authoritative",
    };
    vi.mocked(fetchDividendLedgerEntry).mockResolvedValue({
      ...stockRow,
      provider: {
        value: "0.25",
        unit: "UNKNOWN",
        source: "finmind",
        dataset: null,
        authoritativeRatio: null,
      },
      deductions: [],
      sourceLines: [],
    } as never);

    act(() => render(stockRow, false));
    await act(async () => {});

    expect(document.querySelector("[data-testid='posting-form']")).toBeNull();
    expect(document.querySelector("[data-testid='dividend-calculation-provider']")?.textContent).toContain("0.25");
    expect(document.querySelector("[data-testid='dividend-calculation-provider']")?.textContent).toContain("UNKNOWN");
    expect(document.querySelector("[data-testid='dividend-calculation-provider']")?.textContent).toContain("finmind");
    expect(document.querySelector("[data-testid='dividend-calculation-preview']")).toBeNull();
  });

  it("shows provider provenance for an expected-only read row without a ledger detail request", async () => {
    const expectedStockRow: DividendReviewRowSummaryDto = {
      ...row,
      rowKind: "expected",
      id: "expected:acc-1:event-1",
      version: 0,
      eventType: "STOCK",
      postingStatus: "expected",
      expectedStockQuantity: null,
      expectedStockCalcState: "needs_action",
      stockDistributionRatioState: "unresolved",
      provider: {
        value: "1",
        unit: "TWD_PER_SHARE",
        source: "finmind",
        dataset: "TaiwanStockDividend",
        authoritativeRatio: null,
      },
    };

    act(() => render(expectedStockRow, false));
    await act(async () => {});

    expect(fetchDividendLedgerEntry).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid='dividend-calculation-provider']")?.textContent).toContain("1");
    expect(document.querySelector("[data-testid='dividend-calculation-provider']")?.textContent).toContain("TWD_PER_SHARE");
    expect(document.querySelector("[data-testid='dividend-calculation-provider']")?.textContent).toContain("finmind");
  });

  it("validates and saves a stock reconciliation explanation with optimistic versioning", async () => {
    const stockRow: DividendReviewRowSummaryDto = {
      ...row,
      eventType: "STOCK",
      stockReconciliationStatus: "variance",
      expectedStockQuantity: 100,
      receivedStockQuantity: 150,
    };
    const detail = { ...stockRow, stockReconciliationNote: null, deductions: [], sourceLines: [] };
    const updated = { ...detail, version: 4, stockReconciliationStatus: "explained" as const, stockReconciliationNote: "Broker confirmed the variance." };
    const onSaved = vi.fn();
    vi.mocked(fetchDividendLedgerEntry).mockResolvedValue(detail as never);
    vi.mocked(updateDividendStockReconciliation).mockResolvedValue(updated as never);

    act(() => {
      root.render(
        <DividendReviewDrawer entry={stockRow} cacheScope="session:a:context:self" dict={dict} locale="en" onClose={vi.fn()} onSaved={onSaved} />,
      );
    });
    await act(async () => {});

    const status = document.querySelector<HTMLSelectElement>("[data-testid='stock-reconciliation-status']")!;
    await act(async () => {
      status.value = "explained";
      status.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector<HTMLButtonElement>("[data-testid='stock-reconciliation-save']")?.click();
    });
    expect(document.querySelector("[role='alert']")?.textContent).toContain("required");
    expect(updateDividendStockReconciliation).not.toHaveBeenCalled();

    const note = document.querySelector<HTMLTextAreaElement>("[data-testid='stock-reconciliation-note']")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(note, "Broker confirmed the variance.");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='stock-reconciliation-save']")?.click();
    });

    expect(updateDividendStockReconciliation).toHaveBeenCalledWith("ledger-1", {
      status: "explained",
      note: "Broker confirmed the variance.",
      expectedVersion: 3,
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[role='status']")?.textContent).toContain("saved");
  });

  it("sends an explicit null note when clearing an existing stock reconciliation explanation", async () => {
    const stockRow: DividendReviewRowSummaryDto = {
      ...row,
      eventType: "STOCK",
      stockReconciliationStatus: "variance",
      expectedStockQuantity: 100,
      receivedStockQuantity: 150,
    };
    const detail = {
      ...stockRow,
      stockReconciliationNote: "Old broker explanation",
      deductions: [],
      sourceLines: [],
    };
    const updated = {
      ...detail,
      version: 4,
      stockReconciliationStatus: "variance" as const,
      stockReconciliationNote: null,
    };
    vi.mocked(fetchDividendLedgerEntry).mockResolvedValue(detail as never);
    vi.mocked(updateDividendStockReconciliation).mockResolvedValue(updated as never);

    act(() => render(stockRow));
    await act(async () => {});

    const note = document.querySelector<HTMLTextAreaElement>("[data-testid='stock-reconciliation-note']")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(note, "   ");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='stock-reconciliation-save']")?.click();
    });

    expect(updateDividendStockReconciliation).toHaveBeenCalledWith("ledger-1", {
      status: "variance",
      note: null,
      expectedVersion: 3,
    });
    expect(document.querySelector("[role='status']")?.textContent).toContain("saved");
  });

  it("keeps stock reconciliation pending and retryable after a save error", async () => {
    const stockRow: DividendReviewRowSummaryDto = {
      ...row,
      eventType: "STOCK",
      stockReconciliationStatus: "variance",
      expectedStockQuantity: 100,
      receivedStockQuantity: 150,
    };
    vi.mocked(fetchDividendLedgerEntry).mockResolvedValue({ ...stockRow, deductions: [], sourceLines: [] } as never);
    let rejectSave!: (reason?: unknown) => void;
    vi.mocked(updateDividendStockReconciliation).mockReturnValue(new Promise((_resolve, reject) => { rejectSave = reject; }));

    act(() => render(stockRow));
    await act(async () => {});
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='stock-reconciliation-save']")?.click();
    });

    const save = document.querySelector<HTMLButtonElement>("[data-testid='stock-reconciliation-save']");
    expect(save?.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      rejectSave(new Error("version conflict"));
    });

    expect(document.querySelector("[role='alert']")?.textContent).toContain("Could not save");
    expect(save?.disabled).toBe(false);
  });

  it("guides generated ledger rows through the underlying transaction workflow", async () => {
    const generatedLedger = { ...row, postingStatus: "expected" as const };
    vi.mocked(fetchDividendLedgerEntry).mockResolvedValue({ ...generatedLedger, deductions: [], sourceLines: [] } as never);
    act(() => render(generatedLedger));
    await act(async () => {});

    const guidance = document.querySelector("[data-testid='dividend-removal-guidance']");
    expect(guidance?.textContent).toContain("underlying transaction");
    expect(guidance?.textContent).not.toContain("amendment or a reversal and replacement");
  });

  it("loads ledger detail locally and reuses the ID/version cache on reopen", async () => {
    vi.mocked(fetchDividendLedgerEntry).mockResolvedValue({ ...row, deductions: [], sourceLines: [] } as never);
    act(() => render(row));
    expect(document.querySelector("[data-testid='review-drawer-loading']")).not.toBeNull();
    await act(async () => {});
    expect(document.querySelector("[data-testid='posting-form']")).not.toBeNull();

    act(() => render(null));
    act(() => render(row));
    await act(async () => {});
    expect(fetchDividendLedgerEntry).toHaveBeenCalledTimes(1);

    act(() => render({ ...row, version: 4 }));
    await act(async () => {});
    expect(fetchDividendLedgerEntry).toHaveBeenCalledTimes(2);
  });

  it("reuses detail prefetched by another view without issuing a second request", async () => {
    primeDividendReviewDrawerDetailCache(
      "session:a:context:self",
      { ...row, deductions: [], sourceLines: [] },
    );

    act(() => render(row));
    await act(async () => {});

    expect(fetchDividendLedgerEntry).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid='posting-form']")).not.toBeNull();
  });

  it("keeps detail failure local and retries without disturbing the table owner", async () => {
    vi.mocked(fetchDividendLedgerEntry)
      .mockRejectedValueOnce(new Error("detail unavailable"))
      .mockResolvedValueOnce({ ...row, deductions: [], sourceLines: [] } as never);
    act(() => render(row));
    await act(async () => {});
    expect(document.querySelector("[data-testid='review-drawer-error']")?.textContent).toContain("detail unavailable");

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='review-drawer-retry']")?.click();
    });
    await act(async () => {});
    expect(document.querySelector("[data-testid='posting-form']")).not.toBeNull();
  });
});
