import type { CurrencyCode } from "@tw-portfolio/shared-types";

const DEFAULT_CURRENCY_OPTIONS: CurrencyCode[] = ["TWD", "USD", "JPY", "HKD", "CNY", "EUR"];

export function getCurrencyOptions(extraCurrencies: CurrencyCode[] = []): CurrencyCode[] {
  return Array.from(new Set([...DEFAULT_CURRENCY_OPTIONS, ...extraCurrencies.filter(Boolean)]));
}
