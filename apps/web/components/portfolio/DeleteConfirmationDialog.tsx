"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { LocaleCode, PreviewImpactResponse, TransactionHistoryItemDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import type { DividendDeletePreviewResponse } from "../../features/portfolio/services/transactionMutationService";
import { formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { Button } from "../ui/Button";

interface DeleteConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionHistoryItemDto | null;
  preview: PreviewImpactResponse | null;
  dividendPreview: DividendDeletePreviewResponse | null;
  isLoading: boolean;
  isSubmitting: boolean;
  errorMessage: string;
  statusMessage: string;
  onConfirm: () => void;
  dict: AppDictionary;
  locale: LocaleCode;
}

export function DeleteConfirmationDialog({
  open,
  onOpenChange,
  transaction,
  preview,
  dividendPreview,
  isLoading,
  isSubmitting,
  errorMessage,
  statusMessage,
  onConfirm,
  dict,
  locale,
}: DeleteConfirmationDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const restorePendingFocus = useCallback(() => {
    if (!isSubmitting) return;
    const focusContent = () => contentRef.current?.focus({ preventScroll: true });
    focusContent();
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(focusContent);
    }
  }, [isSubmitting]);

  useEffect(() => {
    restorePendingFocus();
  }, [restorePendingFocus]);

  if (!transaction) return null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-foreground/80" />
        <Dialog.Content
          ref={contentRef}
          className="!fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl focus:outline-none sm:p-6"
          data-testid="delete-confirmation-dialog"
          aria-busy={isSubmitting}
          onEscapeKeyDown={(event) => {
            if (isSubmitting) {
              event.preventDefault();
              restorePendingFocus();
            }
          }}
          onInteractOutside={(event) => {
            if (isSubmitting) {
              event.preventDefault();
              restorePendingFocus();
            }
          }}
          onPointerDownOutside={(event) => {
            if (isSubmitting) {
              event.preventDefault();
              restorePendingFocus();
            }
          }}
          onFocusOutside={(event) => {
            if (isSubmitting) {
              event.preventDefault();
              restorePendingFocus();
            }
          }}
        >
          <Dialog.Title className="text-base font-semibold text-foreground">
            {dict.mutations.deleteTitle}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {dict.mutations.deleteDividendImpactDetail
              .replace("{dividendEntries}", String(dividendPreview?.affectedCounts.dividendLedgerEntries ?? 0))
              .replace("{cashEntries}", String(dividendPreview?.affectedCounts.cashLedgerEntries ?? 0))}
          </Dialog.Description>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/90 p-3" data-testid="delete-trade-summary">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {dict.mutations.deleteSummaryLabel}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <p className="text-slate-600">{formatDateLabel(transaction.tradeDate, locale)}</p>
              <p className="text-slate-600">{transaction.ticker}</p>
              <p>
                <span
                  className={
                    transaction.type === "BUY"
                      ? "inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold uppercase text-emerald-700"
                      : "inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold uppercase text-rose-700"
                  }
                >
                  {transaction.type}
                </span>
              </p>
              <p className="text-slate-600">
                {formatNumber(transaction.quantity, locale)} @ {formatCurrencyAmount(transaction.unitPrice, transaction.priceCurrency, locale)}
              </p>
            </div>
          </div>

          {preview?.negativeLots.wouldOccur && (
            <div
              className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
              data-testid="delete-negative-lots-warning"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {dict.mutations.deleteNegativeLotsWarning
                    .replace("{quantity}", formatNumber(preview.negativeLots.resultingQuantity, locale))
                    .replace("{symbol}", preview.negativeLots.ticker)}
                </p>
              </div>
            </div>
          )}

          {preview && (
            <div className="mt-3 text-sm text-slate-600" data-testid="delete-impact-counts">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {dict.mutations.deleteImpactLabel}
              </p>
              <p className="mt-1">
                {dict.mutations.deleteImpactDetail
                  .replace("{cashEntries}", String(preview.affectedRows.cashLedgerEntries))
                  .replace("{lotAllocations}", String(preview.affectedRows.lotAllocations))}
              </p>
              {preview.affectedRows.holdingSnapshots > 0 && (
                <p className="mt-1" data-testid="delete-snapshot-impact">
                  {dict.mutations.deleteSnapshotImpact
                    .replace("{holdingSnapshots}", String(preview.affectedRows.holdingSnapshots))
                    .replace("{ticker}", transaction.ticker)
                    .replace("{date}", transaction.tradeDate)}
                </p>
              )}
            </div>
          )}

          {dividendPreview ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="delete-dividend-impact">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{dict.mutations.deleteDividendImpactTitle}</p>
                  <p className="mt-1">
                    {dict.mutations.deleteDividendImpactDetail
                      .replace("{dividendEntries}", String(dividendPreview.affectedCounts.dividendLedgerEntries))
                      .replace("{cashEntries}", String(dividendPreview.affectedCounts.cashLedgerEntries))}
                  </p>
                  {dividendPreview.manualReceiptReentryLedgerEntryIds.length > 0 ? (
                    <p className="mt-1 font-medium" data-testid="delete-dividend-reentry-warning">
                      {dict.mutations.deleteDividendReentryWarning.replace(
                        "{manualReceipts}",
                        String(dividendPreview.manualReceiptReentryLedgerEntryIds.length),
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {isLoading && (
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-500" role="status" aria-live="polite">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              <span>{dict.mutations.loadingPreview}</span>
            </div>
          )}

          <div aria-live="polite" aria-atomic="true">
            {statusMessage ? (
              <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800" role="status" data-testid="delete-status-message">
                {statusMessage}
              </p>
            ) : null}
            {errorMessage ? (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert" data-testid="delete-error-message">
                {errorMessage}
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              data-testid="delete-cancel-button"
            >
              {dict.actions.cancel}
            </Button>
            {!preview?.negativeLots.wouldOccur && (
              <Button
                type="button"
                className="border-rose-300 bg-rose-600 text-white shadow-[0_18px_36px_rgba(225,29,72,0.24)] hover:border-rose-400 hover:bg-rose-700"
                disabled={isLoading || isSubmitting || !preview || !dividendPreview}
                onClick={onConfirm}
                data-testid="delete-confirm-button"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {dict.mutations.deleteSubmitting}
                  </>
                ) : dict.mutations.deleteConfirmButton}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
