"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { ApiError } from "../../lib/api";
import type { AccountWithLiveBalance } from "../../features/cash-ledger/services/cashLedgerService";
import { useFxTransferEstimate } from "../../features/fx-transfer/hooks/useFxTransferEstimate";
import {
  createFxTransfer,
  updateFxTransfer,
  type FxTransferInput,
} from "../../features/fx-transfer/services/fxTransferService";
import { AddFxTransferCard, type FxTransferFormValue } from "./AddFxTransferCard";

interface RecordFxTransferDialogProps {
  open: boolean;
  mode: "create" | "edit";
  fxTransferId?: string;
  initialValue?: FxTransferFormValue;
  accounts: AccountWithLiveBalance[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  dict: AppDictionary;
  locale: LocaleCode;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultValue(accounts: AccountWithLiveBalance[]): FxTransferFormValue {
  return {
    fromAccountId: accounts[0]?.id ?? "",
    toAccountId: accounts.find((account) => account.id !== accounts[0]?.id)?.id ?? "",
    fromAmount: "",
    toAmount: "",
    effectiveRate: "",
    entryDate: todayIso(),
    notes: "",
  };
}

function parseAmount(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInput(value: FxTransferFormValue): FxTransferInput {
  return {
    fromAccountId: value.fromAccountId,
    toAccountId: value.toAccountId,
    fromAmount: parseAmount(value.fromAmount),
    toAmount: parseAmount(value.toAmount),
    effectiveRate: parseAmount(value.effectiveRate),
    entryDate: value.entryDate,
    notes: value.notes.trim() || undefined,
  };
}

function isComplete(input: FxTransferInput): boolean {
  return (
    Boolean(input.fromAccountId) &&
    Boolean(input.toAccountId) &&
    Boolean(input.entryDate) &&
    input.fromAmount > 0 &&
    input.toAmount > 0 &&
    input.effectiveRate > 0
  );
}

export function RecordFxTransferDialog({
  open,
  mode,
  fxTransferId,
  initialValue,
  accounts,
  onOpenChange,
  onSaved,
  dict,
  locale,
}: RecordFxTransferDialogProps) {
  const [value, setValue] = useState<FxTransferFormValue>(() => initialValue ?? defaultValue(accounts));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setValue(initialValue ?? defaultValue(accounts));
    setPending(false);
    setMessage("");
    setErrorMessage("");
  }, [accounts, initialValue, open]);

  const input = useMemo(() => toInput(value), [value]);
  const estimateState = useFxTransferEstimate(input, locale);
  const submitDisabled = !isComplete(input) || estimateState.loading || estimateState.hardBlocked;

  async function submit(): Promise<void> {
    if (submitDisabled || pending) return;
    setPending(true);
    setErrorMessage("");
    setMessage("");
    try {
      if (mode === "edit" && fxTransferId) {
        await updateFxTransfer(fxTransferId, {
          fromAmount: input.fromAmount,
          toAmount: input.toAmount,
          effectiveRate: input.effectiveRate,
          entryDate: input.entryDate,
          notes: input.notes ?? null,
        });
        setMessage(dict.cashLedger.fxUpdatedMessage);
      } else {
        await createFxTransfer(input);
        setMessage(dict.cashLedger.fxCreatedMessage);
      }
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      setErrorMessage(cause instanceof ApiError ? cause.message : dict.cashLedger.fxGenericError);
    } finally {
      setPending(false);
    }
  }

  function cancel(): void {
    const baseline = initialValue ?? defaultValue(accounts);
    if (JSON.stringify(value) !== JSON.stringify(baseline)) {
      const discard = window.confirm(dict.cashLedger.fxDiscardConfirm);
      if (!discard) return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? onOpenChange(true) : cancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-foreground/80" />
        <Dialog.Content
          className="!fixed left-1/2 top-1/2 z-[71] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl focus:outline-none sm:p-6"
          data-testid="record-fx-transfer-dialog"
        >
          <Dialog.Title className="sr-only">
            {mode === "edit" ? dict.cashLedger.fxFormTitleEdit : dict.cashLedger.fxFormTitleCreate}
          </Dialog.Title>
          <AddFxTransferCard
            mode={mode}
            value={value}
            accounts={accounts}
            pending={pending}
            estimate={estimateState.estimate}
            estimateLoading={estimateState.loading}
            estimateError={estimateState.error}
            submitDisabled={submitDisabled}
            message={message}
            errorMessage={errorMessage}
            onChange={setValue}
            onSubmit={submit}
            onCancel={cancel}
            dict={dict}
            locale={locale}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
