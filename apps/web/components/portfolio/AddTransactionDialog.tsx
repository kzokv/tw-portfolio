"use client";

import type { LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import type { TransactionPriceHint } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { TransactionEstimateResponse } from "../../features/portfolio/services/portfolioService";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/shadcn/dialog";
import { AddTransactionCard, type TransactionAccountOption } from "./AddTransactionCard";
import type { TransactionInput } from "./types";

interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: TransactionInput;
  onChange: (next: TransactionInput) => void;
  onUnitPriceEdited?: () => void;
  onSubmit: () => Promise<void>;
  pending: boolean;
  accountOptions: TransactionAccountOption[];
  message: string;
  errorMessage: string;
  dict: AppDictionary;
  locale: LocaleCode;
  priceHint: TransactionPriceHint | null;
  showPriceUnavailableHint: boolean;
  feeEstimate: TransactionEstimateResponse | null;
}

/**
 * Phase 3e (§4) — dialog wrapper for `<AddTransactionCard>` that opens via
 * the ⌘K palette's `transaction.add` action. Built on shadcn `Dialog`
 * (Radix Dialog under the hood) for consistent styling with the rest of
 * Phase 3.
 *
 * Locked testid: `add-transaction-dialog` (per spec §4). Interior testids
 * inside `<AddTransactionCard>` are preserved unchanged so existing form
 * specs continue to work when driven from inside the dialog.
 *
 * Distinct from `RecordTransactionDialog` (legacy `record-transaction-dialog`
 * testid) — that dialog is opened from per-row action menus and kept under
 * the legacy testid for compatibility with existing specs. This dialog is
 * the ⌘K entry point only.
 */
export function AddTransactionDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onUnitPriceEdited,
  onSubmit,
  pending,
  accountOptions,
  message,
  errorMessage,
  dict,
  locale,
  priceHint,
  showPriceUnavailableHint,
  feeEstimate,
}: AddTransactionDialogProps) {
  const title = dict.transactions.title;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="add-transaction-dialog"
        className="max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{dict.transactions.description}</DialogDescription>
        </DialogHeader>
        <AddTransactionCard
          value={value}
          accountOptions={accountOptions}
          pending={pending}
          onChange={onChange}
          onUnitPriceEdited={onUnitPriceEdited}
          onSubmit={onSubmit}
          dict={dict}
          locale={locale}
          framed={false}
          showHeader={false}
          priceHint={priceHint}
          showPriceUnavailableHint={showPriceUnavailableHint}
          feeEstimate={feeEstimate}
        />
        {message ? (
          <p role="status" aria-live="polite" className="mt-3 text-sm text-emerald-700">
            {message}
          </p>
        ) : null}
        {errorMessage ? (
          <p role="status" aria-live="polite" className="mt-3 text-sm text-rose-700">
            {errorMessage}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
