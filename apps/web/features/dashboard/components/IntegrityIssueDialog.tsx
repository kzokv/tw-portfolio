"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";
import type { IntegrityIssue } from "../types";

interface IntegrityIssueDialogProps {
  issue: IntegrityIssue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
  dict: AppDictionary;
}

export function IntegrityIssueDialog({
  issue,
  open,
  onOpenChange,
  onOpenSettings,
  dict,
}: IntegrityIssueDialogProps) {
  if (!issue) {
    return null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/82" />
        <Dialog.Content
          className="glass-panel !fixed left-1/2 top-1/2 z-[71] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-5 shadow-glass focus:outline-none sm:p-6"
          data-testid="integrity-dialog"
        >
          <div className="mb-3 flex items-start gap-2 text-rose-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <Dialog.Title className="text-base font-semibold text-ink">{dict.dialogs.integrityTitle}</Dialog.Title>
              <Dialog.Description className="text-sm text-rose-100/80">{dict.dialogs.integrityDescription}</Dialog.Description>
            </div>
          </div>

          <p className="rounded-[18px] border border-[rgba(251,113,133,0.35)] bg-[rgba(251,113,133,0.12)] px-3 py-2 text-sm text-rose-100">
            {issue.message}
          </p>

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {dict.actions.dismiss}
            </Button>
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onOpenSettings();
              }}
            >
              {dict.actions.openSettings}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
