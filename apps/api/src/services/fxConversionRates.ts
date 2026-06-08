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

  const rows: FxConversionRateDto[] = [];
  for (const fromCurrency of uniqueSources) {
    const rate = await persistence.getFxRate(fromCurrency, reportingCurrency, asOf);
    if (rate === null) continue;
    rows.push({
      fromCurrency,
      toCurrency: reportingCurrency,
      rate,
      asOf,
    });
  }
  return rows;
}
