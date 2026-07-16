"use client";

import type { HoldingsSelectionMode } from "@vakwen/shared-types";
import { buildHoldingsTickerId } from "./holdingsPreferenceHelpers";

export interface HoldingsSelectionSummaryRow {
  marketCode: string;
  ticker: string;
  reportingCostBasisAmount: number | null;
  reportingMarketValueAmount: number | null;
  reportingUnrealizedPnlAmount: number | null;
}

export interface HoldingsSelectionMetricSummary {
  amount: number | null;
  eligibleCount: number;
  includedCount: number;
  isPartial: boolean;
}

export interface HoldingsSelectionVisibleSummary {
  visibleSelectedCount: number;
  globalSelectedCount: number;
  cost: HoldingsSelectionMetricSummary;
  marketValue: HoldingsSelectionMetricSummary;
  unrealizedPnl: HoldingsSelectionMetricSummary;
}

interface BuildHoldingsSelectionVisibleSummaryInput {
  mode: HoldingsSelectionMode;
  rows: HoldingsSelectionSummaryRow[];
  selectedTickerIds: string[];
  universeTickerIds: string[];
}

function buildMetricSummary(
  rows: HoldingsSelectionSummaryRow[],
  getAmount: (row: HoldingsSelectionSummaryRow) => number | null,
): HoldingsSelectionMetricSummary {
  const eligibleCount = rows.length;
  const includedRows = rows.filter((row) => getAmount(row) !== null);
  const includedCount = includedRows.length;
  return {
    amount: includedCount > 0 ? includedRows.reduce((sum, row) => sum + (getAmount(row) ?? 0), 0) : null,
    eligibleCount,
    includedCount,
    isPartial: eligibleCount > 0 && includedCount < eligibleCount,
  };
}

export function buildHoldingsSelectionVisibleSummary({
  mode,
  rows,
  selectedTickerIds,
  universeTickerIds,
}: BuildHoldingsSelectionVisibleSummaryInput): HoldingsSelectionVisibleSummary {
  const selectedTickerIdSet = new Set(selectedTickerIds);
  const visibleRows = rows.filter((row) =>
    mode === "all" || selectedTickerIdSet.has(buildHoldingsTickerId(row.marketCode, row.ticker)),
  );
  const visibleTickerIds = new Set(visibleRows.map((row) => buildHoldingsTickerId(row.marketCode, row.ticker)));

  return {
    visibleSelectedCount: visibleTickerIds.size,
    globalSelectedCount: mode === "all" ? new Set(universeTickerIds).size : selectedTickerIdSet.size,
    cost: buildMetricSummary(visibleRows, (row) => row.reportingCostBasisAmount),
    marketValue: buildMetricSummary(visibleRows, (row) => row.reportingMarketValueAmount),
    unrealizedPnl: buildMetricSummary(visibleRows, (row) => row.reportingUnrealizedPnlAmount),
  };
}
