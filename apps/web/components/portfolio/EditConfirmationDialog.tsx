"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";
import type { LocaleCode, PreviewImpactResponse } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { formatNumber } from "../../lib/utils";
import { Button } from "../ui/Button";

interface EditConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: PreviewImpactResponse | null;
  isLoading: boolean;
  dict: AppDictionary;
  locale: LocaleCode;
}

export function EditConfirmationDialog({
  open,
  onOpenChange,
  preview,
  isLoading,
  dict,
  locale,
}: EditConfirmationDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/82" />
        <Dialog.Content
          className="glass-panel !fixed left-1/2 top-1/2 z-[71] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-5 shadow-glass focus:outline-none sm:p-6"
          data-testid="edit-confirmation-dialog"
        >
          <Dialog.Title className="text-base font-semibold text-ink">
            {dict.mutations.editConfirmTitle}
          </Dialog.Title>

          {preview?.negativeLots.wouldOccur && (
            <div
              className="mt-3 rounded-[18px] border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
              data-testid="edit-negative-lots-warning"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {dict.mutations.editNegativeLotsWarning
                    .replace("{quantity}", formatNumber(preview.negativeLots.resultingQuantity, locale))
                    .replace("{symbol}", preview.negativeLots.symbol)}
                </p>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              <span>Loading preview...</span>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="edit-cancel-button">
              {dict.actions.cancel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
