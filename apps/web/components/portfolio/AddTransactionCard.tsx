"use client";

import type { LocaleCode } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount, formatDateLabel } from "../../lib/utils";
import { TooltipInfo } from "../ui/TooltipInfo";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { fieldClassName } from "../ui/fieldStyles";
import type { TransactionInput } from "./types";
import { InstrumentCombobox } from "./InstrumentCombobox";
import type { TransactionPriceHint } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { TransactionEstimateResponse } from "../../features/portfolio/services/portfolioService";

export interface TransactionAccountOption {
  id: string;
  name: string;
  feeProfileName: string;
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
  tickerReadOnly?: boolean;
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
  tickerReadOnly = false,
  priceHint,
  showPriceUnavailableHint,
  feeEstimate,
}: AddTransactionCardProps) {
  function setField<K extends keyof TransactionInput>(key: K, nextValue: TransactionInput[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  const selectedAccount = accountOptions.find((account) => account.id === value.accountId);
  const accountSelectTitle = selectedAccount ? formatAccountOptionLabel(selectedAccount) : "";

  const content = (
    <>
      <div className="mb-5 min-w-0">
        <h2 className="text-xl leading-tight text-slate-950 sm:text-2xl md:text-[2rem]">{dict.transactions.title}</h2>
        <p className="mt-3 break-words text-sm leading-6 text-slate-600">{dict.transactions.description}</p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="min-w-0 space-y-2 text-sm" data-testid="account-selector">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.accountTerm}</span>
            <TooltipInfo
              label={dict.transactions.accountTerm}
              content={dict.tooltips.txAccount}
              triggerTestId="tooltip-tx-account-trigger"
              contentTestId="tooltip-tx-account-content"
            />
          </span>
          <select
            value={value.accountId}
            onChange={(event) => setField("accountId", event.target.value)}
            title={accountSelectTitle}
            className={fieldClassName}
            data-testid="tx-account-select"
          >
            {accountOptions.map((account) => (
              <option key={account.id} value={account.id}>
                {formatAccountOptionLabel(account)}
              </option>
            ))}
          </select>
        </label>

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
            onSelect={(ticker) => setField("ticker", ticker)}
            dict={dict}
            readOnly={tickerReadOnly}
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
          <input
            value={value.priceCurrency}
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
        <Button onClick={() => onSubmit()} disabled={pending} data-testid="tx-submit-button" className="w-full whitespace-normal text-center sm:w-auto">
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
