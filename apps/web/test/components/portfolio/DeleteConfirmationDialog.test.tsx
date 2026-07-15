import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewImpactResponse, TransactionHistoryItemDto } from "@vakwen/shared-types";
import { DeleteConfirmationDialog } from "../../../components/portfolio/DeleteConfirmationDialog";
import { getDictionary } from "../../../lib/i18n";
import type { DividendDeletePreviewResponse } from "../../../features/portfolio/services/transactionMutationService";

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
  negativeLots: { wouldOccur: false, symbols: [], resultingQuantity: 100, ticker: "2330" },
  affectedRows: { cashLedgerEntries: 2, lotAllocations: 3, feePolicySnapshots: 0, holdingSnapshots: 12 },
} as PreviewImpactResponse;

const dividendPreview = {
  preview: {
    previewId: "preview-1",
    previewVersion: 1,
    fingerprint: "abcdef1234567890",
    accountId: "acc-1",
    targetTradeEventId: "tx-1",
    expiresAt: "2026-07-14T10:00:00.000Z",
  },
  affectedCounts: {
    dividendLedgerEntries: 1,
    cashLedgerEntries: 2,
    dividendDeductionEntries: 0,
    dividendSourceLines: 0,
    stockDividendPositionActions: 0,
  },
  affectedDividends: [],
  manualReceiptReentryLedgerEntryIds: [],
} satisfies DividendDeletePreviewResponse;

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
          dividendPreview={dividendPreview}
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
        dividendPreview={dividendPreview}
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

    expect(document.activeElement).toBe(dialog);
  });
});
