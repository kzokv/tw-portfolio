"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";
import type { AppDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";

interface FeeRecalcConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecalculate: () => void;
  onKeepManual: () => void;
  dict: AppDictionary;
}

export function FeeRecalcConfirmDialog({
  open,
  onOpenChange,
  onRecalculate,
  onKeepManual,
  dict,
}: FeeRecalcConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/82" />
        <Dialog.Content
          className="glass-panel !fixed left-1/2 top-1/2 z-[71] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-5 shadow-glass focus:outline-none sm:p-6"
          data-testid="fee-recalc-dialog"
        >
          <div className="mb-3 flex items-start gap-2 text-amber-600">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <Dialog.Title className="text-base font-semibold text-ink">
                {dict.mutations.feeRecalcTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-600">
                {dict.mutations.feeRecalcDescription}
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onKeepManual} data-testid="fee-keep-manual-button">
              {dict.mutations.feeKeepManualButton}
            </Button>
            <Button type="button" onClick={onRecalculate} data-testid="fee-recalc-button">
              {dict.mutations.feeRecalcButton}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
