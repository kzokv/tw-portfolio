import type { ExpectedStockCalcState, LocaleCode, StockDistributionRatioState } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { formatNumber } from "../../lib/utils";

export type DividendEventTypeValue = "CASH" | "STOCK" | "CASH_AND_STOCK";

export interface TickerShareSummaryInput {
  marketCode?: string | null;
  ticker: string;
  tickerName?: string | null;
  quantity: number;
}

export function isCashDividendEvent(eventType: DividendEventTypeValue): boolean {
  return eventType !== "STOCK";
}

export function isStockDividendEvent(eventType: DividendEventTypeValue): boolean {
  return eventType !== "CASH";
}

export function dividendEventTypeLabel(dict: AppDictionary, eventType: DividendEventTypeValue): string {
  switch (eventType) {
    case "STOCK":
      return dict.dividends.eventType.stock;
    case "CASH_AND_STOCK":
      return dict.dividends.eventType.cashAndStock;
    default:
      return dict.dividends.eventType.cash;
  }
}

export function stockRatioStateLabel(
  dict: AppDictionary,
  stockDistributionRatioState: StockDistributionRatioState | null | undefined,
  expectedStockCalcState?: ExpectedStockCalcState | null,
): string {
  if (expectedStockCalcState === "needs_action" || stockDistributionRatioState === "unresolved") {
    return dict.dividends.stockRatioState.unresolved;
  }
  if (stockDistributionRatioState === "derived_non_authoritative") {
    return dict.dividends.stockRatioState.derived;
  }
  return dict.dividends.stockRatioState.authoritative;
}

export function formatDividendRatio(ratio: number, locale: LocaleCode): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 6,
  }).format(ratio);
}

export function formatDividendShares(quantity: number, locale: LocaleCode, dict: AppDictionary): string {
  return `${formatNumber(quantity, locale, 8)} ${dict.dividends.sharesUnit}`;
}

export function tickerSummaryLabel(input: Pick<TickerShareSummaryInput, "ticker" | "tickerName">): string {
  const tickerName = input.tickerName?.trim();
  return tickerName ? `${input.ticker} ${tickerName}` : input.ticker;
}

export function buildTickerShareSummaries(
  items: readonly TickerShareSummaryInput[],
  locale: LocaleCode,
  dict: AppDictionary,
  maxItems = 2,
): { count: number; items: string[]; overflowCount: number } {
  const grouped = new Map<string, { label: string; quantity: number }>();
  for (const item of items) {
    const key = `${item.marketCode ?? ""}:${item.ticker}`;
    const existing = grouped.get(key);
    const quantity = (existing?.quantity ?? 0) + item.quantity;
    grouped.set(key, {
      label: tickerSummaryLabel(item),
      quantity,
    });
  }

  const entries = Array.from(grouped.values())
    .sort((left, right) => left.label.localeCompare(right.label))
    .map(({ label, quantity }) => `${label}: ${formatDividendShares(quantity, locale, dict)}`);

  return {
    count: entries.length,
    items: entries.slice(0, maxItems),
    overflowCount: Math.max(0, entries.length - maxItems),
  };
}
