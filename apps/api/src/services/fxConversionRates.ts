import type { AccountDefaultCurrency, FxConversionRateDto } from "@vakwen/shared-types";
import type { Persistence } from "../persistence/types.js";

export async function buildFxConversionRateRows(
  persistence: Persistence,
  sourceCurrencies: ReadonlyArray<AccountDefaultCurrency>,
  reportingCurrency: AccountDefaultCurrency,
  asOf: string,
): Promise<FxConversionRateDto[]> {
  const uniqueSources = [...new Set(sourceCurrencies)]
    .filter((currency): currency is AccountDefaultCurrency => currency !== reportingCurrency)
    .sort();

  const rows = await Promise.all(uniqueSources.map(async (fromCurrency): Promise<FxConversionRateDto | null> => {
    const resolved = persistence.getResolvedFxRate
      ? await persistence.getResolvedFxRate(fromCurrency, reportingCurrency, asOf)
      : null;
    const fallbackRate = resolved === null ? await persistence.getFxRate(fromCurrency, reportingCurrency, asOf) : null;
    const rate = resolved?.rate ?? fallbackRate;
    if (rate === null) return null;
    return {
      fromCurrency,
      toCurrency: reportingCurrency,
      rate,
      asOf: resolved?.asOfDate ?? asOf,
    };
  }));
  return rows.filter((row): row is FxConversionRateDto => row !== null);
}
