"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { SymbolOptionDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import type { TransactionInput } from "./types";
import { AddTransactionCard } from "./AddTransactionCard";

interface RecordTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: TransactionInput;
  onChange: (next: TransactionInput) => void;
  onSubmit: () => Promise<void>;
  pending: boolean;
  accountOptions: Array<{ id: string; name: string }>;
  symbolOptions: SymbolOptionDto[];
  message: string;
  errorMessage: string;
  title: string;
  dict: AppDictionary;
}

export function RecordTransactionDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onSubmit,
  pending,
  accountOptions,
  symbolOptions,
  message,
  errorMessage,
  title,
  dict,
}: RecordTransactionDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/82" />
        <Dialog.Content
          className="glass-panel !fixed left-1/2 top-1/2 z-[71] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-5 shadow-glass focus:outline-none sm:p-6"
          data-testid="record-transaction-dialog"
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <AddTransactionCard
            value={value}
            accountOptions={accountOptions}
            symbolOptions={symbolOptions}
            pending={pending}
            onChange={onChange}
            onSubmit={onSubmit}
            dict={dict}
            framed={false}
          />
          {message && (
            <p role="status" aria-live="polite" className="mt-3 text-sm text-emerald-700">{message}</p>
          )}
          {errorMessage && (
            <p role="status" aria-live="polite" className="mt-3 text-sm text-rose-700">{errorMessage}</p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
