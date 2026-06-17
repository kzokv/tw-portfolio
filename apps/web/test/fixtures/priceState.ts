import type {
  DashboardMarketStateDto,
  PriceStateDto,
  PriceStateRollupDto,
} from "@vakwen/shared-types";

export function testPriceState(overrides: Partial<PriceStateDto> = {}): PriceStateDto {
  return {
    basis: "today_close",
    chipState: "closed",
    marketState: "closed",
    source: "test",
    sourceKind: "primary_daily",
    asOfDate: "2026-06-17",
    asOfTimestamp: null,
    observedAt: "2026-06-17T08:00:00.000Z",
    delaySeconds: null,
    marketTimeZone: "Asia/Taipei",
    quality: "full_bar",
    ...overrides,
  };
}

export function testPriceStateRollup(overrides: Partial<PriceStateRollupDto> = {}): PriceStateRollupDto {
  return {
    holdingCount: 0,
    currentPriceCount: 0,
    nonCurrentPriceCount: 0,
    missingPriceCount: 0,
    basisCounts: [],
    ...overrides,
  };
}

export function testMarketState(overrides: Partial<DashboardMarketStateDto> = {}): DashboardMarketStateDto {
  return {
    marketCode: "TW",
    marketState: "closed",
    asOf: "2026-06-17T08:00:00.000Z",
    marketTimeZone: "Asia/Taipei",
    regularSessionOnly: true,
    ...overrides,
  };
}
