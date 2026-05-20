import type { MarketCode } from "@vakwen/domain";
import type { TickerFundamentalsDto, TickerFundamentalsFieldDto } from "@vakwen/shared-types";

export interface FundamentalsProvider {
  readonly providerId: string;
  fetchFundamentals(input: { ticker: string; marketCode: MarketCode }): Promise<TickerFundamentalsDto>;
}

export type FundamentalsRegistry = Map<MarketCode, FundamentalsProvider>;

const FUNDAMENTALS_FIELD_NAMES = [
  "marketCap",
  "enterpriseValue",
  "priceEarningsRatio",
  "priceBookRatio",
  "dividendYield",
  "earningsPerShare",
  "revenueTrailingTwelveMonths",
  "netIncomeTrailingTwelveMonths",
] as const satisfies ReadonlyArray<keyof TickerFundamentalsDto>;

function createEmptyField(): TickerFundamentalsFieldDto<number> {
  return {
    value: null,
    source: null,
    asOf: null,
  };
}

export function createEmptyTickerFundamentals(): TickerFundamentalsDto {
  return {
    marketCap: createEmptyField(),
    enterpriseValue: createEmptyField(),
    priceEarningsRatio: createEmptyField(),
    priceBookRatio: createEmptyField(),
    dividendYield: createEmptyField(),
    earningsPerShare: createEmptyField(),
    revenueTrailingTwelveMonths: createEmptyField(),
    netIncomeTrailingTwelveMonths: createEmptyField(),
  };
}

export function normalizeTickerFundamentals(value: unknown): TickerFundamentalsDto {
  const source = isPlainObject(value) ? value : {};
  const normalized = createEmptyTickerFundamentals();

  for (const fieldName of FUNDAMENTALS_FIELD_NAMES) {
    normalized[fieldName] = normalizeField(source[fieldName]);
  }

  return normalized;
}

function normalizeField(value: unknown): TickerFundamentalsFieldDto<number> {
  if (!isPlainObject(value)) {
    return createEmptyField();
  }

  const numericValue = typeof value.value === "number" && Number.isFinite(value.value)
    ? value.value
    : null;

  return {
    value: numericValue,
    source: typeof value.source === "string" && value.source.trim().length > 0 ? value.source : null,
    asOf: typeof value.asOf === "string" && value.asOf.trim().length > 0 ? value.asOf : null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
