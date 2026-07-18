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

vi.mock("../../../features/dividends/services/dividendCalculationService", async () => {
  const actual = await vi.importActual<typeof import("../../../features/dividends/services/dividendCalculationService")>(
    "../../../features/dividends/services/dividendCalculationService",
  );
  return {
    ...actual,
    fetchAccountMarketDividendSettings: vi.fn(),
    previewDividendCalculation: vi.fn(),
    confirmDividendCalculation: vi.fn(),
  };
});

import { updateDividendReconciliation } from "../../../features/dividends/services/dividendService";
import {
  confirmDividendCalculation,
  fetchAccountMarketDividendSettings,
  previewDividendCalculation,
} from "../../../features/dividends/services/dividendCalculationService";

function buildLedger(overrides?: Partial<DividendLedgerEntryDetails>): DividendLedgerEntryDetails {
  return {
    id: overrides?.id ?? "ledger-1",
    dividendEventId: overrides?.dividendEventId ?? "event-1",
    accountId: overrides?.accountId ?? "acc-1",
    ticker: overrides?.ticker ?? "2330",
    marketCode: overrides?.marketCode ?? "TW",
    instrumentType: overrides?.instrumentType ?? "STOCK",
    eventType: overrides?.eventType ?? "CASH",
    paymentDate: overrides?.paymentDate ?? "2026-04-20",
    exDividendDate: overrides?.exDividendDate ?? "2026-04-10",
    cashCurrency: overrides?.cashCurrency ?? "TWD",
    postingStatus: overrides?.postingStatus ?? "posted",
    reconciliationStatus: overrides?.reconciliationStatus ?? "open",
    correctionMode: overrides?.correctionMode,
    sourceCompositionStatus: overrides?.sourceCompositionStatus ?? "provided",
    version: overrides?.version ?? 1,
    reconciliationNote: overrides?.reconciliationNote ?? null,
    expectedCashAmount: overrides?.expectedCashAmount ?? 100,
    receivedCashAmount: overrides?.receivedCashAmount ?? 100,
    expectedStockQuantity: overrides?.expectedStockQuantity ?? 0,
    receivedStockQuantity: overrides?.receivedStockQuantity ?? 0,
    eligibleQuantity: overrides?.eligibleQuantity ?? 1_000,
    expectedGrossAmount: overrides?.expectedGrossAmount ?? null,
    expectedNetAmount: overrides?.expectedNetAmount ?? null,
    actualNetAmount: overrides?.actualNetAmount ?? null,
    varianceAmount: overrides?.varianceAmount ?? null,
    nhiAmount: overrides?.nhiAmount ?? null,
    bankFeeAmount: overrides?.bankFeeAmount ?? null,
    otherDeductionAmount: overrides?.otherDeductionAmount ?? null,
    stockDistributionRatio: overrides?.stockDistributionRatio ?? null,
    stockDistributionRatioState: overrides?.stockDistributionRatioState ?? null,
    expectedStockCalcState: overrides?.expectedStockCalcState ?? null,
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
      marketCode: overrides?.event?.marketCode ?? "TW",
      stockDistributionRatio: overrides?.event?.stockDistributionRatio ?? null,
      stockDistributionRatioState: overrides?.event?.stockDistributionRatioState ?? "unresolved",
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
    vi.mocked(fetchAccountMarketDividendSettings).mockReset();
    vi.mocked(fetchAccountMarketDividendSettings).mockImplementation(() => new Promise(() => undefined));
    vi.mocked(previewDividendCalculation).mockReset();
    vi.mocked(confirmDividendCalculation).mockReset();

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
        provider: {
          value: "0.08",
          unit: "RATIO",
          source: "finmind",
          dataset: "TaiwanStockDividend",
          authoritativeRatio: "0.08",
        },
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
    expect(document.querySelector("[data-testid='dividend-calculation-panel']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividend-calculation-provider']")?.textContent).toContain("finmind");
  });

  it("keeps unresolved expected stock unavailable while preserving the received share input", async () => {
    const row = buildRow({
      event: {
        eventType: "STOCK",
        expectedCashAmount: 0,
        expectedStockQuantity: null,
        stockDistributionRatioState: "unresolved",
      },
      ledgerEntry: buildLedger({
        eventType: "STOCK",
        expectedCashAmount: 0,
        expectedStockQuantity: null,
        receivedStockQuantity: 150,
        expectedStockCalcState: "needs_action",
        stockDistributionRatioState: "unresolved",
      }),
    });

    await act(async () => {
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

    expect(document.querySelector("[data-testid='dividend-expected-stock-value']")?.textContent).toContain("—");
    expect(document.querySelector("[data-testid='dividend-received-stock-hint']")).toBeNull();
    expect((document.querySelector("[data-testid='dividend-received-stock']") as HTMLInputElement).value).toBe("150");
  });

  it("silently refreshes calculation settings on return without losing unsaved receipt values", async () => {
    vi.mocked(fetchAccountMarketDividendSettings)
      .mockResolvedValueOnce({
        accountId: "acc-1",
        marketCode: "TW",
        version: 0,
        fallbackParValue: null,
        updatedAt: null,
      })
      .mockResolvedValueOnce({
        accountId: "acc-1",
        marketCode: "TW",
        version: 1,
        fallbackParValue: "10",
        updatedAt: "2026-07-17T04:00:00.000Z",
      });
    const row = buildRow({
      event: { eventType: "STOCK", expectedCashAmount: 0, expectedStockQuantity: 0 },
      ledgerEntry: buildLedger({
        eventType: "STOCK",
        expectedCashAmount: 0,
        expectedStockQuantity: 0,
        receivedStockQuantity: 150,
        stockDistributionRatioState: "unresolved",
      }),
    });

    await act(async () => {
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

    const receiptInput = document.querySelector("[data-testid='dividend-received-stock']") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(receiptInput, "175");
      receiptInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(fetchAccountMarketDividendSettings).toHaveBeenCalledTimes(2);
    expect(receiptInput.value).toBe("175");
    expect((document.querySelector("[data-testid='dividend-calculation-par-value']") as HTMLInputElement).value).toBe("10");
  });

  it("preserves a dirty receipt draft when the same ledger row refreshes after calculation changes", async () => {
    const initialRow = buildRow({
      event: { eventType: "STOCK", expectedCashAmount: 0, expectedStockQuantity: 150 },
      ledgerEntry: buildLedger({
        eventType: "STOCK",
        expectedCashAmount: 0,
        expectedStockQuantity: 150,
        receivedStockQuantity: 150,
        correctionMode: "amend",
      }),
    });
    await act(async () => {
      root.render(
        <DividendPostingForm row={initialRow} dict={dict} locale="en" onCancel={() => undefined} onSaved={() => undefined} />,
      );
    });
    const receiptInput = document.querySelector("[data-testid='dividend-received-stock']") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(receiptInput, "175");
      receiptInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const refreshedRow = buildRow({
      event: { eventType: "STOCK", expectedCashAmount: 0, expectedStockQuantity: 160 },
      ledgerEntry: buildLedger({
        version: 2,
        eventType: "STOCK",
        expectedCashAmount: 0,
        expectedStockQuantity: 160,
        receivedStockQuantity: 150,
        correctionMode: "amend",
      }),
    });
    await act(async () => {
      root.render(
        <DividendPostingForm row={refreshedRow} dict={dict} locale="en" onCancel={() => undefined} onSaved={() => undefined} />,
      );
    });

    expect((document.querySelector("[data-testid='dividend-received-stock']") as HTMLInputElement).value).toBe("175");
  });

  it("submits a reviewed calculation atomically with a new stock receipt", async () => {
    vi.mocked(fetchAccountMarketDividendSettings).mockResolvedValue({
      accountId: "acc-1",
      marketCode: "TW",
      version: 1,
      fallbackParValue: "10",
      updatedAt: "2026-07-17T04:00:00.000Z",
    });
    vi.mocked(previewDividendCalculation).mockResolvedValue({
      accountId: "acc-1",
      dividendEventId: "event-1",
      marketCode: "TW",
      eligibleQuantity: 1_000,
      method: "derived_from_par_value",
      providerValue: "1.5",
      providerUnit: "TWD_PER_SHARE",
      providerSource: "finmind",
      providerDataset: "TaiwanStockDividend",
      providerAuthoritativeRatio: null,
      ratio: "0.15",
      selectedParValue: "10",
      theoreticalShares: "150",
      expectedWholeShares: 150,
      fractionalRemainder: "0",
      requiresHighRatioConfirmation: false,
      drift: null,
      activeCalculation: null,
    });
    const row = buildRow({
      event: {
        eventType: "STOCK",
        expectedCashAmount: 0,
        expectedStockQuantity: null,
      },
    });

    await act(async () => {
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

    const receiptInput = document.querySelector("[data-testid='dividend-received-stock']") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(receiptInput, "155");
      receiptInput.dispatchEvent(new Event("input", { bubbles: true }));
      (document.querySelector("[data-testid='dividend-calculation-preview']") as HTMLButtonElement).click();
    });
    await act(async () => {
      (document.querySelector("[data-testid='dividend-save']") as HTMLButtonElement).click();
    });

    expect(submitMock).toHaveBeenCalledWith(expect.objectContaining({
      dividendEventId: "event-1",
      accountId: "acc-1",
      receivedStockQuantity: 155,
      calculation: {
        method: "derived_from_par_value",
        selectedParValue: "10",
      },
    }));
    expect(confirmDividendCalculation).not.toHaveBeenCalled();
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
        parValuePerShare: 10,
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
        parValuePerShare: 10,
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

  it("uses the authoritative par value for stock-leg NHI defaults", () => {
    const row = buildRow({
      event: {
        instrumentType: "STOCK",
        eventType: "CASH_AND_STOCK",
        cashDividendCurrency: "TWD",
        expectedCashAmount: 19_500,
        expectedStockQuantity: 100,
        parValuePerShare: 20,
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

    expect(typeSelects[0]!.value).toBe("NHI_SUPPLEMENTAL_PREMIUM");
    expect(amountInputs[0]!.value).toBe("454");
  });

  it("does not guess stock NHI base when the authoritative par value is unknown", () => {
    const row = buildRow({
      event: {
        instrumentType: "STOCK",
        eventType: "CASH_AND_STOCK",
        cashDividendCurrency: "TWD",
        expectedCashAmount: 19_500,
        expectedStockQuantity: 100,
        parValuePerShare: null,
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

    expect(typeSelects).toHaveLength(1);
    expect(typeSelects[0]!.value).toBe("BANK_FEE");
  });

  it("shows expected cash and stock math before editable actual fields for unresolved stock-ratio rows", () => {
    const row = buildRow({
      event: {
        eventType: "CASH_AND_STOCK",
        expectedCashAmount: 3_000,
        expectedStockQuantity: 0,
        eligibleQuantity: 1_000,
      },
      ledgerEntry: buildLedger({
        eventType: "CASH_AND_STOCK",
        expectedCashAmount: 3_000,
        expectedStockQuantity: 0,
        receivedCashAmount: 2_927,
        receivedStockQuantity: 150,
        expectedNetAmount: 2_927,
        actualNetAmount: 2_927,
        varianceAmount: 0,
        nhiAmount: 63,
        bankFeeAmount: 10,
        otherDeductionAmount: 0,
        deductions: [
          {
            id: "deduction-nhi",
            dividendLedgerEntryId: "ledger-1",
            deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
            amount: 63,
            currencyCode: "TWD",
            withheldAtSource: true,
            source: "test",
          },
          {
            id: "deduction-bank-fee",
            dividendLedgerEntryId: "ledger-1",
            deductionType: "BANK_FEE",
            amount: 10,
            currencyCode: "TWD",
            withheldAtSource: false,
            source: "test",
          },
        ],
        stockDistributionRatioState: "unresolved",
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

    const expectedSection = document.querySelector("[data-testid='dividend-expected-summary']");
    const actualSection = document.querySelector("[data-testid='dividend-actual-inputs']");
    expect(expectedSection).not.toBeNull();
    expect(actualSection).not.toBeNull();
    expect(container.textContent).toContain("Expected net");
    expect(container.textContent).toContain("Actual net");
    expect(container.textContent).toContain("Variance");
    expect(container.textContent).toContain("Needs Action: Needs calculation");
    expect(container.textContent).toContain("Expected stock");
    expect(document.querySelector("[data-testid='dividend-expected-stock-value']")?.textContent).toBe("—");
    expect((document.querySelector("[data-testid='dividend-received-stock']") as HTMLInputElement).value).toBe("150");
    expect(container.textContent).toContain("NT$3,000 - NT$63 - NT$10 - NT$0 = NT$2,927");
    expect(container.textContent).toContain("NT$2,927 - NT$2,927 = NT$0");

    expect(expectedSection?.compareDocumentPosition(actualSection!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows authoritative stock math while keeping expected values read-only when actual stock is zero", () => {
    const row = buildRow({
      event: {
        eventType: "CASH_AND_STOCK",
        expectedCashAmount: 3_000,
        expectedStockQuantity: 25,
        eligibleQuantity: 1_000,
      },
      ledgerEntry: buildLedger({
        eventType: "CASH_AND_STOCK",
        expectedCashAmount: 3_000,
        expectedStockQuantity: 25,
        receivedCashAmount: 2_927,
        receivedStockQuantity: 0,
        expectedNetAmount: 2_927,
        actualNetAmount: 2_927,
        varianceAmount: 0,
        nhiAmount: 63,
        bankFeeAmount: 10,
        otherDeductionAmount: 0,
        stockDistributionRatio: 0.025,
        stockDistributionRatioState: "authoritative",
        correctionMode: "in_place",
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

    expect(container.textContent).toContain("1,000 shares × 0.025 = 25");
    expect(container.textContent).not.toContain("Needs Action: Needs calculation");

    const stockInput = document.querySelector<HTMLInputElement>("[data-testid='dividend-received-stock']");
    expect(stockInput).not.toBeNull();
    expect(stockInput?.disabled).toBe(true);
    expect(stockInput?.value).toBe("0");
  });

  it("uses authoritative event ratio math before a stock dividend is posted", () => {
    const row = buildRow({
      event: {
        eventType: "STOCK",
        expectedCashAmount: 0,
        expectedStockQuantity: 25,
        eligibleQuantity: 1_000,
        stockDistributionRatio: 0.025,
        stockDistributionRatioState: "authoritative",
      },
      ledgerEntry: null,
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

    expect(container.textContent).toContain("1,000 shares × 0.025 = 25");
    expect(container.textContent).not.toContain("Needs Action: Needs calculation");
  });

  it("treats received cash as actual net when ledger net fields are absent", () => {
    const row = buildRow({
      event: { expectedCashAmount: 120 },
      ledgerEntry: buildLedger({
        expectedCashAmount: 120,
        receivedCashAmount: 108,
        expectedGrossAmount: 120,
        expectedNetAmount: null,
        actualNetAmount: null,
        varianceAmount: null,
        nhiAmount: 12,
        bankFeeAmount: 0,
        otherDeductionAmount: 0,
        deductions: [{
          id: "deduction-nhi",
          dividendLedgerEntryId: "ledger-1",
          deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
          amount: 12,
          currencyCode: "TWD",
          withheldAtSource: true,
          source: "test",
        }],
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

    expect(container.querySelector("[data-testid='dividend-variance-formula']")?.textContent)
      .toContain("NT$108 - NT$108 = NT$0");
  });

  it("recomputes variance from edited receipt values instead of persisted ledger totals", () => {
    const row = buildRow({
      event: { expectedCashAmount: 120 },
      ledgerEntry: buildLedger({
        expectedCashAmount: 120,
        receivedCashAmount: 108,
        expectedGrossAmount: 120,
        expectedNetAmount: 108,
        actualNetAmount: 108,
        varianceAmount: 0,
        deductions: [{
          id: "deduction-nhi",
          dividendLedgerEntryId: "ledger-1",
          deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
          amount: 12,
          currencyCode: "TWD",
          withheldAtSource: true,
          source: "test",
        }],
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
    const cashInput = container.querySelector<HTMLInputElement>("[data-testid='dividend-received-cash']")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(cashInput, "90");
      cashInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.querySelector("[data-testid='dividend-variance-formula']")?.textContent)
      .toContain("NT$90 - NT$108 = -NT$18");
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
        parValuePerShare: 10,
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
        parValuePerShare: 10,
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

  it("shows expected and actual sections with stock editing disabled for non-amend stock ledger entries", () => {
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

    expect(document.querySelector("[data-testid='dividend-posting-form']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividend-expected-summary']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividend-actual-inputs']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividend-received-cash']")).toBeNull();
    const stockInput = document.querySelector<HTMLInputElement>("[data-testid='dividend-received-stock']");
    expect(stockInput).not.toBeNull();
    expect(stockInput?.disabled).toBe(true);
    expect(
      document.querySelector("[data-testid='dividend-stock-edit-disabled-label']")?.textContent,
    ).toContain(dict.dividends.action.stockEditDisabled);
    expect(document.querySelector("[data-testid='dividend-reconcile-section']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividend-reconcile-status-select']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dividend-cancel']")).not.toBeNull();
  });

  it("allows stock quantity amendments for posted stock entries in amend mode", () => {
    const row = buildRow({
      event: { eventType: "STOCK", expectedCashAmount: 0, expectedStockQuantity: 50 },
      ledgerEntry: buildLedger({
        eventType: "STOCK",
        postingStatus: "posted",
        correctionMode: "amend",
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

    expect(container.querySelector("[data-testid='dividend-stock-edit-disabled-label']")).toBeNull();
    expect(container.querySelector("[data-testid='dividend-posting-form']")).not.toBeNull();
    expect(container.querySelector("[data-testid='dividend-received-stock']")).not.toBeNull();
    expect(container.querySelector("[data-testid='dividend-reconcile-section']")).not.toBeNull();
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

  it("submits zero stock quantity when editing a legacy cash entry with hidden stock quantity", async () => {
    const row = buildRow({
      event: {
        eventType: "CASH",
        expectedCashAmount: 100,
      },
      ledgerEntry: buildLedger({
        eventType: "CASH",
        postingStatus: "posted",
        sourceCompositionStatus: "unknown_pending_disclosure",
        receivedStockQuantity: 50,
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

    const saveButton = document.querySelector("[data-testid='dividend-save']") as HTMLButtonElement;
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(submitMock).toHaveBeenCalledWith(expect.objectContaining({
      dividendLedgerEntryId: "ledger-1",
      expectedVersion: 1,
      receivedStockQuantity: 0,
    }));
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
