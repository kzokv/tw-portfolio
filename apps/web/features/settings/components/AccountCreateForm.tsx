"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Building2, Landmark, Wallet } from "lucide-react";
import type {
  AccountDefaultCurrency,
  AccountDto,
  AccountType,
  FeeProfileDto,
} from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { ApiError } from "../../../lib/api";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import {
  formatAccountOption,
  type AccountTypeLabels,
} from "../../cash-ledger/utils/accountOptions";
import type { CreateAccountInput } from "../../cash-ledger/services/cashLedgerService";

/**
 * KZO-179 — Add-account form. Lives at the top of the Accounts tab in the
 * settings drawer, above the relocated `AccountsListSection`.
 *
 * Visual contract (D13):
 * - Type pills use `lucide-react` icons (Building2 / Landmark / Wallet).
 * - Currency cards are button-style with `ring-2 ring-indigo-300` selected.
 * - Live-preview chip imports `formatAccountOption` from cash-ledger utils
 *   (DO NOT duplicate per `nextjs-i18n-serialization.md`).
 *
 * Picker conditional (D5): the fee-profile dropdown only renders when more
 * than one profile exists; otherwise the route resolves the default silently.
 *
 * Submit flow (D12): `await onCreate(input); onAccountsRefresh(); resetForm();`.
 */
const ACCOUNT_TYPES: ReadonlyArray<AccountType> = ["broker", "bank", "wallet"];
const ACCOUNT_CURRENCIES: ReadonlyArray<AccountDefaultCurrency> = ["TWD", "USD", "AUD"];

const TYPE_ICONS: Record<AccountType, typeof Building2> = {
  broker: Building2,
  bank: Landmark,
  wallet: Wallet,
};

interface AccountCreateFormProps {
  feeProfiles: FeeProfileDto[];
  // Returns the new account on success; the form ignores the resolved value
  // and signals refresh via `onAccountsRefresh`. Matches the
  // `createAccount` web service shape (`Promise<AccountDto>`).
  onCreate: (input: CreateAccountInput) => Promise<AccountDto>;
  onAccountsRefresh: () => void;
  dict: AppDictionary;
}

export function AccountCreateForm({
  feeProfiles,
  onCreate,
  onAccountsRefresh,
  dict,
}: AccountCreateFormProps) {
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("broker");
  const [defaultCurrency, setDefaultCurrency] = useState<AccountDefaultCurrency>("TWD");
  const [feeProfileId, setFeeProfileId] = useState<string>(
    feeProfiles[0]?.id ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const showProfilePicker = feeProfiles.length > 1;
  const trimmedName = name.trim();
  const submitDisabled = trimmedName.length === 0 || submitting;

  const typeLabels: AccountTypeLabels = useMemo(
    () => ({
      accountTypeBroker: dict.cashLedger.accountTypeBroker,
      accountTypeBank: dict.cashLedger.accountTypeBank,
      accountTypeWallet: dict.cashLedger.accountTypeWallet,
    }),
    [
      dict.cashLedger.accountTypeBroker,
      dict.cashLedger.accountTypeBank,
      dict.cashLedger.accountTypeWallet,
    ],
  );

  const previewLabel = useMemo(
    () =>
      trimmedName.length > 0
        ? formatAccountOption(
            { name: trimmedName, defaultCurrency, accountType },
            typeLabels,
          )
        : dict.settings.accountCreateNamePlaceholder,
    [
      trimmedName,
      defaultCurrency,
      accountType,
      typeLabels,
      dict.settings.accountCreateNamePlaceholder,
    ],
  );

  function resetForm() {
    setName("");
    setAccountType("broker");
    setDefaultCurrency("TWD");
    setFeeProfileId(feeProfiles[0]?.id ?? "");
    setErrorMessage("");
  }

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    if (event) {
      event.preventDefault();
    }
    if (submitDisabled) {
      return;
    }

    const input: CreateAccountInput = {
      name: trimmedName,
      defaultCurrency,
      accountType,
    };
    if (showProfilePicker && feeProfileId) {
      input.feeProfileId = feeProfileId;
    }

    setErrorMessage("");
    setSubmitting(true);
    try {
      await onCreate(input);
      onAccountsRefresh();
      resetForm();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setErrorMessage(dict.settings.accountCreateNameInUseError);
      } else {
        setErrorMessage(dict.settings.accountCreateGenericError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function typePillClassName(active: boolean): string {
    return [
      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition",
      active
        ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-300"
        : "border-slate-200 bg-white/85 text-slate-600 hover:border-slate-300",
    ].join(" ");
  }

  function currencyCardClassName(active: boolean): string {
    return [
      "flex flex-col items-center justify-center rounded-[18px] border px-4 py-3 text-sm font-medium transition",
      active
        ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-300"
        : "border-slate-200 bg-white/85 text-slate-700 hover:border-slate-300",
    ].join(" ");
  }

  function typeLabelFor(type: AccountType): string {
    switch (type) {
      case "broker": return dict.cashLedger.accountTypeBroker;
      case "bank": return dict.cashLedger.accountTypeBank;
      case "wallet": return dict.cashLedger.accountTypeWallet;
    }
  }

  const titleId = "account-create-form-title";

  return (
    <section
      aria-labelledby={titleId}
      className="glass-inset space-y-4 rounded-[24px] p-4"
      data-testid="account-create-form"
    >
      <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-1">
          <h3 id={titleId} className="text-lg font-semibold text-ink">
            {dict.settings.accountCreateTitle}
          </h3>
        </div>

      {/* Name input */}
      <label className="space-y-1 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {dict.settings.accountCreateNameLabel}
        </span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder={dict.settings.accountCreateNamePlaceholder}
          className={fieldClassName}
          data-testid="account-create-name-input"
        />
      </label>

      {/* Type pills */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {dict.settings.accountCreateTypeLabel}
        </legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {ACCOUNT_TYPES.map((type) => {
            const Icon = TYPE_ICONS[type];
            const active = accountType === type;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setAccountType(type)}
                className={typePillClassName(active)}
                data-testid={`account-create-type-${type}`}
              >
                <Icon className="h-4 w-4" />
                <span>{typeLabelFor(type)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Currency cards */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {dict.settings.accountCreateCurrencyLabel}
        </legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
          {ACCOUNT_CURRENCIES.map((currency) => {
            const active = defaultCurrency === currency;
            return (
              <button
                key={currency}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDefaultCurrency(currency)}
                className={currencyCardClassName(active)}
                data-testid={`account-create-currency-${currency}`}
              >
                {currency}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Currency-lock callout */}
      <p
        className="rounded-[14px] bg-blue-50 px-3 py-2 text-xs text-blue-700"
        data-testid="account-create-currency-lock"
      >
        {dict.settings.accountCreateCurrencyLockBody}
      </p>

      {/* Optional fee-profile picker (D5) */}
      {showProfilePicker ? (
        <label className="space-y-1 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {dict.settings.accountCreateFeeProfileLabel}
          </span>
          <select
            value={feeProfileId}
            onChange={(event) => setFeeProfileId(event.target.value)}
            className={fieldClassName}
            data-testid="account-create-fee-profile-select"
          >
            {feeProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {/* Live-preview chip */}
      <div className="space-y-1 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {dict.settings.accountCreatePreviewLabel}
        </span>
        <div
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-xs text-slate-700"
          data-testid="account-create-preview-chip"
        >
          {previewLabel}
        </div>
      </div>

      {/* Inline error */}
      {errorMessage ? (
        <p
          className="text-xs text-rose-500"
          data-testid="account-create-error"
        >
          {errorMessage}
        </p>
      ) : null}

      {/* Submit */}
      <div>
        <Button
          type="submit"
          disabled={submitDisabled}
          data-testid="account-create-submit"
        >
          {dict.settings.accountCreateSubmit}
        </Button>
      </div>
      </form>
    </section>
  );
}
