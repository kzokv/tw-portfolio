import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DividendPostingForm } from "../../../components/dividends/DividendPostingForm";
import { getDictionary } from "../../../lib/i18n";
import type {
  DividendCalendarRow,
  DividendLedgerEntryDetails,
  DividendPostingResult,
} from "../../../features/dividends/types";

const submitMock = vi.fn<(payload: unknown) => Promise<DividendPostingResult | null>>();

vi.mock("../../../features/dividends/hooks/useDividendPosting", () => ({
  useDividendPosting: () => ({
    errorMessage: "",
    isSubmitting: false,
    submit: submitMock,
  }),
}));

vi.mock("../../../features/dividends/services/dividendService", () => ({
  updateDividendReconciliation: vi.fn(),
}));

import { updateDividendReconciliation } from "../../../features/dividends/services/dividendService";

function buildLedger(overrides?: Partial<DividendLedgerEntryDetails>): DividendLedgerEntryDetails {
  return {
    id: overrides?.id ?? "ledger-1",
    dividendEventId: overrides?.dividendEventId ?? "event-1",
    accountId: overrides?.accountId ?? "acc-1",
    ticker: overrides?.ticker ?? "2330",
    instrumentType: overrides?.instrumentType ?? "STOCK",
    eventType: overrides?.eventType ?? "CASH",
    paymentDate: overrides?.paymentDate ?? "2026-04-20",
    exDividendDate: overrides?.exDividendDate ?? "2026-04-10",
    cashCurrency: overrides?.cashCurrency ?? "TWD",
    postingStatus: overrides?.postingStatus ?? "posted",
    reconciliationStatus: overrides?.reconciliationStatus ?? "open",
    sourceCompositionStatus: overrides?.sourceCompositionStatus ?? "provided",
    version: overrides?.version ?? 1,
    reconciliationNote: overrides?.reconciliationNote ?? null,
    expectedCashAmount: overrides?.expectedCashAmount ?? 100,
    receivedCashAmount: overrides?.receivedCashAmount ?? 100,
    expectedStockQuantity: overrides?.expectedStockQuantity ?? 0,
    receivedStockQuantity: overrides?.receivedStockQuantity ?? 0,
    eligibleQuantity: overrides?.eligibleQuantity ?? 1_000,
    sourceLines: overrides?.sourceLines ?? [],
    deductions: overrides?.deductions ?? [],
  };
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function buildRow(overrides?: {
  key?: string;
  event?: Partial<DividendCalendarRow["event"]>;
  ledgerEntry?: DividendCalendarRow["ledgerEntry"];
}): DividendCalendarRow {
  return {
    key: overrides?.key ?? "acc-1:event-1",
    event: {
      id: "event-1",
      accountId: "acc-1",
      ticker: "2330",
      instrumentType: "STOCK",
      eventType: "CASH",
      exDividendDate: "2026-04-10",
      paymentDate: "2026-04-20",
      cashDividendCurrency: "TWD",
      expectedCashAmount: 100,
      expectedStockQuantity: 0,
      eligibleQuantity: 1_000,
      hasPostedLedgerEntry: false,
      dividendLedgerEntryId: null,
      ...overrides?.event,
    },
    ledgerEntry: overrides?.ledgerEntry ?? null,
  };
}

describe("DividendPostingForm", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    submitMock.mockReset();
    submitMock.mockResolvedValue({
      dividendLedgerEntry: {
        id: "ledger-1",
        accountId: "acc-1",
        dividendEventId: "event-1",
        version: 1,
        reconciliationStatus: "open",
        sourceCompositionStatus: "provided",
      },
    });
    vi.mocked(updateDividendReconciliation).mockReset();
    vi.mocked(updateDividendReconciliation).mockResolvedValue(buildLedger());

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows stock-only quantity input for stock dividend postings", () => {
    const row = buildRow({
      event: {
        eventType: "STOCK",
        expectedCashAmount: 0,
        expectedStockQuantity: 80,
      },
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    expect(document.querySelector("[data-testid='dividend-received-cash']")).toBeNull();
    expect(document.querySelector("[data-testid='dividend-received-stock']")).not.toBeNull();
  });

  it("clears source lines when disclosure is marked unknown again", () => {
    const row = buildRow({
      event: {
        instrumentType: "ETF",
      },
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    const unknownToggle = document.querySelector("[data-testid='dividend-source-unknown-toggle']") as HTMLInputElement;
    const addSourceLine = () => {
      const button = document.querySelector("[data-testid='dividend-add-source-line']") as HTMLButtonElement;
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };

    act(() => {
      unknownToggle.click();
    });
    act(() => {
      addSourceLine();
    });

    expect(document.querySelector("[data-testid='dividend-source-amount-0']")).not.toBeNull();

    act(() => {
      unknownToggle.click();
    });

    expect(document.querySelector("[data-testid='dividend-source-amount-0']")).toBeNull();

    act(() => {
      unknownToggle.click();
    });

    expect(document.querySelector("[data-testid='dividend-source-amount-0']")).toBeNull();
  });

  it("blocks submit when source lines do not reconcile within tolerance", async () => {
    const row = buildRow();

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    // New posts default to "unknown disclosure" — opt into provided mode so
    // the Add source line button is visible.
    const unknownToggle = document.querySelector(
      "[data-testid='dividend-source-unknown-toggle']",
    ) as HTMLInputElement;
    act(() => {
      unknownToggle.click();
    });

    const addSourceLineButton = document.querySelector("[data-testid='dividend-add-source-line']") as HTMLButtonElement;
    act(() => {
      addSourceLineButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const sourceAmount = document.querySelector("[data-testid='dividend-source-amount-0']") as HTMLInputElement;
    act(() => {
      sourceAmount.value = "80";
      sourceAmount.dispatchEvent(new Event("input", { bubbles: true }));
      sourceAmount.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const saveButton = document.querySelector("[data-testid='dividend-save']") as HTMLButtonElement;
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector("[data-testid='dividend-form-error']")?.textContent).toContain("Source lines must reconcile within NT$1");
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("prefills NHI supplemental premium and bank fee for TWD stock cash dividends", () => {
    const row = buildRow({
      event: {
        instrumentType: "STOCK",
        eventType: "CASH",
        cashDividendCurrency: "TWD",
        expectedCashAmount: 30_000,
        eligibleQuantity: 1_000,
      },
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    const typeSelects = Array.from(
      document.querySelectorAll<HTMLSelectElement>("[data-testid^='dividend-deduction-type-']"),
    );
    const amountInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("[data-testid^='dividend-deduction-amount-']"),
    );

    expect(typeSelects.length).toBe(2);
    expect(typeSelects[0]!.value).toBe("NHI_SUPPLEMENTAL_PREMIUM");
    // 30_000 × 0.0211 = 633
    expect(amountInputs[0]!.value).toBe("633");
    expect(typeSelects[1]!.value).toBe("BANK_FEE");
    expect(amountInputs[1]!.value).toBe("10");
  });

  it("prefills NHI at zero below the NT$20,000 threshold but still shows the bank fee", () => {
    const row = buildRow({
      event: {
        instrumentType: "STOCK",
        eventType: "CASH",
        cashDividendCurrency: "TWD",
        expectedCashAmount: 6_000,
      },
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    const typeSelects = Array.from(
      document.querySelectorAll<HTMLSelectElement>("[data-testid^='dividend-deduction-type-']"),
    );
    const amountInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("[data-testid^='dividend-deduction-amount-']"),
    );

    expect(typeSelects.length).toBe(2);
    expect(typeSelects[0]!.value).toBe("NHI_SUPPLEMENTAL_PREMIUM");
    expect(amountInputs[0]!.value).toBe("0");
    expect(typeSelects[1]!.value).toBe("BANK_FEE");
    expect(amountInputs[1]!.value).toBe("10");
  });

  it("prefills ETF dividends with NHI at 0 (estimate mode) and bank fee", () => {
    const row = buildRow({
      event: {
        instrumentType: "ETF",
        eventType: "CASH",
        cashDividendCurrency: "TWD",
        expectedCashAmount: 30_000,
      },
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    const typeSelects = Array.from(
      document.querySelectorAll<HTMLSelectElement>("[data-testid^='dividend-deduction-type-']"),
    );
    const amountInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("[data-testid^='dividend-deduction-amount-']"),
    );

    expect(typeSelects.length).toBe(2);
    expect(typeSelects[0]!.value).toBe("NHI_SUPPLEMENTAL_PREMIUM");
    expect(amountInputs[0]!.value).toBe("0");
    expect(typeSelects[1]!.value).toBe("BANK_FEE");
    expect(amountInputs[1]!.value).toBe("10");
  });

  it("prefills NHI for stock-only dividends using par value × received shares", () => {
    // 3,000 shares × NT$10 par = NT$30,000 premium base → NHI = 633
    const row = buildRow({
      event: {
        instrumentType: "STOCK",
        eventType: "STOCK",
        cashDividendCurrency: "TWD",
        expectedCashAmount: 0,
        expectedStockQuantity: 3_000,
        eligibleQuantity: 10_000,
      },
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    const typeSelects = Array.from(
      document.querySelectorAll<HTMLSelectElement>("[data-testid^='dividend-deduction-type-']"),
    );
    const amountInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("[data-testid^='dividend-deduction-amount-']"),
    );

    // NHI only — no bank fee because no cash is arriving.
    expect(typeSelects.length).toBe(1);
    expect(typeSelects[0]!.value).toBe("NHI_SUPPLEMENTAL_PREMIUM");
    // 3,000 × 10 × 0.0211 = 633
    expect(amountInputs[0]!.value).toBe("633");
  });

  it("prefills NHI for CASH_AND_STOCK combining both legs of the premium base", () => {
    // Cash leg: 18,000; Stock leg: 500 × NT$10 = 5,000; Total: 23,000 → NHI = 485
    const row = buildRow({
      event: {
        instrumentType: "STOCK",
        eventType: "CASH_AND_STOCK",
        cashDividendCurrency: "TWD",
        expectedCashAmount: 18_000,
        expectedStockQuantity: 500,
        eligibleQuantity: 3_000,
      },
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    const typeSelects = Array.from(
      document.querySelectorAll<HTMLSelectElement>("[data-testid^='dividend-deduction-type-']"),
    );
    const amountInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("[data-testid^='dividend-deduction-amount-']"),
    );

    // NHI + bank fee (cash is arriving).
    expect(typeSelects.length).toBe(2);
    expect(typeSelects[0]!.value).toBe("NHI_SUPPLEMENTAL_PREMIUM");
    // (18,000 + 5,000) × 0.0211 = 485.3 → rounds to 485
    expect(amountInputs[0]!.value).toBe("485");
    expect(typeSelects[1]!.value).toBe("BANK_FEE");
    expect(amountInputs[1]!.value).toBe("10");
  });

  it("defaults source composition to unknown and hides the Add source line button", () => {
    const row = buildRow();

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    const unknownToggle = document.querySelector(
      "[data-testid='dividend-source-unknown-toggle']",
    ) as HTMLInputElement;
    expect(unknownToggle.checked).toBe(true);
    expect(document.querySelector("[data-testid='dividend-add-source-line']")).toBeNull();
    expect(document.querySelector("[data-testid='dividend-source-helper']")?.textContent).toContain("ETFs split distributions");
  });

  it("shows per-share helper text under received cash input", () => {
    const row = buildRow({
      event: {
        eventType: "CASH",
        expectedCashAmount: 6_000,
        eligibleQuantity: 1_000,
      },
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    const hint = document.querySelector("[data-testid='dividend-received-cash-hint']");
    expect(hint?.textContent).toMatch(/NT\$6.*1,000 shares/);
  });

  it("hides amounts form and shows reconcile-only label for stock ledger entries", () => {
    const row = buildRow({
      event: { eventType: "STOCK", expectedCashAmount: 0, expectedStockQuantity: 50 },
      ledgerEntry: buildLedger({
        eventType: "STOCK",
        postingStatus: "posted",
        receivedStockQuantity: 50,
        expectedCashAmount: 0,
        receivedCashAmount: 0,
      }),
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    // Amounts form is NOT rendered in reconcile-only mode.
    expect(document.querySelector("[data-testid='dividend-posting-form']")).toBeNull();
    expect(document.querySelector("[data-testid='dividend-received-cash']")).toBeNull();
    expect(document.querySelector("[data-testid='dividend-received-stock']")).toBeNull();
    // Disabled label and reconcile section are visible.
    expect(
      document.querySelector("[data-testid='dividend-stock-edit-disabled-label']")?.textContent,
    ).toContain(dict.dividends.action.stockEditDisabled);
    expect(document.querySelector("[data-testid='dividend-reconcile-section']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividend-reconcile-status-select']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividend-cancel']")).not.toBeNull();
  });

  it("renders reconciliation section below the amounts form for posted cash entries", () => {
    const row = buildRow({
      ledgerEntry: buildLedger({ postingStatus: "posted", reconciliationStatus: "open" }),
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    expect(document.querySelector("[data-testid='dividend-posting-form']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividend-reconcile-section']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividend-reconcile-save']")).not.toBeNull();
  });

  it("saves reconciliation via PATCH and calls onSaved", async () => {
    const onSaved = vi.fn<() => Promise<void>>().mockResolvedValue();
    const row = buildRow({
      ledgerEntry: buildLedger({
        id: "ledger-posted",
        postingStatus: "posted",
        reconciliationStatus: "open",
      }),
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={onSaved}
        />,
      );
    });

    const select = document.querySelector(
      "[data-testid='dividend-reconcile-status-select']",
    ) as HTMLSelectElement;
    act(() => {
      select.value = "matched";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const reconcileSave = document.querySelector(
      "[data-testid='dividend-reconcile-save']",
    ) as HTMLButtonElement;
    // Reconcile save must NOT be a submit button — otherwise it would submit
    // the amounts form and reset reconciliation_status to "open" on the API.
    expect(reconcileSave.getAttribute("type")).toBe("button");

    await act(async () => {
      reconcileSave.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updateDividendReconciliation).toHaveBeenCalledWith(
      "ledger-posted",
      "matched",
      undefined,
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    // Amounts submit path must not have fired.
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("shows NHI estimate warning for ETF with unknown_pending_disclosure", () => {
    const row = buildRow({
      event: {
        instrumentType: "ETF",
        eventType: "CASH",
        cashDividendCurrency: "TWD",
        expectedCashAmount: 30_000,
      },
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    // New ETF posts default to "unknown disclosure" mode — estimate warning must be visible
    const warning = document.querySelector("[data-testid='nhi-estimate-warning']");
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain("Estimated NT$0");
  });

  it("hides NHI estimate warning for ETF with provided source composition above threshold", () => {
    const ledger = buildLedger({
      instrumentType: "ETF",
      eventType: "CASH",
      cashCurrency: "TWD",
      sourceCompositionStatus: "provided",
      sourceLines: [
        {
          id: "sl-1",
          dividendLedgerEntryId: "ledger-1",
          sourceBucket: "DIVIDEND_INCOME",
          amount: 25_000,
          currencyCode: "TWD",
          source: "issuer",
        },
      ],
    });
    const row = buildRow({
      event: {
        instrumentType: "ETF",
        eventType: "CASH",
        cashDividendCurrency: "TWD",
        expectedCashAmount: 25_000,
        hasPostedLedgerEntry: true,
        dividendLedgerEntryId: "ledger-1",
      },
      ledgerEntry: ledger,
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    // Provided mode — no estimate warning
    expect(document.querySelector("[data-testid='nhi-estimate-warning']")).toBeNull();
  });

  it("does not show NHI estimate warning for non-ETF instruments", () => {
    const row = buildRow({
      event: {
        instrumentType: "STOCK",
        eventType: "CASH",
        cashDividendCurrency: "TWD",
        expectedCashAmount: 30_000,
      },
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    expect(document.querySelector("[data-testid='nhi-estimate-warning']")).toBeNull();
  });

  it("blocks reconciliation save when explained status has an empty note", async () => {
    const row = buildRow({
      ledgerEntry: buildLedger({ postingStatus: "posted", reconciliationStatus: "open" }),
    });

    act(() => {
      root.render(
        <DividendPostingForm
          row={row}
          dict={dict}
          locale="en"
          onCancel={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    const select = document.querySelector(
      "[data-testid='dividend-reconcile-status-select']",
    ) as HTMLSelectElement;
    act(() => {
      select.value = "explained";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const reconcileSave = document.querySelector(
      "[data-testid='dividend-reconcile-save']",
    ) as HTMLButtonElement;

    await act(async () => {
      reconcileSave.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updateDividendReconciliation).not.toHaveBeenCalled();
    expect(
      document.querySelector("[data-testid='dividend-reconcile-error']")?.textContent,
    ).toContain(dict.dividends.form.error.noteRequiredForExplained);
  });
});
