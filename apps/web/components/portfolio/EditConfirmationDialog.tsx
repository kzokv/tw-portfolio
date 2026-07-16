"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { LocaleCode, PostedTransactionMutationPreviewDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { Button } from "../ui/Button";

interface EditConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: PostedTransactionMutationPreviewDto | null;
  isLoading: boolean;
  isSubmitting?: boolean;
  onConfirm: () => void;
  dict: AppDictionary;
  locale: LocaleCode;
}

export function EditConfirmationDialog({
  open,
  onOpenChange,
  preview,
  isLoading,
  isSubmitting = false,
  onConfirm,
  dict,
  locale,
}: EditConfirmationDialogProps) {
  const previewCopy = locale === "zh-TW"
    ? { before: "變更前", after: "變更後", ready: "可確認", stale: "預覽已過時", expired: "預覽已過期", confirmed: "已確認", failed: "預覽失敗", expires: "到期時間" }
    : { before: "Before", after: "After", ready: "Ready to confirm", stale: "Preview is stale", expired: "Preview expired", confirmed: "Confirmed", failed: "Preview failed", expires: "Expires" };
  const previewItem = preview?.page.items[0] ?? null;
  const before = previewItem?.before ?? null;
  const after = previewItem?.after ?? null;

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-foreground/80" />
        <Dialog.Content
          className="!fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl focus:outline-none sm:p-6"
          data-testid="edit-confirmation-dialog"
        >
          <Dialog.Title className="text-base font-semibold text-foreground">
            {dict.mutations.editConfirmTitle}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {previewCopy.before} / {previewCopy.after}
          </Dialog.Description>

          {preview ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-y border-slate-200 py-2 text-sm" data-testid="edit-preview-status">
              <span className="font-semibold text-slate-900">{previewCopy[preview.status]}</span>
              <span className="text-slate-500">
                {previewCopy.expires} {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(preview.expiresAt))}
              </span>
            </div>
          ) : null}

          {previewItem ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{previewCopy.before}</p>
                {before ? (
                  <dl className="mt-2 grid gap-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">{dict.transactions.tradeDateTerm}</dt>
                      <dd className="font-medium text-slate-900">{formatDateLabel(before.tradeDate, locale)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">{dict.transactions.quantityTerm}</dt>
                      <dd className="font-medium text-slate-900">{formatNumber(before.quantity, locale)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">{dict.transactions.unitPriceTerm}</dt>
                      <dd className="font-medium text-slate-900">{formatCurrencyAmount(before.unitPrice, before.priceCurrency, locale)}</dd>
                    </div>
                  </dl>
                ) : null}
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{previewCopy.after}</p>
                {after ? (
                  <dl className="mt-2 grid gap-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">{dict.transactions.tradeDateTerm}</dt>
                      <dd className="font-medium text-slate-900">{formatDateLabel(after.tradeDate, locale)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">{dict.transactions.quantityTerm}</dt>
                      <dd className="font-medium text-slate-900">{formatNumber(after.quantity, locale)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">{dict.transactions.unitPriceTerm}</dt>
                      <dd className="font-medium text-slate-900">{formatCurrencyAmount(after.unitPrice, after.priceCurrency, locale)}</dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            </div>
          ) : null}

          {preview?.warnings.length ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  {preview.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {preview?.blockers.length ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" data-testid="edit-negative-lots-warning">
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

          {isLoading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              <span>{dict.mutations.loadingPreview}</span>
            </div>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="edit-cancel-button" disabled={isSubmitting}>
              {dict.actions.cancel}
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              data-testid="edit-confirm-button"
              disabled={isLoading || isSubmitting || !preview || preview.status !== "ready" || preview.blockers.length > 0}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {dict.actions.submitting}
                </>
              ) : dict.mutations.editSaveButton}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
