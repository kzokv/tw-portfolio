"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  AccountDefaultCurrency,
  AccountType,
  CurrencyCode,
  LocaleCode,
  MarketCode,
} from "@vakwen/shared-types";
import { currencyFor, marketCodeFor } from "@vakwen/shared-types";
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

// KZO-169: chip surface forces an explicit market choice. ui-enhancement
// (2026-05-13) removed the "All" chip from the Record Transaction surface:
// the chip now always commits a concrete `MarketCode` and is one-way driven
// from the selected account's `defaultCurrency`. (The Settings → Tickers
// catalog browser keeps its ALL chip — see `InstrumentCatalogSheet`.)
// `MarketChip` keeps `null` as an *internal* state for the brief window
// between mount and first account/derivation; user-visible chips are always
// `MarketCode` literals. `MARKET_CHIPS` no longer contains `null`.
export type MarketChip = MarketCode | null;

const MARKET_CHIPS: ReadonlyArray<MarketCode> = ["TW", "US", "AU"];

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

// ui-enhancement (2026-05-13) — scope item 21: the default chip is the
// first account's market (formerly: only-currency-or-null). Empty list
// falls back to "TW" so the form always commits a concrete `MarketCode`
// for new users before they create an account. Locale-agnostic — the
// first-account heuristic mirrors how the dropdown lists accounts.
export function deriveDefaultMarketChip(
  accounts: ReadonlyArray<{ defaultCurrency: AccountDefaultCurrency }>,
): MarketCode {
  if (accounts.length === 0) {
    return "TW";
  }
  try {
    return marketCodeFor(accounts[0].defaultCurrency);
  } catch {
    return "TW";
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

function chipLabel(dict: AppDictionary, chip: MarketCode): string {
  if (chip === "TW") return dict.transactions.marketChipTW;
  if (chip === "US") return dict.transactions.marketChipUS;
  return dict.transactions.marketChipAU;
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

  // KZO-169 + ui-enhancement: chip lives at the top of the form. Initial
  // value derives from the first account's market (or TW fallback for the
  // zero-account state). The chip is one-way driven from the selected
  // account but remains user-overridable via `handleChipChange` until the
  // account changes again. `explicitChip` records the user's override (if
  // any) so it survives reconciliation effects.
  const [explicitChip, setExplicitChip] = useState<MarketCode | undefined>(undefined);
  const defaultChip = useMemo(
    () => deriveDefaultMarketChip(accountOptions),
    [accountOptions],
  );
  const activeChip: MarketCode = explicitChip !== undefined
    ? explicitChip
    : (value.marketCode ?? defaultChip);

  // ui-enhancement: chip is always a concrete `MarketCode` (ALL chip
  // removed from this surface). Derived trade currency follows it directly.
  const derivedMarket: MarketCode = activeChip;
  const derivedCurrency: AccountDefaultCurrency = currencyFor(derivedMarket);

  // ui-enhancement (2026-05-13) — scope items 22–23 enforce a one-way
  // `account → chip` binding. Previously (KZO-169) the dropdown was
  // filtered to currency-compatible accounts (`chip → account`); that
  // direction is now removed. The dropdown lists ALL of the user's
  // accounts; picking one drives the chip via the auto-sync effect
  // below. `filterAccountsByDerivedCurrency` stays exported because
  // older callers (and tests) still use the helper.
  const dropdownAccounts = accountOptions;
  const noCompatibleAccount = accountOptions.length === 0;

  // KZO-169: priceCurrency input becomes purely derived. We mirror it back
  // into form state so consumers (history table, recompute) read a real value.
  const displayCurrency: CurrencyCode | "" = derivedCurrency;

  // ui-enhancement (2026-05-13) — scope items 22–23: account → chip is a
  // one-way binding. When the user selects a new account, the chip syncs
  // to that account's market AND the committed ticker clears (the user is
  // about to pick a new instrument scoped to the new market).
  //
  // `prevAccountIdRef` is a `useRef` (not state) so updating it does NOT
  // re-trigger this effect; we only want to fire the auto-sync once per
  // *real* user-driven account change. The ref starts at the initial
  // accountId so first-mount does NOT trigger a spurious clear — a
  // freshly-loaded form with `value.accountId="acc-tw"` is already in
  // sync, not a "new account selection". Branch 2's chip/currency
  // reconcile still runs every render via the same effect.
  const prevAccountIdRef = useRef<string>(value.accountId);
  useEffect(() => {
    // Branch 1 — user-driven account change → chip auto-sync + ticker clear.
    if (value.accountId && value.accountId !== prevAccountIdRef.current) {
      prevAccountIdRef.current = value.accountId;
      const account = accountOptions.find((a) => a.id === value.accountId);
      if (account) {
        let nextMarket: MarketCode | null = null;
        try {
          nextMarket = marketCodeFor(account.defaultCurrency);
        } catch {
          // fall through to branch 2
        }
        if (nextMarket) {
          const formChanged =
            value.marketCode !== nextMarket
            || value.ticker.length > 0
            || value.priceCurrency !== currencyFor(nextMarket);
          setExplicitChip(nextMarket);
          if (formChanged) {
            onChange({
              ...value,
              marketCode: nextMarket,
              ticker: "",
              priceCurrency: currencyFor(nextMarket),
            });
          }
          return; // defer reconcile to next render
        }
      }
    }

    // Track even on no-op so re-selection of the same id later doesn't
    // double-fire after an intervening setValue from elsewhere.
    prevAccountIdRef.current = value.accountId;

    // Branch 2 — chip-driven priceCurrency reconcile. With the account
    // dropdown no longer filtered by chip, the chip can only change via
    // `handleChipChange`; that callback already handles its own clearing
    // of `value.ticker` / `value.marketCode`. We still need to mirror
    // `derivedCurrency` into `value.priceCurrency` so consumers see it.
    if (value.priceCurrency !== derivedCurrency) {
      onChange({ ...value, priceCurrency: derivedCurrency });
    }
  }, [
    derivedCurrency,
    value,
    onChange,
    accountOptions,
  ]);

  const selectedAccount = accountOptions.find((account) => account.id === value.accountId);
  const accountSelectTitle = selectedAccount ? formatAccountOptionLabel(selectedAccount) : "";

  const submitDisabled =
    pending ||
    !value.accountId ||
    !value.ticker.trim() ||
    !value.marketCode ||
    noCompatibleAccount;

  function handleChipChange(nextChip: MarketCode) {
    if (instrumentReadOnly) return;
    setExplicitChip(nextChip);
    const keepCommittedInstrument =
      value.ticker.trim().length > 0 &&
      value.marketCode !== null &&
      nextChip === value.marketCode;

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
  const createAccountHref = buildCreateAccountHref(pathname, derivedCurrency);

  // ui-enhancement (2026-05-13) — 4-tuple gate for fee/tax sections.
  // Replaces the old `feeEstimate ?` gate so the sections stay rendered
  // during transient `feeEstimate == null` states (price mismatch race,
  // pre-fetch). When the 4-tuple is satisfied the section renders; if
  // `feeEstimate == null` the estimate label degrades to "—" + the
  // sub-label "estimate unavailable" — override inputs stay editable.
  const feeTuplelComplete =
    value.accountId.length > 0
    && value.ticker.trim().length > 0
    && value.quantity > 0
    && value.unitPrice > 0;

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
            return (
              <button
                key={chip}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={instrumentReadOnly}
                onClick={() => handleChipChange(chip)}
                className={chipPillClassName(active, instrumentReadOnly)}
                data-testid={`tx-market-chip-${chip}`}
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
                  derivedCurrency,
                )}
              </span>
              <a
                href={createAccountHref}
                className="font-medium text-rose-700 underline hover:text-rose-900"
                data-testid="tx-create-account-link"
              >
                {dict.transactions.createAccountLink.replace(
                  "{currency}",
                  derivedCurrency,
                )}
              </a>
            </div>
          ) : (
            <select
              id={accountSelectId}
              value={value.accountId}
              onChange={(event) => setField("accountId", event.target.value)}
              title={accountSelectTitle}
              className={fieldClassName}
              data-testid="tx-account-select"
              disabled={dropdownAccounts.length === 0}
            >
              {dropdownAccounts.length === 0 ? (
                <option value="" disabled>
                  —
                </option>
              ) : null}
              {dropdownAccounts.map((account) => (
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

      {feeTuplelComplete ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section className="space-y-3 rounded-[20px] border border-slate-200 bg-slate-50/80 p-4" data-testid="commission-estimate-section">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{dict.transactions.commissionEstimateTitle}</p>
              <p className="text-sm font-medium text-slate-900" data-testid="commission-estimate-value">
                {feeEstimate
                  ? dict.transactions.estimatedLabel.replace(
                      "{amount}",
                      formatCurrencyAmount(feeEstimate.commissionAmount, value.priceCurrency, locale),
                    )
                  : dict.transactions.estimatedUnavailable}
              </p>
              {!feeEstimate ? (
                <p
                  className="text-[11px] text-slate-500"
                  data-testid="commission-estimate-unavailable"
                >
                  {dict.transactions.estimateUnavailableSubLabel}
                </p>
              ) : null}
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
                  {feeEstimate
                    ? dict.transactions.estimatedLabel.replace(
                        "{amount}",
                        formatCurrencyAmount(feeEstimate.taxAmount, value.priceCurrency, locale),
                      )
                    : dict.transactions.estimatedUnavailable}
                </p>
                {!feeEstimate ? (
                  <p
                    className="text-[11px] text-slate-500"
                    data-testid="tax-estimate-unavailable"
                  >
                    {dict.transactions.estimateUnavailableSubLabel}
                  </p>
                ) : null}
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
