"use client";

import type { LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount } from "../../lib/utils";
import { Button } from "../ui/Button";
import { fieldClassName } from "../ui/fieldStyles";
import type { AccountWithLiveBalance } from "../../features/cash-ledger/services/cashLedgerService";
import type { FxTransferEstimate } from "../../features/fx-transfer/services/fxTransferService";
import { FxRateGauge } from "./FxRateGauge";
import { FxTransferSummaryBox } from "./FxTransferSummaryBox";

export interface FxTransferFormValue {
  fromAccountId: string;
  toAccountId: string;
  fromAmount: string;
  toAmount: string;
  effectiveRate: string;
  entryDate: string;
  notes: string;
}

interface AddFxTransferCardProps {
  mode: "create" | "edit";
  value: FxTransferFormValue;
  accounts: AccountWithLiveBalance[];
  pending: boolean;
  estimate: FxTransferEstimate | null;
  estimateLoading: boolean;
  estimateError: string;
  submitDisabled: boolean;
  message: string;
  errorMessage: string;
  onChange: (next: FxTransferFormValue) => void;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
  dict: AppDictionary;
  locale: LocaleCode;
}

function numberFromInput(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatInputNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return String(Number(value.toFixed(decimals)));
}

function accountBalance(account: AccountWithLiveBalance): number {
  return account.liveBalance?.find((entry) => entry.currency === account.defaultCurrency)?.amount ?? 0;
}

function accountOptionLabel(account: AccountWithLiveBalance, dict: AppDictionary, locale: LocaleCode): string {
  return dict.cashLedger.fxAccountOption
    .replace("{name}", account.name)
    .replace("{balance}", formatCurrencyAmount(accountBalance(account), account.defaultCurrency, locale))
    .replace("{currency}", account.defaultCurrency);
}

export function AddFxTransferCard({
  mode,
  value,
  accounts,
  pending,
  estimate,
  estimateLoading,
  estimateError,
  submitDisabled,
  message,
  errorMessage,
  onChange,
  onSubmit,
  onCancel,
  dict,
  locale,
}: AddFxTransferCardProps) {
  const d = dict.cashLedger;
  const fromAccount = accounts.find((account) => account.id === value.fromAccountId);
  const toAccount = accounts.find((account) => account.id === value.toAccountId);
  const fromCurrency = fromAccount?.defaultCurrency ?? "";
  const toCurrency = toAccount?.defaultCurrency ?? "";
  const toAmount = numberFromInput(value.toAmount);
  const effectiveRate = numberFromInput(value.effectiveRate);
  const accountFieldsDisabled = mode === "edit" || pending;
  // Hide the chosen counterparty from the opposite dropdown so the user cannot
  // pick the same account on both sides. The server still rejects with
  // `fx_transfer_same_account` as a defense-in-depth guard.
  const fromAccountChoices = accounts.filter((account) => account.id !== value.toAccountId);
  const toAccountChoices = accounts.filter((account) => account.id !== value.fromAccountId);

  function setField<K extends keyof FxTransferFormValue>(key: K, nextValue: FxTransferFormValue[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  function setFromAmount(raw: string) {
    const next = { ...value, fromAmount: raw };
    const nextFrom = numberFromInput(raw);
    const rate = numberFromInput(value.effectiveRate);
    if (nextFrom > 0 && rate > 0) next.toAmount = formatInputNumber(nextFrom * rate, 2);
    onChange(next);
  }

  function setToAmount(raw: string) {
    const next = { ...value, toAmount: raw };
    const nextTo = numberFromInput(raw);
    const nextFrom = numberFromInput(value.fromAmount);
    if (nextTo > 0 && nextFrom > 0) next.effectiveRate = formatInputNumber(nextTo / nextFrom, 8);
    onChange(next);
  }

  function setEffectiveRate(raw: string) {
    const next = { ...value, effectiveRate: raw };
    const rate = numberFromInput(raw);
    const nextFrom = numberFromInput(value.fromAmount);
    if (rate > 0 && nextFrom > 0) next.toAmount = formatInputNumber(nextFrom * rate, 2);
    onChange(next);
  }

  return (
    <form
      className="grid max-h-[min(86vh,760px)] gap-5 overflow-y-auto pr-1"
      data-testid="record-fx-transfer-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <div className="min-w-0">
        <h2 className="text-xl leading-tight text-slate-950 sm:text-2xl">
          {mode === "edit" ? d.fxFormTitleEdit : d.fxFormTitleCreate}
        </h2>
        <p className="mt-2 break-words text-sm leading-6 text-slate-600">{d.fxFormSubtitle}</p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <fieldset className="min-w-0 rounded-2xl border border-slate-200 bg-white/70 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {d.fxFromSection}
          </legend>
          <label className="mt-2 block min-w-0 space-y-2 text-sm">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{d.fxFromAccount}</span>
            <select
              value={value.fromAccountId}
              disabled={accountFieldsDisabled}
              onChange={(event) => setField("fromAccountId", event.target.value)}
              className={fieldClassName}
              data-testid="fx-from-account-select"
            >
              <option value="">—</option>
              {fromAccountChoices.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountOptionLabel(account, dict, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 block min-w-0 space-y-2 text-sm">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{d.fxAmount}</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={value.fromAmount}
              onChange={(event) => setFromAmount(event.target.value)}
              className={fieldClassName}
              data-testid="fx-from-amount-input"
            />
          </label>
        </fieldset>

        <fieldset className="min-w-0 rounded-2xl border border-slate-200 bg-white/70 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {d.fxToSection}
          </legend>
          <label className="mt-2 block min-w-0 space-y-2 text-sm">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{d.fxToAccount}</span>
            <select
              value={value.toAccountId}
              disabled={accountFieldsDisabled}
              onChange={(event) => setField("toAccountId", event.target.value)}
              className={fieldClassName}
              data-testid="fx-to-account-select"
            >
              <option value="">—</option>
              {toAccountChoices.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountOptionLabel(account, dict, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 block min-w-0 space-y-2 text-sm">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{d.fxAmount}</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={value.toAmount}
              onChange={(event) => setToAmount(event.target.value)}
              className={fieldClassName}
              data-testid="fx-to-amount-input"
            />
          </label>
        </fieldset>
      </div>

      <fieldset className="min-w-0 rounded-2xl border border-slate-200 bg-white/70 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          {d.fxExchangeRateSection}
        </legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="min-w-0 space-y-2 text-sm">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{d.fxRate}</span>
            <input
              type="number"
              min="0.00000001"
              step="0.00000001"
              value={value.effectiveRate}
              onChange={(event) => setEffectiveRate(event.target.value)}
              className={fieldClassName}
              data-testid="fx-rate-input"
            />
          </label>
          <label className="min-w-0 space-y-2 text-sm">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{d.fxDate}</span>
            <input
              type="date"
              value={value.entryDate}
              onChange={(event) => setField("entryDate", event.target.value)}
              className={fieldClassName}
              data-testid="fx-entry-date-input"
            />
          </label>
        </div>
        <div className="mt-4">
          <FxRateGauge estimate={estimate} effectiveRate={effectiveRate} dict={dict} />
        </div>
      </fieldset>

      <label className="min-w-0 space-y-2 text-sm">
        <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{d.fxNotes}</span>
        <textarea
          value={value.notes}
          onChange={(event) => setField("notes", event.target.value)}
          className={`${fieldClassName} min-h-20 resize-y`}
          data-testid="fx-notes-input"
        />
      </label>

      <FxTransferSummaryBox
        fromCurrency={fromCurrency}
        toCurrency={toCurrency}
        toAmount={toAmount}
        effectiveRate={effectiveRate}
        estimate={estimate}
        loading={estimateLoading}
        error={estimateError}
        dict={dict}
        locale={locale}
      />

      {message ? <p role="status" className="text-sm text-emerald-700">{message}</p> : null}
      {errorMessage ? <p role="status" className="text-sm text-rose-700">{errorMessage}</p> : null}

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={pending} data-testid="fx-transfer-cancel">
          {d.fxCancel}
        </Button>
        <Button type="submit" disabled={pending || submitDisabled} data-testid="fx-transfer-submit">
          {pending ? d.fxSaving : mode === "edit" ? d.fxUpdate : d.fxSave}
        </Button>
      </div>
    </form>
  );
}
