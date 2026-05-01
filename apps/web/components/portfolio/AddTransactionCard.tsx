"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type {
  AccountDefaultCurrency,
  AccountType,
  CurrencyCode,
  LocaleCode,
  MarketCode,
} from "@tw-portfolio/shared-types";
import { currencyFor, marketCodeFor } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel } from "../../lib/utils";
import { TooltipInfo } from "../ui/TooltipInfo";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { fieldClassName } from "../ui/fieldStyles";
import type { TransactionInput } from "./types";
import { InstrumentCombobox } from "./InstrumentCombobox";
import type { TransactionPriceHint } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { TransactionEstimateResponse } from "../../features/portfolio/services/portfolioService";

// KZO-169: chip surface forces an explicit market choice (or All). Default
// is derived from the user's account-currency mix per D8a:
//   - all accounts share one currency → that currency's MarketCode
//   - mixed-currency OR no accounts → "All"
// `null` means "All" mode (cross-market autocomplete with disambiguation).
export type MarketChip = MarketCode | null;

const MARKET_CHIPS: ReadonlyArray<MarketChip> = ["TW", "US", "AU", null];

export interface TransactionAccountOption {
  id: string;
  name: string;
  feeProfileName: string;
  // KZO-169: defaultCurrency drives chip default (D8a) AND filters the
  // dropdown to currency-compatible accounts (D8b). KZO-167 already
  // populates this field.
  defaultCurrency: AccountDefaultCurrency;
  accountType?: AccountType;
}

interface AddTransactionCardProps {
  value: TransactionInput;
  accountOptions: TransactionAccountOption[];
  pending: boolean;
  onChange: (next: TransactionInput) => void;
  onUnitPriceEdited?: () => void;
  onSubmit: () => Promise<void>;
  dict: AppDictionary;
  locale: LocaleCode;
  framed?: boolean;
  // KZO-169 (D9a): rename `tickerReadOnly` → `instrumentReadOnly`. Locks BOTH
  // the ticker combobox AND the chip in edit-mode.
  instrumentReadOnly?: boolean;
  priceHint: TransactionPriceHint | null;
  showPriceUnavailableHint: boolean;
  feeEstimate: TransactionEstimateResponse | null;
}

function formatAccountOptionLabel(account: TransactionAccountOption): string {
  if (!account.feeProfileName.trim()) {
    return account.name;
  }
  return `${account.name} — ${account.feeProfileName}`;
}

function parseOptionalNumber(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function resolvePriceHintCopy(dict: AppDictionary, locale: LocaleCode, hint: TransactionPriceHint): string {
  const formattedDate = formatDateLabel(hint.date, locale);
  if (hint.message === "exact") {
    return dict.priceHint.exact.replace("{date}", formattedDate);
  }
  if (hint.reason === "weekend") {
    return dict.priceHint.previous.weekend.replace("{date}", formattedDate);
  }
  return dict.priceHint.previous.no_bar.replace("{date}", formattedDate);
}

// KZO-169 (D8a): derive the chip default from the union of account currencies.
// Single-currency user → that market; mixed or empty → All.
export function deriveDefaultMarketChip(
  accounts: ReadonlyArray<{ defaultCurrency: AccountDefaultCurrency }>,
): MarketChip {
  if (accounts.length === 0) {
    return null;
  }
  const currencies = new Set(accounts.map((a) => a.defaultCurrency));
  if (currencies.size > 1) {
    return null;
  }
  const onlyCurrency = [...currencies][0];
  try {
    return marketCodeFor(onlyCurrency);
  } catch {
    return null;
  }
}

// KZO-169 (D8b): filter the account dropdown to accounts whose
// defaultCurrency matches the derived trade currency. ALL mode (no chip
// commit, no instrument commit) returns the full list — only locks down
// once the form has produced a definite trade currency.
export function filterAccountsByDerivedCurrency(
  accounts: ReadonlyArray<TransactionAccountOption>,
  derivedCurrency: AccountDefaultCurrency | null,
): TransactionAccountOption[] {
  if (derivedCurrency === null) {
    return [...accounts];
  }
  return accounts.filter((account) => account.defaultCurrency === derivedCurrency);
}

// KZO-169 (NC4): build a settings-drawer URL that pre-selects the Accounts
// tab AND pre-fills `defaultCurrency`. KZO-179's AccountCreateForm reads the
// `accountsPrefillCurrency` query param via SettingsDrawer wiring.
export function buildCreateAccountHref(
  pathname: string,
  currency: AccountDefaultCurrency,
): string {
  const params = new URLSearchParams();
  params.set("drawer", "settings");
  params.set("settingsTab", "accounts");
  params.set("accountsPrefillCurrency", currency);
  return `${pathname}?${params.toString()}`;
}

function chipPillClassName(active: boolean, disabled: boolean): string {
  return cn(
    "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] transition",
    active
      ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-300"
      : "border-slate-200 bg-white/85 text-slate-600 hover:border-slate-300",
    disabled && "cursor-not-allowed opacity-60",
  );
}

function chipLabel(dict: AppDictionary, chip: MarketChip): string {
  if (chip === "TW") return dict.transactions.marketChipTW;
  if (chip === "US") return dict.transactions.marketChipUS;
  if (chip === "AU") return dict.transactions.marketChipAU;
  return dict.transactions.marketChipAll;
}

export function AddTransactionCard({
  value,
  accountOptions,
  pending,
  onChange,
  onUnitPriceEdited,
  onSubmit,
  dict,
  locale,
  framed = true,
  instrumentReadOnly = false,
  priceHint,
  showPriceUnavailableHint,
  feeEstimate,
}: AddTransactionCardProps) {
  const accountSelectId = useId();

  function setField<K extends keyof TransactionInput>(key: K, nextValue: TransactionInput[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  // KZO-169: chip lives at the top of the form. Initial value is derived
  // from the user's account-currency mix. Keep the chip filter separate from
  // the committed instrument market so "All" can remain selected after the
  // user picks a specific market row.
  const [explicitChip, setExplicitChip] = useState<MarketChip | undefined>(undefined);
  const defaultChip = useMemo(
    () => deriveDefaultMarketChip(accountOptions),
    [accountOptions],
  );
  const activeChip: MarketChip = explicitChip !== undefined
    ? explicitChip
    : (value.marketCode ?? defaultChip);

  // Derived trade currency comes from the specific chip while browsing or
  // from the committed instrument in All mode.
  const derivedMarket = activeChip ?? value.marketCode;
  const derivedCurrency: AccountDefaultCurrency | null = derivedMarket ? currencyFor(derivedMarket) : null;
  const filteredAccounts = useMemo(
    () => filterAccountsByDerivedCurrency(accountOptions, derivedCurrency),
    [accountOptions, derivedCurrency],
  );

  // KZO-169 (D8b): reconcile derived fields in one pass. Splitting account
  // clearing and currency mirroring across separate effects lets stale
  // snapshots overwrite each other when a chip change invalidates both.
  const filteredAccountIds = useMemo(
    () => filteredAccounts.map((a) => a.id).join("|"),
    [filteredAccounts],
  );

  const noCompatibleAccount =
    derivedCurrency !== null && filteredAccounts.length === 0;

  // KZO-169: priceCurrency input becomes purely derived. We mirror it back
  // into form state so consumers (history table, recompute) read a real value.
  const displayCurrency: CurrencyCode | "" = derivedCurrency ?? value.priceCurrency ?? "";
  useEffect(() => {
    let nextValue: TransactionInput | null = null;
    if (value.accountId && !filteredAccountIds.split("|").includes(value.accountId)) {
      nextValue = { ...(nextValue ?? value), accountId: "" };
    }
    if (derivedCurrency && value.priceCurrency !== derivedCurrency) {
      nextValue = { ...(nextValue ?? value), priceCurrency: derivedCurrency };
    }
    if (nextValue) {
      onChange(nextValue);
    }
  }, [derivedCurrency, filteredAccountIds, value, onChange]);

  const selectedAccount = filteredAccounts.find((account) => account.id === value.accountId);
  const accountSelectTitle = selectedAccount ? formatAccountOptionLabel(selectedAccount) : "";

  const submitDisabled =
    pending ||
    !value.accountId ||
    !value.ticker.trim() ||
    !value.marketCode ||
    noCompatibleAccount;

  function handleChipChange(nextChip: MarketChip) {
    if (instrumentReadOnly) return;
    setExplicitChip(nextChip);
    const keepCommittedInstrument =
      value.ticker.trim().length > 0 &&
      value.marketCode !== null &&
      (nextChip === null || nextChip === value.marketCode);

    onChange({
      ...value,
      marketCode: keepCommittedInstrument ? value.marketCode : null,
      ticker: keepCommittedInstrument ? value.ticker : "",
    });
  }

  function handleInstrumentSelect(ticker: string, marketCode: MarketCode) {
    onChange({
      ...value,
      ticker,
      marketCode,
      // Currency derives from the committed instrument's market.
      priceCurrency: currencyFor(marketCode),
    });
  }

  // Pathname for the create-account link. Falls back to `/dashboard` so the
  // server-rendered HTML is stable in tests where `window` may be undefined.
  const pathname =
    typeof window !== "undefined" ? window.location.pathname : "/dashboard";
  const createAccountHref =
    derivedCurrency
      ? buildCreateAccountHref(pathname, derivedCurrency)
      : null;

  const content = (
    <>
      <div className="mb-5 min-w-0">
        <h2 className="text-xl leading-tight text-slate-950 sm:text-2xl md:text-[2rem]">{dict.transactions.title}</h2>
        <p className="mt-3 break-words text-sm leading-6 text-slate-600">{dict.transactions.description}</p>
      </div>

      {/* KZO-169: market_code chip selector. Sits above the existing fields per
          mockup. Disabled in edit mode (D9a). */}
      <fieldset
        className="mb-5 space-y-2"
        aria-disabled={instrumentReadOnly || undefined}
        data-testid="tx-market-chip-row"
      >
        <legend className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
          {dict.transactions.marketTerm}
        </legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={dict.transactions.marketTerm}>
          {MARKET_CHIPS.map((chip) => {
            const active = activeChip === chip;
            const chipKey = chip ?? "ALL";
            return (
              <button
                key={chipKey}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={instrumentReadOnly}
                onClick={() => handleChipChange(chip)}
                className={chipPillClassName(active, instrumentReadOnly)}
                data-testid={`tx-market-chip-${chipKey}`}
              >
                {chipLabel(dict, chip)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2 text-sm" data-testid="account-selector">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <label htmlFor={accountSelectId} className="min-w-0">
              {dict.transactions.accountTerm}
            </label>
            <TooltipInfo
              label={dict.transactions.accountTerm}
              content={dict.tooltips.txAccount}
              triggerTestId="tooltip-tx-account-trigger"
              contentTestId="tooltip-tx-account-content"
            />
          </span>
          {/* KZO-169 (D8c): when no account matches the derived currency, the
              dropdown slot is replaced by an inline error block with a
              create-account link that pre-fills the missing currency. */}
          {noCompatibleAccount ? (
            <div
              className="rounded-[14px] border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs text-rose-700"
              data-testid="tx-no-account-error"
              role="status"
              aria-live="polite"
            >
              <span>
                {dict.transactions.noAccountForCurrency.replace(
                  "{currency}",
                  derivedCurrency ?? "",
                )}
              </span>
              {createAccountHref ? (
                <a
                  href={createAccountHref}
                  className="font-medium text-rose-700 underline hover:text-rose-900"
                  data-testid="tx-create-account-link"
                >
                  {dict.transactions.createAccountLink.replace(
                    "{currency}",
                    derivedCurrency ?? "",
                  )}
                </a>
              ) : null}
            </div>
          ) : (
            <select
              id={accountSelectId}
              value={value.accountId}
              onChange={(event) => setField("accountId", event.target.value)}
              title={accountSelectTitle}
              className={fieldClassName}
              data-testid="tx-account-select"
              disabled={filteredAccounts.length === 0}
            >
              {filteredAccounts.length === 0 ? (
                <option value="" disabled>
                  —
                </option>
              ) : null}
              {filteredAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountOptionLabel(account)}
                </option>
              ))}
            </select>
          )}
        </div>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.typeTerm}</span>
            <TooltipInfo
              label={dict.transactions.typeTerm}
              content={dict.tooltips.txType}
              triggerTestId="tooltip-tx-type-trigger"
              contentTestId="tooltip-tx-type-content"
            />
          </span>
          <select
            value={value.type}
            onChange={(event) => setField("type", event.target.value as "BUY" | "SELL")}
            className={fieldClassName}
            data-testid="tx-type-select"
          >
            <option value="BUY">{dict.transactions.typeBuy}</option>
            <option value="SELL">{dict.transactions.typeSell}</option>
          </select>
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.tickerTerm}</span>
            <TooltipInfo
              label={dict.transactions.tickerTerm}
              content={dict.tooltips.txTicker}
              triggerTestId="tooltip-tx-symbol-trigger"
              contentTestId="tooltip-tx-symbol-content"
            />
          </span>
          <InstrumentCombobox
            value={value.ticker}
            selectedMarketCode={value.marketCode}
            marketCodeFilter={activeChip}
            onSelect={handleInstrumentSelect}
            dict={dict}
            readOnly={instrumentReadOnly}
          />
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.quantityTerm}</span>
            <TooltipInfo
              label={dict.transactions.quantityTerm}
              content={dict.tooltips.txQuantity}
              triggerTestId="tooltip-tx-quantity-trigger"
              contentTestId="tooltip-tx-quantity-content"
            />
          </span>
          <input
            type="number"
            min="1"
            step="1"
            value={value.quantity}
            onChange={(event) => setField("quantity", Number(event.target.value))}
            className={fieldClassName}
            data-testid="tx-quantity-input"
          />
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.unitPriceTerm}</span>
            <TooltipInfo
              label={dict.transactions.unitPriceTerm}
              content={dict.tooltips.txPrice}
              triggerTestId="tooltip-tx-price-trigger"
              contentTestId="tooltip-tx-price-content"
            />
          </span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={value.unitPrice}
            onChange={(event) => {
              onUnitPriceEdited?.();
              setField("unitPrice", Number(event.target.value));
            }}
            className={fieldClassName}
            data-testid="unit-price-input"
          />
          {priceHint ? (
            <p className="text-[11px] text-slate-500" data-testid="price-source-hint">
              {resolvePriceHintCopy(dict, locale, priceHint)}
            </p>
          ) : null}
          {showPriceUnavailableHint ? (
            <p className="text-[11px] text-rose-600" data-testid="price-unavailable-hint">
              {dict.priceHint.unavailable}
            </p>
          ) : null}
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.currencyTerm}</span>
            <TooltipInfo
              label={dict.transactions.currencyTerm}
              content={dict.tooltips.txCurrency}
              triggerTestId="tooltip-tx-currency-trigger"
              contentTestId="tooltip-tx-currency-content"
            />
          </span>
          {/* KZO-169: currency input is purely derived from the chip+ticker
              commit. Locked + display-only; no user override path. */}
          <input
            value={displayCurrency}
            readOnly
            disabled
            aria-readonly="true"
            aria-disabled="true"
            className={`${fieldClassName} cursor-not-allowed bg-slate-100 text-slate-500`}
            data-testid="tx-price-currency-input"
          />
          <p className="text-[11px] text-slate-500">{dict.tooltips.txCurrency}</p>
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.tradeDateTerm}</span>
            <TooltipInfo
              label={dict.transactions.tradeDateTerm}
              content={dict.tooltips.txTradeDate}
              triggerTestId="tooltip-tx-trade-date-trigger"
              contentTestId="tooltip-tx-trade-date-content"
            />
          </span>
          <input
            type="date"
            value={value.tradeDate}
            onChange={(event) => setField("tradeDate", event.target.value)}
            className={fieldClassName}
            data-testid="tx-trade-date-input"
          />
        </label>

        <label className="min-w-0 space-y-2 text-sm sm:col-span-2">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.dayTradeTerm}</span>
            <TooltipInfo
              label={dict.transactions.dayTradeTerm}
              content={dict.tooltips.txDayTrade}
              triggerTestId="tooltip-tx-day-trade-trigger"
              contentTestId="tooltip-tx-day-trade-content"
            />
          </span>
          <select
            value={value.isDayTrade ? "yes" : "no"}
            onChange={(event) => setField("isDayTrade", event.target.value === "yes")}
            className={fieldClassName}
            data-testid="tx-day-trade-select"
          >
            <option value="no">{dict.transactions.dayTradeNo}</option>
            <option value="yes">{dict.transactions.dayTradeYes}</option>
          </select>
        </label>
      </div>

      {feeEstimate ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section className="space-y-3 rounded-[20px] border border-slate-200 bg-slate-50/80 p-4" data-testid="commission-estimate-section">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{dict.transactions.commissionEstimateTitle}</p>
              <p className="text-sm font-medium text-slate-900" data-testid="commission-estimate-value">
                {dict.transactions.estimatedLabel.replace(
                  "{amount}",
                  formatCurrencyAmount(feeEstimate.commissionAmount, value.priceCurrency, locale),
                )}
              </p>
            </div>
            <input
              type="number"
              min="0"
              step="1"
              value={value.commissionAmount ?? ""}
              onChange={(event) => setField("commissionAmount", parseOptionalNumber(event.target.value))}
              className={fieldClassName}
              placeholder={dict.transactions.overrideAmountPlaceholder}
              data-testid="commission-override-input"
            />
          </section>

          {value.type === "SELL" ? (
            <section className="space-y-3 rounded-[20px] border border-slate-200 bg-slate-50/80 p-4" data-testid="tax-estimate-section">
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{dict.transactions.taxEstimateTitle}</p>
                <p className="text-sm font-medium text-slate-900" data-testid="tax-estimate-value">
                  {dict.transactions.estimatedLabel.replace(
                    "{amount}",
                    formatCurrencyAmount(feeEstimate.taxAmount, value.priceCurrency, locale),
                  )}
                </p>
              </div>
              <input
                type="number"
                min="0"
                step="1"
                value={value.taxAmount ?? ""}
                onChange={(event) => setField("taxAmount", parseOptionalNumber(event.target.value))}
                className={fieldClassName}
                placeholder={dict.transactions.overrideAmountPlaceholder}
                data-testid="tax-override-input"
              />
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 flex min-w-0 justify-end">
        <Button onClick={() => onSubmit()} disabled={submitDisabled} data-testid="tx-submit-button" className="w-full whitespace-normal text-center sm:w-auto">
          {pending ? dict.actions.submitting : dict.actions.submitTransaction}
        </Button>
      </div>
    </>
  );

  if (!framed) {
    return content;
  }

  return <Card>{content}</Card>;
}
