import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  recordPerformanceScenario,
  type PerformanceSample,
} from "./holdingsSortingPerformanceHarness";

interface ProxyHoldingRow {
  accountId: string;
  accountName: string;
  accountCount: number;
  dailyChangePercent: number | null;
  marketCode: string;
  quantity: number;
  reportingAllocationPercent: number | null;
  reportingAverageCostPerShare: number | null;
  reportingCurrentUnitPrice: number | null;
  reportingMarketValueAmount: number | null;
  reportingUnrealizedPnlAmount: number | null;
  ticker: string;
}

interface ProxyHoldingGroup extends ProxyHoldingRow {
  children: ProxyHoldingRow[];
}

const CAPTURE_ENABLED = process.env.HOLDINGS_PERF_CAPTURE === "1";
const WARMUP_COUNT = 50;
const MEASURED_COUNT = 250;
const ROW_COUNT = 1_000;

describe("holdings sorting pure proxy performance", () => {
  it.runIf(CAPTURE_ENABLED)("captures realistic 1,000-row Dashboard and Reports proxy distributions", () => {
    const rows = buildRows(ROW_COUNT);
    const scenarios = [
      { name: "dashboard-current-value-proxy-1000", compare: compareDashboardValue },
      { name: "dashboard-current-ticker-proxy-1000", compare: compareTicker },
      { name: "reports-current-pnl-proxy-1000", compare: compareReportsPnl },
      { name: "reports-current-daily-proxy-1000", compare: compareDaily },
    ] as const;

    for (const scenario of scenarios) {
      const samples = measureSort(rows, scenario.compare);
      expect(samples).toHaveLength(WARMUP_COUNT + MEASURED_COUNT);
      recordPerformanceScenario({
        fixture: {
          fixtureModel: "deterministic flat report holdings",
          measuredCount: MEASURED_COUNT,
          missingValueCadence: 29,
          rowCount: ROW_COUNT,
          warmupCount: WARMUP_COUNT,
        },
        metric: "wall-clock-sort-duration",
        name: scenario.name,
        samples,
      });
    }

    const groups = buildGroups(200, 5);
    const groupedSamples = measureGroupedSort(groups);
    expect(groupedSamples).toHaveLength(WARMUP_COUNT + MEASURED_COUNT);
    recordPerformanceScenario({
      fixture: {
        accountHoldingCount: 1_000,
        childrenPerGroup: 5,
        fixtureModel: "200 holding groups with 5 realistic account holdings each",
        groupCount: 200,
        measuredCount: MEASURED_COUNT,
        warmupCount: WARMUP_COUNT,
      },
      metric: "wall-clock-sort-duration",
      name: "dashboard-grouped-account-children-proxy-1000",
      samples: groupedSamples,
    });
  });
});

function measureSort(rows: ProxyHoldingRow[], compare: (left: ProxyHoldingRow, right: ProxyHoldingRow) => number): PerformanceSample[] {
  const samples: PerformanceSample[] = [];
  for (let iteration = 0; iteration < WARMUP_COUNT + MEASURED_COUNT; iteration += 1) {
    const start = performance.now();
    rows.slice().sort(compare);
    const actualDurationMs = performance.now() - start;
    samples.push({
      action: "copy-and-sort",
      actualDurationMs,
      iteration,
      kind: iteration < WARMUP_COUNT ? "warmup" : "measured",
    });
  }
  return samples;
}

function buildRows(count: number): ProxyHoldingRow[] {
  const markets = ["TW", "US", "JP"] as const;
  return Array.from({ length: count }, (_, index) => {
    const missing = index % 29 === 0;
    const price = 18 + ((index * 37) % 1_200) / 3;
    const quantity = 10 + ((index * 101) % 25_000);
    const averageCost = price * (0.72 + ((index * 13) % 55) / 100);
    const marketValue = missing ? null : price * quantity;
    return {
      accountId: `account-${index % 23}`,
      accountName: `Brokerage ${String(index % 23).padStart(2, "0")}`,
      accountCount: 1 + (index % 6),
      dailyChangePercent: missing ? null : ((index * 17) % 230 - 115) / 10,
      marketCode: markets[index % markets.length]!,
      quantity,
      reportingAllocationPercent: missing ? null : ((index * 19) % 1_000) / 10,
      reportingAverageCostPerShare: missing ? null : averageCost,
      reportingCurrentUnitPrice: missing ? null : price,
      reportingMarketValueAmount: marketValue,
      reportingUnrealizedPnlAmount: marketValue === null ? null : marketValue - averageCost * quantity,
      ticker: `T${String((index * 7919) % 100_000).padStart(5, "0")}`,
    };
  });
}

function buildGroups(groupCount: number, childrenPerGroup: number): ProxyHoldingGroup[] {
  const rows = buildRows(groupCount * childrenPerGroup);
  return Array.from({ length: groupCount }, (_, groupIndex) => {
    const children = rows.slice(groupIndex * childrenPerGroup, (groupIndex + 1) * childrenPerGroup);
    const representative = children[0]!;
    return {
      ...representative,
      accountCount: children.length,
      accountId: "",
      accountName: "",
      children,
      quantity: children.reduce((sum, child) => sum + child.quantity, 0),
      reportingMarketValueAmount: children.reduce((sum, child) => sum + (child.reportingMarketValueAmount ?? 0), 0),
      ticker: `G${String(groupIndex).padStart(4, "0")}`,
    };
  });
}

function measureGroupedSort(groups: ProxyHoldingGroup[]): PerformanceSample[] {
  const samples: PerformanceSample[] = [];
  for (let iteration = 0; iteration < WARMUP_COUNT + MEASURED_COUNT; iteration += 1) {
    const start = performance.now();
    groups
      .map((group) => ({
        ...group,
        children: group.children.slice().sort((left, right) => (
          compareReportsPnl(left, right)
          || left.accountName.localeCompare(right.accountName)
          || left.accountId.localeCompare(right.accountId)
        )),
      }))
      .sort(compareDashboardValue);
    const actualDurationMs = performance.now() - start;
    samples.push({
      action: "decorate-group-sort-and-child-sort",
      actualDurationMs,
      iteration,
      kind: iteration < WARMUP_COUNT ? "warmup" : "measured",
    });
  }
  return samples;
}

function compareDashboardValue(left: ProxyHoldingRow, right: ProxyHoldingRow): number {
  return (right.reportingMarketValueAmount ?? Number.NEGATIVE_INFINITY)
    - (left.reportingMarketValueAmount ?? Number.NEGATIVE_INFINITY);
}

function compareTicker(left: ProxyHoldingRow, right: ProxyHoldingRow): number {
  return `${left.marketCode}:${left.ticker}`.localeCompare(`${right.marketCode}:${right.ticker}`);
}

function compareReportsPnl(left: ProxyHoldingRow, right: ProxyHoldingRow): number {
  return (right.reportingUnrealizedPnlAmount ?? Number.NEGATIVE_INFINITY)
    - (left.reportingUnrealizedPnlAmount ?? Number.NEGATIVE_INFINITY);
}

function compareDaily(left: ProxyHoldingRow, right: ProxyHoldingRow): number {
  return Math.abs(right.dailyChangePercent ?? 0) - Math.abs(left.dailyChangePercent ?? 0);
}
