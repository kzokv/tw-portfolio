"use client";

import { Calculator } from "lucide-react";
import type { LocaleCode, RealizedPnlBreakdownDto, TransactionHistoryItemDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatNumber } from "../../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/shadcn/popover";

interface RealizedPnlBreakdownProps {
  breakdown: RealizedPnlBreakdownDto | null | undefined;
  dict: AppDictionary;
  locale: LocaleCode;
  triggerClassName?: string;
}

interface RealizedPnlValueProps extends RealizedPnlBreakdownProps {
  amount: number | null;
  currency: TransactionHistoryItemDto["priceCurrency"];
  toneClassName?: string;
}

export function RealizedPnlValue({
  amount,
  breakdown,
  currency,
  dict,
  locale,
  toneClassName,
}: RealizedPnlValueProps) {
  const formatted = amount === null
    ? dict.tickerHistory.noRealizedPnl
    : formatCurrencyAmount(amount, currency, locale);

  if (!breakdown) {
    return <span className={toneClassName}>{formatted}</span>;
  }

  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className={toneClassName}>{formatted}</span>
      <RealizedPnlBreakdownPopover breakdown={breakdown} dict={dict} locale={locale} />
    </span>
  );
}

export function RealizedPnlBreakdownPopover({
  breakdown,
  dict,
  locale,
  triggerClassName,
}: RealizedPnlBreakdownProps) {
  if (!breakdown) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground",
            triggerClassName,
          )}
          aria-label={dict.tickerHistory.realizedPnlBreakdownTrigger}
          data-testid="realized-pnl-breakdown-trigger"
        >
          <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <RealizedPnlBreakdownPanel breakdown={breakdown} dict={dict} locale={locale} />
      </PopoverContent>
    </Popover>
  );
}

export function RealizedPnlBreakdownInline({
  breakdown,
  dict,
  locale,
}: RealizedPnlBreakdownProps) {
  if (!breakdown) return null;

  return (
    <details className="mt-4 rounded-lg border border-border bg-muted/25 px-3 py-2 text-sm" data-testid="realized-pnl-breakdown-inline">
      <summary className="cursor-pointer font-medium text-foreground">
        {dict.tickerHistory.realizedPnlBreakdownTrigger}
      </summary>
      <div className="mt-3">
        <RealizedPnlBreakdownPanel breakdown={breakdown} dict={dict} locale={locale} />
      </div>
    </details>
  );
}

function RealizedPnlBreakdownPanel({
  breakdown,
  dict,
  locale,
}: {
  breakdown: RealizedPnlBreakdownDto;
  dict: AppDictionary;
  locale: LocaleCode;
}) {
  if (breakdown.status === "unavailable") {
    return (
      <div data-testid="realized-pnl-breakdown-panel">
        <p className="text-sm font-semibold text-foreground">{dict.tickerHistory.realizedPnlBreakdownTitle}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {dict.tickerHistory.realizedPnlBreakdownUnavailable}: {formatUnavailableReason(breakdown.reason, dict)}
        </p>
      </div>
    );
  }

  const finalFormula = `${formatCurrencyAmount(breakdown.netProceedsAmount, breakdown.currency, locale)} - ${formatCurrencyAmount(breakdown.allocatedCostAmount, breakdown.currency, locale)} = ${formatCurrencyAmount(breakdown.realizedPnlAmount, breakdown.currency, locale)}`;

  return (
    <div data-testid="realized-pnl-breakdown-panel">
      <p className="text-sm font-semibold text-foreground">{dict.tickerHistory.realizedPnlBreakdownTitle}</p>
      <p className="mt-1 text-xs text-muted-foreground">{dict.tickerHistory.realizedPnlBreakdownSubtitle}</p>
      <dl className="mt-3 grid gap-2 text-xs">
        <BreakdownRow label={dict.tickerHistory.realizedPnlPreSaleQuantity} value={formatNumber(breakdown.preSaleOpenQuantity, locale, 4)} />
        <BreakdownRow label={dict.tickerHistory.realizedPnlPreSaleCost} value={formatCurrencyAmount(breakdown.preSaleOpenCostAmount, breakdown.currency, locale)} />
        <BreakdownRow label={dict.tickerHistory.realizedPnlExactAverage} value={formatNumber(breakdown.exactAverageCostPerShare, locale, 6)} />
        <BreakdownRow label={dict.tickerHistory.realizedPnlRoundedAverage} value={formatCurrencyAmount(breakdown.roundedAverageCostPerShare, breakdown.currency, locale)} />
        <BreakdownRow label={dict.tickerHistory.realizedPnlAllocatedCost} value={formatCurrencyAmount(breakdown.allocatedCostAmount, breakdown.currency, locale)} />
        <BreakdownRow label={dict.tickerHistory.realizedPnlGrossProceeds} value={formatCurrencyAmount(breakdown.grossProceedsAmount, breakdown.currency, locale)} />
        <BreakdownRow label={dict.tickerHistory.commissionLabel} value={formatCurrencyAmount(breakdown.commissionAmount, breakdown.currency, locale)} />
        <BreakdownRow label={dict.tickerHistory.taxLabel} value={formatCurrencyAmount(breakdown.taxAmount, breakdown.currency, locale)} />
        <BreakdownRow label={dict.tickerHistory.realizedPnlNetProceeds} value={formatCurrencyAmount(breakdown.netProceedsAmount, breakdown.currency, locale)} />
      </dl>
      <div className="mt-3 rounded-md border border-border bg-background px-3 py-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{dict.tickerHistory.realizedPnlFormula}</p>
        <p className="mt-1 font-mono text-xs font-semibold tabular-nums text-foreground">{finalFormula}</p>
      </div>
    </div>
  );
}

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function formatUnavailableReason(
  reason: Exclude<RealizedPnlBreakdownDto, { status: "available" }>["reason"],
  dict: AppDictionary,
): string {
  switch (reason) {
    case "insufficient_quantity":
      return dict.tickerHistory.realizedPnlUnavailableInsufficientQuantity;
    case "currency_mismatch":
      return dict.tickerHistory.realizedPnlUnavailableCurrencyMismatch;
    case "unsupported_cost_basis_method":
      return dict.tickerHistory.realizedPnlUnavailableUnsupportedCostBasis;
    case "unknown":
      return dict.tickerHistory.realizedPnlUnavailableUnknown;
  }
}
