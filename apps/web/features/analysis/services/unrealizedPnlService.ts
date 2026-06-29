"use client";

import { ApiError, getJson } from "../../../lib/api";
import { buildPreviewUnrealizedPnlAnalysis } from "../unrealizedPnlPreview";
import { buildSelectedSeriesId, buildUnrealizedPnlApiPath } from "../unrealizedPnlRouteState";
import type {
  UnrealizedPnlAnalysisDto as ApiUnrealizedPnlAnalysisDto,
  UnrealizedPnlTickerSeriesPointDto,
} from "@vakwen/shared-types";
import type {
  AnalysisMarkerType,
  UnrealizedPnlAnalysisDto,
  UnrealizedPnlAnalysisRouteState,
  UnrealizedPnlPointMarker,
  UnrealizedPnlSeries,
} from "../unrealizedPnlTypes";

const SERIES_COLORS = ["#215dc6", "#157f5b", "#d28a2e", "#e15555", "#4ca7c7", "#7d5cc6", "#6f7d32", "#9a5b3e"];

export async function fetchUnrealizedPnlAnalysis(
  state: UnrealizedPnlAnalysisRouteState,
): Promise<UnrealizedPnlAnalysisDto> {
  try {
    const response = await getJson<ApiUnrealizedPnlAnalysisDto>(buildUnrealizedPnlApiPath(state), { contextScope: "portfolio" });
    return mapApiAnalysis(response, state);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 501)) {
      return buildPreviewUnrealizedPnlAnalysis(state);
    }
    throw error;
  }
}

function mapApiAnalysis(
  response: ApiUnrealizedPnlAnalysisDto,
  state: UnrealizedPnlAnalysisRouteState,
): UnrealizedPnlAnalysisDto {
  const selectedIds = response.selectedTickers.map((item) => buildSelectedSeriesId(item.marketCode, item.ticker));
  const selectedSet = new Set(selectedIds);
  const markersBySeriesId = new Map<string, UnrealizedPnlPointMarker[]>();
  for (const marker of response.tradeMarkers) {
    const seriesId = buildSelectedSeriesId(marker.marketCode, marker.ticker);
    const markers = markersBySeriesId.get(seriesId) ?? [];
    markers.push({
      date: marker.date,
      type: mapMarkerKind(marker.kind),
      label: marker.kind === "full_exit" ? "F" : marker.kind === "partial_sell" ? "S" : marker.kind === "aggregate" ? "A" : "B",
    });
    markersBySeriesId.set(seriesId, markers);
  }

  const tickerSeries = groupSeries(response.tickerSeries, response.summary.reportingCurrency, markersBySeriesId);
  const ranking = response.rankings.map((row) => {
    const seriesId = buildSelectedSeriesId(row.marketCode, row.ticker);
    return {
      seriesId,
      ticker: row.ticker,
      marketCode: row.marketCode,
      displayName: row.instrumentName ?? `${row.ticker} ${row.marketCode}`,
      stateLabel: row.currentlyHeld ? "Current" : "Sold out",
      state: row.currentlyHeld ? "current" as const : "sold-out" as const,
      endUnrealizedPnl: row.endUnrealizedPnlAmount ?? 0,
      periodChange: row.periodChangeAmount ?? 0,
      isSelected: selectedSet.has(seriesId),
    };
  });
  const bestDriver = ranking[0] ?? null;
  const worstDriver = [...ranking].sort((left, right) => left.periodChange - right.periodChange)[0] ?? null;
  const missingRows = response.dataHealth.missingFxRowCount + response.dataHealth.nullUnrealizedRowCount;
  const healthStatus = missingRows > 0 || response.dataHealth.provisionalRowCount > 0 ? "partial" : "complete";

  return {
    query: {
      range: state.range,
      from: response.query.fromDate,
      to: response.query.toDate,
      granularity: response.query.granularity,
      markets: response.query.markets,
      accounts: response.query.accountIds,
      tickers: response.query.tickers,
      selectionMode: response.query.selectionMode === "manual" ? "manual" : "top-drivers",
      selected: selectedIds,
      lineCount: response.query.comparisonLineCount,
      holdingsState: response.query.holdingsState === "include_sold_out" ? "include-sold" : "current-only",
      reportingCurrency: response.query.reportingCurrency,
      includeProvisional: response.query.includeProvisional,
      instrumentTypes: response.query.instrumentTypes,
    },
    availableFilters: {
      markets: response.query.markets.map((marketCode) => ({ value: marketCode, label: marketCode })),
      accounts: response.query.accountIds.map((accountId) => ({ value: accountId, label: accountId })),
      tickers: response.rankings.map((row) => ({ value: row.ticker, label: `${row.ticker} ${row.marketCode}` })),
      reportingCurrencies: ["TWD", "USD", "AUD", "KRW", "JPY"].map((currency) => ({ value: currency, label: currency })),
      instrumentTypes: ["STOCK", "ETF", "BOND_ETF"].map((instrumentType) => ({ value: instrumentType, label: instrumentType })),
    },
    summary: {
      totalUnrealized: {
        label: "Total unrealized",
        value: response.summary.endUnrealizedPnlAmount,
        currency: response.summary.reportingCurrency,
        tone: toneForValue(response.summary.endUnrealizedPnlAmount),
        detail: `${response.summary.includedTickerCount} tickers included`,
      },
      periodChange: {
        label: "Period change",
        value: response.summary.periodChangeAmount,
        currency: response.summary.reportingCurrency,
        tone: toneForValue(response.summary.periodChangeAmount),
        detail: `${response.summary.startDate ?? "-"} to ${response.summary.endDate ?? "-"}`,
      },
      bestDriver: bestDriver ? {
        label: bestDriver.displayName,
        marketCode: bestDriver.marketCode,
        ticker: bestDriver.ticker,
        periodChange: bestDriver.periodChange,
      } : null,
      worstDriver: worstDriver ? {
        label: worstDriver.displayName,
        marketCode: worstDriver.marketCode,
        ticker: worstDriver.ticker,
        periodChange: worstDriver.periodChange,
      } : null,
    },
    dataHealth: {
      status: healthStatus,
      title: healthStatus === "complete" ? "Complete" : "Partial",
      detail: `${response.dataHealth.snapshotRowCount} snapshot rows, ${missingRows} unavailable rows`,
      provisionalIncluded: response.query.includeProvisional,
      stalePriceCount: response.dataHealth.provisionalRowCount,
      missingPriceCount: response.dataHealth.nullUnrealizedRowCount,
      source: "api",
    },
    portfolioSeries: response.portfolioSeries.map((point) => ({
      date: point.date,
      unrealizedPnl: point.unrealizedPnlAmount ?? 0,
    })),
    tickerSeries,
    ranking,
    selectedSeriesIds: selectedIds,
    reportsPreview: {
      currentUnrealized: response.summary.endUnrealizedPnlAmount,
      topGainLabel: bestDriver?.displayName ?? null,
      topGainValue: bestDriver?.periodChange ?? null,
      topLossLabel: worstDriver?.displayName ?? null,
      topLossValue: worstDriver?.periodChange ?? null,
      openHref: response.deepLink,
    },
    deepLink: response.deepLink,
    generatedAt: response.query.asOf,
  };
}

function groupSeries(
  points: UnrealizedPnlTickerSeriesPointDto[],
  currency: ApiUnrealizedPnlAnalysisDto["summary"]["reportingCurrency"],
  markersBySeriesId: ReadonlyMap<string, UnrealizedPnlPointMarker[]>,
): UnrealizedPnlSeries[] {
  const groups = new Map<string, UnrealizedPnlTickerSeriesPointDto[]>();
  for (const point of points) {
    const seriesId = buildSelectedSeriesId(point.marketCode, point.ticker);
    const existing = groups.get(seriesId) ?? [];
    existing.push(point);
    groups.set(seriesId, existing);
  }
  return [...groups.entries()].map(([seriesId, seriesPoints], index) => {
    const first = seriesPoints[0]!;
    const last = seriesPoints[seriesPoints.length - 1]!;
    const firstValue = first.unrealizedPnlAmount ?? 0;
    const lastValue = last.unrealizedPnlAmount ?? 0;
    return {
      seriesId,
      ticker: first.ticker,
      marketCode: first.marketCode,
      displayName: first.instrumentName ?? `${first.ticker} ${first.marketCode}`,
      currency,
      instrumentType: first.instrumentType ?? "STOCK",
      stateLabel: first.isSoldOut ? "Sold out" : "Current",
      state: first.isSoldOut ? "sold-out" : "current",
      colorToken: SERIES_COLORS[index % SERIES_COLORS.length]!,
      endUnrealizedPnl: lastValue,
      periodChange: lastValue - firstValue,
      accountIds: first.accountIds,
      points: seriesPoints.map((point) => ({
        date: point.date,
        unrealizedPnl: point.unrealizedPnlAmount ?? 0,
        marketValue: point.marketValueAmount ?? 0,
        costBasis: point.costBasisAmount ?? 0,
        quantity: point.quantity,
        closePrice: null,
        transactionContext: point.isSoldOut ? "Sold-out position carried as zero after exit." : "Open-position snapshot.",
      })),
      markers: markersBySeriesId.get(seriesId) ?? [],
    };
  });
}

function mapMarkerKind(kind: ApiUnrealizedPnlAnalysisDto["tradeMarkers"][number]["kind"]): AnalysisMarkerType {
  if (kind === "partial_sell") return "partial-sell";
  if (kind === "full_exit") return "full-exit";
  return kind;
}

function toneForValue(value: number | null): "positive" | "negative" | "neutral" {
  if (value === null || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}
