import type { SymbolOptionDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { TooltipInfo } from "../ui/TooltipInfo";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { fieldClassName } from "../ui/fieldStyles";
import type { TransactionInput } from "./types";

interface AddTransactionCardProps {
  value: TransactionInput;
  accountOptions: Array<{ id: string; name: string }>;
  symbolOptions: SymbolOptionDto[];
  pending: boolean;
  onChange: (next: TransactionInput) => void;
  onSubmit: () => Promise<void>;
  dict: AppDictionary;
  framed?: boolean;
}

export function AddTransactionCard({
  value,
  accountOptions,
  symbolOptions,
  pending,
  onChange,
  onSubmit,
  dict,
  framed = true,
}: AddTransactionCardProps) {
  function setField<K extends keyof TransactionInput>(key: K, nextValue: TransactionInput[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  const selectedAccount = accountOptions.find((a) => a.id === value.accountId);
  const accountSelectTitle = selectedAccount ? `${selectedAccount.name} (${selectedAccount.id})` : "";
  const normalizedSymbol = value.symbol.trim().toUpperCase();
  const selectedSymbol = symbolOptions.find((symbol) => symbol.ticker === normalizedSymbol) ?? symbolOptions[0];
  const symbolSelectTitle = selectedSymbol
    ? `${selectedSymbol.ticker} (${selectedSymbol.instrumentType}${selectedSymbol.marketCode ? ` / ${selectedSymbol.marketCode}` : ""})`
    : "";
  const content = (
    <>
      <div className="mb-5 min-w-0">
        <h2 className="text-xl leading-tight text-ink sm:text-2xl md:text-[2rem]">{dict.transactions.title}</h2>
        <p className="mt-3 break-words text-sm leading-6 text-slate-300">{dict.transactions.description}</p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
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
                {account.name} ({account.id})
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
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
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            <span className="min-w-0">{dict.transactions.symbolTerm}</span>
            <TooltipInfo
              label={dict.transactions.symbolTerm}
              content={dict.tooltips.txSymbol}
              triggerTestId="tooltip-tx-symbol-trigger"
              contentTestId="tooltip-tx-symbol-content"
            />
          </span>
          <select
            value={selectedSymbol?.ticker ?? value.symbol}
            onChange={(event) => setField("symbol", event.target.value)}
            title={symbolSelectTitle}
            className={fieldClassName}
            data-testid="tx-symbol-select"
          >
            {symbolOptions.map((symbol) => (
              <option key={`${symbol.marketCode ?? "na"}:${symbol.ticker}`} value={symbol.ticker}>
                {symbol.ticker} ({formatInstrumentTypeLabel(symbol.instrumentType)})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500">{dict.transactions.symbolHint}</p>
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
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
            value={value.quantity}
            onChange={(event) => setField("quantity", Number(event.target.value))}
            className={fieldClassName}
            data-testid="tx-quantity-input"
          />
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
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
            value={value.unitPrice}
            onChange={(event) => setField("unitPrice", Number(event.target.value))}
            className={fieldClassName}
            data-testid="tx-price-input"
          />
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
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
            className={`${fieldClassName} cursor-not-allowed bg-slate-950/70 text-slate-400`}
            data-testid="tx-price-currency-input"
          />
          <p className="text-[11px] text-slate-500">{dict.tooltips.txCurrency}</p>
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
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
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
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

function formatInstrumentTypeLabel(instrumentType: SymbolOptionDto["instrumentType"]): string {
  if (instrumentType === "STOCK") {
    return "Stock";
  }

  if (instrumentType === "BOND_ETF") {
    return "Bond ETF";
  }

  return "ETF";
}
