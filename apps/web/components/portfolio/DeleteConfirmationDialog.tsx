"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { LocaleCode, PostedTransactionMutationPreviewDto, TransactionHistoryItemDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { Button } from "../ui/Button";

interface DeleteConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionHistoryItemDto | null;
  preview: PostedTransactionMutationPreviewDto | null;
  dividendPreview: null;
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
  isLoading,
  isSubmitting,
  errorMessage,
  statusMessage,
  onConfirm,
  dict,
  locale,
}: DeleteConfirmationDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previewItem = preview?.page.items[0] ?? null;
  const before = previewItem?.before ?? null;
  const previewStatusCopy = locale === "zh-TW"
    ? { ready: "可確認", stale: "預覽已過時", expired: "預覽已過期", confirmed: "已確認", failed: "預覽失敗", expires: "到期時間" }
    : { ready: "Ready to confirm", stale: "Preview is stale", expired: "Preview expired", confirmed: "Confirmed", failed: "Preview failed", expires: "Expires" };

  useEffect(() => {
    if (!open || !isSubmitting) return;
    const content = contentRef.current;
    if (!content) return;
    const restoreFocus = () => {
      if (!content.contains(document.activeElement)) content.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      restoreFocus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (content.contains(event.target as Node)) return;
      event.preventDefault();
      restoreFocus();
    };

    restoreFocus();
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isSubmitting, open]);

  if (!transaction) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-foreground/80" />
        <Dialog.Content
          ref={contentRef}
          className="!fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl focus:outline-none sm:p-6"
          data-testid="delete-confirmation-dialog"
          onEscapeKeyDown={(event) => {
            if (isSubmitting) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (isSubmitting) event.preventDefault();
          }}
          onFocusOutside={(event) => {
            if (isSubmitting) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-base font-semibold text-foreground">
            {dict.mutations.deleteTitle}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {dict.mutations.deleteSummaryLabel}
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

          {before ? (
            <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{dict.transactions.grossTradeValueLabel}</p>
                <p className="mt-1 font-medium text-slate-900">
                  {formatCurrencyAmount(before.grossTradeValueAmount, before.priceCurrency, locale)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {before.side === "BUY" ? dict.transactions.buyCashOutLabel : dict.transactions.sellNetProceedsLabel}
                </p>
                <p className="mt-1 font-medium text-slate-900">
                  {before.settlementAvailable && before.settlementAmount !== null
                    ? formatCurrencyAmount(before.settlementAmount, before.priceCurrency, locale)
                    : dict.transactions.estimatedUnavailable}
                </p>
              </div>
            </div>
          ) : null}

          {preview ? (
            <div className="mt-3 space-y-3 text-sm text-slate-700" data-testid="delete-impact-counts">
              <div className="flex flex-wrap items-center justify-between gap-2 border-y border-slate-200 py-2" data-testid="delete-preview-status">
                <span className="font-semibold text-slate-900">{previewStatusCopy[preview.status]}</span>
                <span className="text-slate-500">
                  {previewStatusCopy.expires} {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(preview.expiresAt))}
                </span>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {dict.mutations.deleteImpactLabel}
                </p>
                <p className="mt-1">
                  {dict.mutations.deleteImpactDetail
                    .replace(
                      "{cashDelta}",
                      formatCurrencyAmount(preview.summary.cashDelta, transaction.priceCurrency, locale),
                    )
                    .replace("{quantityDelta}", formatNumber(preview.summary.quantityDelta, locale))}
                </p>
              </div>
              {preview.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900" data-testid="delete-dividend-impact">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">{dict.mutations.deleteDividendImpactTitle}</p>
                      <ul className="mt-1 space-y-1">
                        {preview.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}
              {preview.blockers.length > 0 ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-700" data-testid="delete-negative-lots-warning">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="space-y-1">
                      {preview.blockers.map((blocker) => (
                        <p key={blocker}>{blocker}</p>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {isLoading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-500" role="status" aria-live="polite">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              <span>{dict.mutations.loadingPreview}</span>
            </div>
          ) : null}

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
            <Button
              type="button"
              className="border-rose-300 bg-rose-600 text-white shadow-[0_18px_36px_rgba(225,29,72,0.24)] hover:border-rose-400 hover:bg-rose-700"
              disabled={isLoading || isSubmitting || !preview || preview.status !== "ready" || preview.blockers.length > 0}
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
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
