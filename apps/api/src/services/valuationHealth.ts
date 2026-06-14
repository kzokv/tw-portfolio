import type { FastifyInstance } from "fastify";
import type { DashboardOverviewHoldingGroupDto, DashboardPerformanceDto, ValuationHealthDto, ValuationHealthHoldingDto } from "@vakwen/shared-types";
import { MARKET_CODES, type AccountDefaultCurrency, type MarketCode } from "@vakwen/shared-types";
import { getEffectiveValuationHealthThresholds, minorUnitToleranceFor } from "./appConfig/valuationHealth.js";
import type { HoldingSnapshotLatestDateScopePair } from "../persistence/types.js";
import type { Store } from "../types/store.js";

interface BuildValuationHealthInput {
  app: FastifyInstance;
  userId: string;
  store: Store;
  reportingCurrency: AccountDefaultCurrency;
  currentValueAmount: number | null;
  holdingGroups: ReadonlyArray<DashboardOverviewHoldingGroupDto>;
  performance: DashboardPerformanceDto;
  asOf: string;
}

export async function buildValuationHealth(input: BuildValuationHealthInput): Promise<ValuationHealthDto> {
  const thresholds = getEffectiveValuationHealthThresholds();
  const minorUnitTolerance = minorUnitToleranceFor(input.reportingCurrency);
  const latestPerformancePoint = findLatestPerformancePoint(input.performance);
  const snapshotValueAmount = latestPerformancePoint?.marketValueAmount ?? null;
  const latestUsableSnapshotDate = input.performance.diagnostics?.latestReliableValuationDate ?? input.performance.lastReliableDate ?? null;
  const latestSnapshotDate = input.performance.diagnostics?.latestSnapshotDate ?? null;
  const expectedLatestValuationDate = input.performance.diagnostics?.expectedLatestValuationDate ?? input.asOf.slice(0, 10);

  const tickerMarketPairs = dedupeTickerMarketPairs(input.holdingGroups);
  const latestBarByKey = await input.app.persistence.getLatestBarDatesForReconciliation(tickerMarketPairs);
  const backfillStatusByKey = new Map<string, ValuationHealthHoldingDto["backfillStatus"]>();
  await Promise.all(
    tickerMarketPairs.map(async (pair) => {
      const instrument = await input.app.persistence.getInstrument(pair.ticker, pair.marketCode);
      backfillStatusByKey.set(
        `${pair.ticker}:${pair.marketCode}`,
        instrument?.barsBackfillStatus ?? "unknown",
      );
    }),
  );
  const scopePairs = buildScopePairs(input.holdingGroups);
  const latestSnapshotByScope = await input.app.persistence.getLatestHoldingSnapshotDatesByScope(input.userId, scopePairs);

  const affectedHoldings = input.holdingGroups
    .map((group) => buildHoldingHealthRow(group, latestUsableSnapshotDate, latestBarByKey, latestSnapshotByScope, backfillStatusByKey))
    .filter((row): row is ValuationHealthHoldingDto => row !== null)
    .filter((row) => row.status !== "healthy");

  const deltaAmount =
    input.currentValueAmount !== null && snapshotValueAmount !== null
      ? Math.abs(input.currentValueAmount - snapshotValueAmount)
      : null;
  const relativeDeltaBps =
    deltaAmount !== null
      ? (deltaAmount / Math.max(Math.abs(input.currentValueAmount ?? 0), Math.abs(snapshotValueAmount ?? 0), 1)) * 10_000
      : null;
  const absoluteThreshold = thresholdAmountForCurrency(thresholds, input.reportingCurrency);

  let status: ValuationHealthDto["status"] = "healthy";
  let reason: ValuationHealthDto["reason"] = "within_threshold";
  if (input.currentValueAmount === null) {
    status = "unavailable";
    reason = "missing_current_value";
  } else if (snapshotValueAmount === null) {
    status = "unavailable";
    reason = "missing_snapshot_value";
  } else if (deltaAmount !== null && deltaAmount <= minorUnitTolerance) {
    status = "healthy";
    reason = "within_minor_unit_tolerance";
  } else if (
    deltaAmount !== null
    && relativeDeltaBps !== null
    && (deltaAmount >= absoluteThreshold || relativeDeltaBps >= thresholds.relativeBps)
  ) {
    status = "material";
    reason = deltaAmount >= absoluteThreshold ? "absolute_threshold_exceeded" : "relative_threshold_exceeded";
  }

  const latestBarAsOf = latestBarDateForRows(affectedHoldings);
  const recommendedActions = [...new Set(affectedHoldings
    .map((row) => row.recommendedAction)
    .filter((action) => action !== "none"))];

  return {
    status,
    reason,
    reportingCurrency: input.reportingCurrency,
    currentValueAmount: input.currentValueAmount,
    snapshotValueAmount,
    deltaAmount,
    relativeDeltaBps,
    minorUnitTolerance,
    thresholds,
    latestBarAsOf,
    latestSnapshotDate,
    latestUsableSnapshotDate,
    expectedLatestValuationDate,
    affectedHoldings,
    recommendedActions,
  };
}

function thresholdAmountForCurrency(
  thresholds: ReturnType<typeof getEffectiveValuationHealthThresholds>,
  reportingCurrency: AccountDefaultCurrency,
): number {
  if (reportingCurrency === "AUD") return thresholds.absoluteAud;
  if (reportingCurrency === "USD") return thresholds.absoluteUsd;
  if (reportingCurrency === "KRW") return thresholds.absoluteKrw;
  return thresholds.absoluteTwd;
}

function dedupeTickerMarketPairs(holdingGroups: ReadonlyArray<DashboardOverviewHoldingGroupDto>): Array<{ ticker: string; marketCode: MarketCode }> {
  const pairs = new Map<string, { ticker: string; marketCode: MarketCode }>();
  for (const group of holdingGroups) {
    pairs.set(`${group.ticker}:${group.marketCode}`, { ticker: group.ticker, marketCode: group.marketCode });
  }
  return [...pairs.values()];
}

function buildScopePairs(holdingGroups: ReadonlyArray<DashboardOverviewHoldingGroupDto>): HoldingSnapshotLatestDateScopePair[] {
  const pairs = new Map<string, HoldingSnapshotLatestDateScopePair>();
  for (const group of holdingGroups) {
    for (const child of group.children) {
      const key = `${child.accountId}\0${child.ticker}\0${child.marketCode}`;
      pairs.set(key, {
        accountId: child.accountId,
        ticker: child.ticker,
        marketCode: child.marketCode,
      });
    }
  }
  return [...pairs.values()];
}

function buildHoldingHealthRow(
  group: DashboardOverviewHoldingGroupDto,
  latestUsableSnapshotDate: string | null,
  latestBarByKey: ReadonlyMap<string, string | null>,
  latestSnapshotByScope: ReadonlyMap<string, string | null>,
  backfillStatusByKey: ReadonlyMap<string, ValuationHealthHoldingDto["backfillStatus"]>,
): ValuationHealthHoldingDto | null {
  const latestBarDate = latestBarByKey.get(`${group.ticker}:${group.marketCode}`) ?? null;
  const scopeSnapshotDates = group.children.map((child) =>
    latestSnapshotByScope.get(`${child.accountId}\0${child.ticker}\0${child.marketCode}`) ?? null);
  const latestSnapshotDate = scopeSnapshotDates.some((date) => date === null)
    ? null
    : scopeSnapshotDates.reduce<string | null>((min, date) => (min === null || (date !== null && date < min) ? date : min), null);
  const backfillStatus = backfillStatusByKey.get(`${group.ticker}:${group.marketCode}`) ?? "unknown";

  let status: ValuationHealthHoldingDto["status"] = "healthy";
  let recommendedAction: ValuationHealthHoldingDto["recommendedAction"] = "none";
  if (backfillStatus === "pending" || backfillStatus === "backfilling") {
    status = "backfill_pending";
    recommendedAction = "wait_for_backfill";
  } else if (backfillStatus === "failed") {
    status = "backfill_failed";
    recommendedAction = "run_backfill";
  } else if (latestBarDate === null) {
    status = "missing_latest_bar";
    recommendedAction = "run_backfill";
  } else if (latestUsableSnapshotDate === null || latestSnapshotDate === null) {
    status = "missing_snapshot";
    recommendedAction = "run_snapshot_repair";
  } else if (latestSnapshotDate < latestUsableSnapshotDate) {
    status = "stale_snapshot";
    recommendedAction = "run_snapshot_repair";
  }

  return {
    ticker: group.ticker,
    marketCode: group.marketCode,
    currentReportingValueAmount: group.reportingMarketValueAmount ?? null,
    latestBarDate,
    latestSnapshotDate,
    backfillStatus,
    status,
    recommendedAction,
  };
}

function latestBarDateForRows(rows: ReadonlyArray<ValuationHealthHoldingDto>): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.latestBarDate && (latest === null || row.latestBarDate > latest)) {
      latest = row.latestBarDate;
    }
  }
  return latest;
}

export async function buildAllRangePerformance(
  app: FastifyInstance,
  userId: string,
  store: Store,
  reportingCurrency: AccountDefaultCurrency,
  asOf: string,
): Promise<DashboardPerformanceDto> {
  const { translatePerformancePoints } = await import("./dashboardReportingCurrency.js");
  return translatePerformancePoints(userId, "ALL", asOf, reportingCurrency, app.persistence, store);
}

export async function buildRecentValuationPerformance(
  app: FastifyInstance,
  userId: string,
  store: Store,
  reportingCurrency: AccountDefaultCurrency,
  asOf: string,
): Promise<DashboardPerformanceDto> {
  const { translatePerformancePoints } = await import("./dashboardReportingCurrency.js");
  return translatePerformancePoints(userId, "1M", asOf, reportingCurrency, app.persistence, store);
}

export function isMarketCode(value: string): value is MarketCode {
  return (MARKET_CODES as readonly string[]).includes(value);
}

function findLatestPerformancePoint(performance: DashboardPerformanceDto) {
  for (let index = performance.points.length - 1; index >= 0; index -= 1) {
    const point = performance.points[index];
    if (point && point.fxAvailable && point.marketValueAmount !== null) {
      return point;
    }
  }
  return null;
}
