"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { LocaleCode, SellAvailabilityDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import type { TransactionPriceHint } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { TransactionEstimateResponse } from "../../features/portfolio/services/portfolioService";
import type { TransactionInput } from "./types";
import { AddTransactionCard, type TransactionAccountOption } from "./AddTransactionCard";

interface RecordTransactionDialogProps {
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
  title: string;
  dict: AppDictionary;
  locale: LocaleCode;
  // KZO-169 (D9a): rename `tickerReadOnly` → `instrumentReadOnly`. Locks chip
  // AND ticker so edit-mode cannot change market or symbol.
  instrumentReadOnly?: boolean;
  priceHint: TransactionPriceHint | null;
  showPriceUnavailableHint: boolean;
  feeEstimate: TransactionEstimateResponse | null;
  sellAvailability?: SellAvailabilityDto | null;
  sellAvailabilityRequestKey?: string | null;
  isSellAvailabilityLoading?: boolean;
  sellAvailabilityTransportError?: string;
}

export function RecordTransactionDialog({
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
  title,
  dict,
  locale,
  instrumentReadOnly = false,
  priceHint,
  showPriceUnavailableHint,
  feeEstimate,
  sellAvailability = null,
  sellAvailabilityRequestKey = null,
  isSellAvailabilityLoading = false,
  sellAvailabilityTransportError = "",
}: RecordTransactionDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-foreground/80" />
        <Dialog.Content
          className="!fixed left-1/2 top-1/2 z-[71] max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl focus:outline-none sm:p-6"
          data-testid="record-transaction-dialog"
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
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
            instrumentReadOnly={instrumentReadOnly}
            priceHint={priceHint}
            showPriceUnavailableHint={showPriceUnavailableHint}
            feeEstimate={feeEstimate}
            sellAvailability={sellAvailability}
            sellAvailabilityRequestKey={sellAvailabilityRequestKey}
            isSellAvailabilityLoading={isSellAvailabilityLoading}
            sellAvailabilityTransportError={sellAvailabilityTransportError}
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
