import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostedTransactionMutationPreviewDto, TransactionHistoryItemDto } from "@vakwen/shared-types";
import { DeleteConfirmationDialog } from "../../../components/portfolio/DeleteConfirmationDialog";
import { getDictionary } from "../../../lib/i18n";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const transaction = {
  id: "tx-1",
  accountId: "acc-1",
  ticker: "2330",
  tradeDate: "2026-01-09",
  type: "BUY",
  quantity: 100,
  unitPrice: 500,
  priceCurrency: "TWD",
} as TransactionHistoryItemDto;

const preview = {
  previewId: "preview-1",
  previewVersion: 1,
  status: "ready",
  operation: "delete",
  reason: "Delete posted transaction",
  confirmationSummary: "Delete one posted transaction",
  confirmationDigest: "digest-1",
  fingerprint: "fingerprint-1",
  expiresAt: "2026-07-14T10:00:00.000Z",
  createdAt: "2026-07-14T09:30:00.000Z",
  batchLimit: 50,
  affectedAccountIds: ["acc-1"],
  affectedTickers: [{ ticker: "2330", marketCode: "TW" }],
  scopes: [],
  warnings: ["A dividend receipt may require manual re-entry."],
  blockers: [],
  errors: [],
  summary: {
    quantityDelta: -100,
    costBasisDelta: -50_000,
    realizedPnlDelta: 0,
    cashDelta: 2,
    reopenedDividendCount: 1,
    deletedDividendCount: 0,
  },
  page: {
    total: 1,
    limit: 50,
    offset: 0,
    items: [{
      transactionId: "tx-1",
      status: "deleted",
      before: {
        transactionId: "tx-1",
        accountId: "acc-1",
        accountName: "Main Brokerage",
        ticker: "2330",
        marketCode: "TW",
        priceCurrency: "TWD",
        tradeDate: "2026-01-09",
        side: "BUY",
        quantity: 100,
        unitPrice: 500,
        grossTradeValueAmount: 50_000,
        commissionAmount: 71,
        taxAmount: 0,
        settlementAmount: -50_071,
        settlementAvailable: true,
        bookedCostAmount: 50_071,
        isDayTrade: false,
        feesSource: "CALCULATED",
      },
      after: null,
      impacts: {
        quantityDelta: -100,
        costBasisDelta: -50_000,
        realizedPnlDelta: 0,
        cashDelta: 2,
        reopenedDividendCount: 1,
        deletedDividendCount: 0,
      },
      warnings: [],
      blockers: [],
      errors: [],
    }],
  },
  deepLinks: {
    previewPath: "/transactions/mutations/preview-1",
    runPath: null,
    transactionPath: "/transactions",
    previewUrl: null,
    runUrl: null,
  },
} satisfies PostedTransactionMutationPreviewDto;

describe("DeleteConfirmationDialog", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("keeps reviewed impact visible and locks dismissal while deleting", async () => {
    const onOpenChange = vi.fn();
    await act(async () => {
      root.render(
        <DeleteConfirmationDialog
          open
          onOpenChange={onOpenChange}
          transaction={transaction}
          preview={preview}
          dividendPreview={null}
          isLoading={false}
          isSubmitting
          errorMessage=""
          statusMessage=""
          onConfirm={vi.fn()}
          dict={getDictionary("en")}
          locale="en"
        />,
      );
    });

    expect(document.querySelector("[data-testid='delete-impact-counts']")).not.toBeNull();
    expect(document.querySelector("[data-testid='delete-dividend-impact']")).not.toBeNull();
    expect(document.body.textContent).toContain("Deleting…");
    expect(document.querySelector<HTMLButtonElement>("[data-testid='delete-confirm-button']")?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("[data-testid='delete-cancel-button']")?.disabled).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("restores focus inside the dialog when pending dismissal moves focus outside", async () => {
    const outsideButton = document.createElement("button");
    outsideButton.textContent = "Outside";
    document.body.appendChild(outsideButton);
    const renderDialog = (isSubmitting: boolean) => (
      <DeleteConfirmationDialog
        open
        onOpenChange={vi.fn()}
        transaction={transaction}
        preview={preview}
        dividendPreview={null}
        isLoading={false}
        isSubmitting={isSubmitting}
        errorMessage=""
        statusMessage=""
        onConfirm={vi.fn()}
        dict={getDictionary("en")}
        locale="en"
      />
    );
    await act(async () => {
      root.render(renderDialog(false));
    });

    const dialog = document.querySelector<HTMLElement>("[data-testid='delete-confirmation-dialog']");
    expect(dialog).not.toBeNull();
    const confirmButton = document.querySelector<HTMLButtonElement>("[data-testid='delete-confirm-button']");
    confirmButton?.focus();

    await act(async () => {
      root.render(renderDialog(true));
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    outsideButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    confirmButton?.blur();
    await act(async () => {});

    expect(dialog?.contains(document.activeElement)).toBe(true);
  });
});
