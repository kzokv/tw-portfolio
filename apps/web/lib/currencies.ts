import type { CurrencyCode } from "@vakwen/shared-types";

const DEFAULT_CURRENCY_OPTIONS: CurrencyCode[] = ["TWD", "USD", "AUD", "KRW", "JPY", "HKD", "CNY", "EUR"];

export function getCurrencyOptions(extraCurrencies: CurrencyCode[] = []): CurrencyCode[] {
  return Array.from(new Set([...DEFAULT_CURRENCY_OPTIONS, ...extraCurrencies.filter(Boolean)]));
}
