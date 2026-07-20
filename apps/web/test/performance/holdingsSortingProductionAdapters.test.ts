import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type {
  DashboardOverviewHoldingChildDto,
  HoldingsSortDirection,
  HoldingsSortField,
  PriceStateDto,
  ReportHoldingRowDto,
} from "@vakwen/shared-types";
import { describe, expect, it } from "vitest";
import { dashboardHoldingSortKey } from "../../components/dashboard/DashboardHoldingsPreview";
import { sortHoldingsRows, type HoldingsSortPrimitive } from "../../components/holdings/holdingsSorting";
import { portfolioHoldingSortKey } from "../../components/portfolio/HoldingsTable";
import { reportHoldingSortKey } from "../../components/reports/ReportsClient";
import { captureFrontendSourceState } from "./holdingsSortingPerformanceHarness";

interface ProductionSurfaceRow {
  dashboard: DashboardOverviewHoldingChildDto;
  portfolio: DashboardOverviewHoldingChildDto;
  report: ReportHoldingRowDto;
}

interface ScenarioSummary {
  direction: HoldingsSortDirection;
  field: HoldingsSortField;
  maxMs: number;
  meanMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  surface: "dashboard" | "portfolio" | "reports";
}

const VERIFY_ENABLED = process.env.HOLDINGS_PRODUCTION_PERF_VERIFY === "1";
const ROW_COUNT = 1_000;
const WARMUP_COUNT = 50;
const MEASURED_COUNT = 250;
const P95_LIMIT_MS = 10;

describe("holdings sorting production engine and surface key adapters performance", () => {
  it.runIf(VERIFY_ENABLED)("sorts 1,000 realistic DTO rows under 10ms p95 through production adapters", () => {
    const rows = buildProductionRows(ROW_COUNT);
    assertSignedDailyChangeOrdering();

    const scenarios = [
      {
        direction: "desc",
        extractKey: (row: ProductionSurfaceRow, field: HoldingsSortField) => dashboardHoldingSortKey(row.dashboard, field, "TWD"),
        field: "marketValue",
        surface: "dashboard",
      },
      {
        direction: "desc",
        extractKey: (row: ProductionSurfaceRow, field: HoldingsSortField) => portfolioHoldingSortKey(row.portfolio, field, row.portfolio.reportingAllocationPercent),
        field: "dataHealth",
        surface: "portfolio",
      },
      {
        direction: "asc",
        extractKey: (row: ProductionSurfaceRow, field: HoldingsSortField) => reportHoldingSortKey(row.report, field),
        field: "dailyChangePercent",
        surface: "reports",
      },
      {
        direction: "desc",
        extractKey: (row: ProductionSurfaceRow, field: HoldingsSortField) => reportHoldingSortKey(row.report, field),
        field: "dailyChangePercent",
        surface: "reports",
      },
    ] as const;

    const summaries = scenarios.map((scenario) => {
      const durations = measureScenario(rows, scenario.extractKey, scenario.field, scenario.direction);
      const summary = summarize(durations);
      expect(summary.p95Ms, `${scenario.surface} ${scenario.field} ${scenario.direction} p95`).toBeLessThan(P95_LIMIT_MS);
      return { direction: scenario.direction, field: scenario.field, surface: scenario.surface, ...summary } satisfies ScenarioSummary;
    });

    writeVerificationArtifact(summaries);
  });
});

function measureScenario(
  rows: readonly ProductionSurfaceRow[],
  extractKey: (row: ProductionSurfaceRow, field: HoldingsSortField) => HoldingsSortPrimitive,
  field: HoldingsSortField,
  direction: HoldingsSortDirection,
): number[] {
  const durations: number[] = [];
  for (let iteration = 0; iteration < WARMUP_COUNT + MEASURED_COUNT; iteration += 1) {
    const start = performance.now();
    const sorted = sortHoldingsRows({
      direction,
      extractKey,
      field,
      getIdentity: (row) => ({ accountId: row.dashboard.accountId, marketCode: row.dashboard.marketCode, ticker: row.dashboard.ticker }),
      rows,
    });
    const duration = performance.now() - start;
    expect(sorted).toHaveLength(ROW_COUNT);
    if (iteration >= WARMUP_COUNT) durations.push(duration);
  }
  return durations;
}

function buildProductionRows(count: number): ProductionSurfaceRow[] {
  const markets = ["TW", "US", "JP"] as const;
  return Array.from({ length: count }, (_, index) => {
    const missing = index % 29 === 0;
    const provisional = !missing && index % 17 === 0;
    const marketCode = markets[index % markets.length]!;
    const currency = marketCode === "US" ? "USD" : marketCode === "JP" ? "JPY" : "TWD";
    const price = 18 + ((index * 37) % 1_200) / 3;
    const quantity = 10 + ((index * 101) % 25_000);
    const averageCost = price * (0.72 + ((index * 13) % 55) / 100);
    const marketValue = missing ? null : price * quantity;
    const costBasis = averageCost * quantity;
    const dailyChangePercent = missing ? null : ((index * 17) % 230 - 115) / 10;
    const ticker = `T${String((index * 7919) % 100_000).padStart(5, "0")}`;
    const quoteStatus = missing ? "missing" : provisional ? "provisional" : "current";
    const fxStatus = index % 31 === 0 ? "missing" : index % 19 === 0 ? "partial" : "complete";
    const reportingMarketValue = fxStatus === "missing" ? null : marketValue;
    const reportingCostBasis = fxStatus === "missing" ? null : costBasis;
    const reportingUnrealizedPnl = reportingMarketValue === null || reportingCostBasis === null
      ? null
      : reportingMarketValue - reportingCostBasis;
    const priceState = buildPriceState(quoteStatus);
    const dashboard: DashboardOverviewHoldingChildDto = {
      accountId: `account-${index % 23}`,
      accountName: `Account ${index % 23}`,
      allocationBasisFallbackReason: missing ? "missing_quote" : null,
      allocationBasisUsed: missing ? "cost_basis" : "market_value",
      allocationPct: marketValue === null ? null : ((index * 19) % 1_000) / 10,
      averageCostPerShare: averageCost,
      change: dailyChangePercent === null ? null : price * dailyChangePercent / 100,
      changePercent: dailyChangePercent,
      costBasisAmount: costBasis,
      currency,
      currentUnitPrice: missing ? null : price,
      fxStatus,
      instrumentName: `Instrument ${index}`,
      lastDividendPostedDate: index % 5 === 0 ? null : "2026-05-01",
      marketCode,
      marketValueAmount: marketValue,
      nextDividendDate: index % 7 === 0 ? null : "2026-08-01",
      previousClose: missing ? null : price * 0.99,
      priceState,
      quantity,
      quoteStatus,
      reportingAllocationPercent: marketValue === null ? null : ((index * 19) % 1_000) / 10,
      reportingCostBasisAmount: reportingCostBasis,
      reportingCurrency: "TWD",
      reportingCurrentUnitPrice: fxStatus === "missing" || missing ? null : price,
      reportingDailyChangeAmount: dailyChangePercent === null ? null : price * quantity * dailyChangePercent / 100,
      reportingMarketValueAmount: reportingMarketValue,
      reportingUnrealizedPnlAmount: reportingUnrealizedPnl,
      ticker,
      unrealizedPnlAmount: marketValue === null ? null : marketValue - costBasis,
    };
    const report: ReportHoldingRowDto = {
      accountCount: 1 + (index % 6),
      accounts: [{ id: dashboard.accountId, name: dashboard.accountName! }],
      dailyChangeAmount: dashboard.reportingDailyChangeAmount ?? null,
      dailyChangePercent,
      fxRateToReporting: fxStatus === "missing" ? null : 1,
      fxStatus,
      instrumentName: dashboard.instrumentName,
      marketCode,
      nativeAverageCostPerShare: averageCost,
      nativeCostBasisAmount: costBasis,
      nativeCurrency: currency,
      nativeCurrentUnitPrice: missing ? null : price,
      nativeMarketValueAmount: marketValue,
      priceState,
      quantity,
      quoteStatus,
      reportingAllocationPercent: dashboard.reportingAllocationPercent,
      reportingAverageCostPerShare: reportingCostBasis === null ? null : reportingCostBasis / quantity,
      reportingCostBasisAmount: reportingCostBasis,
      reportingCurrency: "TWD",
      reportingCurrentUnitPrice: dashboard.reportingCurrentUnitPrice ?? null,
      reportingMarketValueAmount: reportingMarketValue,
      reportingUnrealizedPnlAmount: reportingUnrealizedPnl,
      ticker,
    };
    return { dashboard, portfolio: { ...dashboard }, report };
  });
}

function buildPriceState(quoteStatus: "current" | "provisional" | "missing"): PriceStateDto {
  const missing = quoteStatus === "missing";
  return {
    asOfDate: missing ? null : "2026-07-17",
    asOfTimestamp: missing ? null : "2026-07-17T05:30:00.000Z",
    basis: missing ? "missing" : quoteStatus === "provisional" ? "previous_close" : "today_close",
    chipState: missing ? "missing" : quoteStatus === "provisional" ? "open_previous_close" : "closed",
    delaySeconds: missing ? null : 0,
    marketState: "closed",
    marketTimeZone: "Asia/Taipei",
    observedAt: missing ? null : "2026-07-17T05:30:00.000Z",
    quality: missing ? null : "full_bar",
    source: missing ? null : "performance-fixture",
    sourceKind: missing ? "missing" : "primary_daily",
  };
}

function assertSignedDailyChangeOrdering(): void {
  const changes = [-1.25, 9, -8.5, 2.75];
  const rows = buildProductionRows(changes.length).map((row, index) => ({
    ...row,
    report: { ...row.report, dailyChangePercent: changes[index]! },
  }));
  const sort = (direction: HoldingsSortDirection) => sortHoldingsRows({
    direction,
    extractKey: (row, field) => reportHoldingSortKey(row.report, field),
    field: "dailyChangePercent" as const,
    getIdentity: (row) => ({ marketCode: row.report.marketCode, ticker: row.report.ticker }),
    rows,
  }).map((row) => row.report.dailyChangePercent);
  expect(sort("asc")).toEqual([-8.5, -1.25, 2.75, 9]);
  expect(sort("desc")).toEqual([9, 2.75, -1.25, -8.5]);
}

function summarize(durations: number[]): Omit<ScenarioSummary, "direction" | "field" | "surface"> {
  const sorted = durations.slice().sort((left, right) => left - right);
  const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.ceil(value * sorted.length) - 1)]!;
  return {
    maxMs: sorted[sorted.length - 1]!,
    meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    minMs: sorted[0]!,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
  };
}

function writeVerificationArtifact(scenarios: ScenarioSummary[]): void {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const outputDirectory = join(repoRoot, ".worklog", "team", "performance");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, "holdings-sorting-production-adapters-post.json"), `${JSON.stringify({
    baseSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
    capturedAt: new Date().toISOString(),
    environment: { cpuCount: cpus().length, cpuModel: cpus()[0]?.model ?? "unknown", nodeVersion: process.version },
    frontendSourceState: captureFrontendSourceState(repoRoot),
    methodology: {
      adapterKeys: "each timed comparison invokes the exported Dashboard, Portfolio, or Reports production sort-key adapter against realistic DTO rows",
      measuredCount: MEASURED_COUNT,
      metric: "wall-clock production-adapter-plus-sort duration",
      rowCount: ROW_COUNT,
      signedDailyChange: "ascending and descending use signed percentages, never absolute magnitude",
      thresholdP95Ms: P95_LIMIT_MS,
      warmupCount: WARMUP_COUNT,
    },
    scenarios,
  }, null, 2)}\n`, "utf8");
}
