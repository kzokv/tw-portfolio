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
  AnalysisFilterOption,
  AnalysisMarketCode,
  UnrealizedPnlAnalysisDto,
  UnrealizedPnlAnalysisRouteState,
  UnrealizedPnlPointMarker,
  UnrealizedPnlSeries,
  UnrealizedPnlTickerSelectionRow,
} from "../unrealizedPnlTypes";

const SERIES_COLORS = ["#215dc6", "#157f5b", "#d28a2e", "#e15555", "#4ca7c7", "#7d5cc6", "#6f7d32", "#9a5b3e"];
type PositionStatus = "open_position" | "closed_position";

export async function fetchUnrealizedPnlAnalysis(
  state: UnrealizedPnlAnalysisRouteState,
  options: { signal?: AbortSignal } = {},
): Promise<UnrealizedPnlAnalysisDto> {
  try {
    const response = await getJson<ApiUnrealizedPnlAnalysisDto>(buildUnrealizedPnlApiPath(state), {
      contextScope: "portfolio",
      signal: options.signal,
    });
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
  const seriesById = new Map(tickerSeries.map((series) => [series.seriesId, series] as const));
  const ranking = response.rankings.map((row) => {
    const seriesId = buildSelectedSeriesId(row.marketCode, row.ticker);
    const positionStatus = resolvePositionStatus(row);
    return {
      seriesId,
      ticker: row.ticker,
      marketCode: row.marketCode,
      displayName: row.instrumentName ?? `${row.ticker} ${row.marketCode}`,
      stateLabel: positionStatusLabel(positionStatus),
      state: positionStatus === "open_position" ? "current" as const : "sold-out" as const,
      positionStatus,
      endUnrealizedPnl: row.endUnrealizedPnlAmount,
      periodChange: row.periodChangeAmount,
      isSelected: selectedSet.has(seriesId),
    };
  });
  const tickerSelection = buildTickerSelection(ranking, selectedIds, seriesById);
  const tickerComposition = response.tickerComposition.map((row) => {
    const seriesId = buildSelectedSeriesId(row.marketCode, row.ticker);
    const positionStatus = resolvePositionStatus(row);
    return {
      seriesId,
      ticker: row.ticker,
      marketCode: row.marketCode,
      displayName: row.instrumentName ?? `${row.ticker} ${row.marketCode}`,
      stateLabel: positionStatusLabel(positionStatus),
      state: positionStatus === "open_position" ? "current" as const : "sold-out" as const,
      positionStatus,
      endUnrealizedPnl: row.endUnrealizedPnlAmount,
      marketValue: row.latestMarketValueAmount,
      costBasis: row.latestCostBasisAmount,
      quantity: row.latestQuantity,
      contributionSharePercent: row.contributionSharePercent,
    };
  }).sort(compareCompositionRows);
  const bestDriver = [...ranking]
    .filter((row) => row.periodChange !== null && row.periodChange > 0)
    .sort((left, right) => (right.periodChange ?? 0) - (left.periodChange ?? 0))[0] ?? null;
  const worstDriver = [...ranking]
    .filter((row) => row.periodChange !== null && row.periodChange < 0)
    .sort((left, right) => (left.periodChange ?? 0) - (right.periodChange ?? 0))[0] ?? null;
  const unavailableRows = response.dataHealth.unavailableRowCount;
  const healthStatus = unavailableRows > 0 || response.dataHealth.provisionalRowCount > 0 ? "partial" : "complete";

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
    availableFilters: buildAvailableFilters(response),
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
        periodChange: bestDriver.periodChange ?? 0,
      } : null,
      worstDriver: worstDriver ? {
        label: worstDriver.displayName,
        marketCode: worstDriver.marketCode,
        ticker: worstDriver.ticker,
        periodChange: worstDriver.periodChange ?? 0,
      } : null,
    },
    dataHealth: {
      status: healthStatus,
      title: healthStatus === "complete" ? "Complete" : "Partial",
      detail: `${response.dataHealth.snapshotRowCount} snapshot rows, ${unavailableRows} unavailable rows`,
      provisionalIncluded: response.query.includeProvisional,
      stalePriceCount: response.dataHealth.provisionalRowCount,
      missingPriceCount: response.dataHealth.nullUnrealizedRowCount,
      source: "api",
    },
    portfolioSeries: response.portfolioSeries.map((point) => ({
      date: point.date,
      unrealizedPnl: point.unrealizedPnlAmount,
    })),
    tickerSeries,
    ranking,
    tickerSelection,
    tickerComposition,
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

function buildTickerSelection(
  ranking: UnrealizedPnlAnalysisDto["ranking"],
  selectedIds: string[],
  seriesById: ReadonlyMap<string, UnrealizedPnlSeries>,
): UnrealizedPnlTickerSelectionRow[] {
  const rows: UnrealizedPnlTickerSelectionRow[] = ranking.map((row, index) => ({
    ...row,
    rankLabel: `#${index + 1}`,
    rankSort: index + 1,
    colorToken: seriesById.get(row.seriesId)?.colorToken ?? "#64748b",
    isManual: false,
  }));
  const existing = new Set(rows.map((row) => row.seriesId));
  for (const selectedId of selectedIds) {
    if (existing.has(selectedId)) continue;
    const series = seriesById.get(selectedId);
    if (!series) continue;
    rows.push({
      seriesId: series.seriesId,
      ticker: series.ticker,
      marketCode: series.marketCode,
      displayName: series.displayName,
      stateLabel: series.stateLabel,
      state: series.state,
      positionStatus: series.positionStatus,
      endUnrealizedPnl: series.endUnrealizedPnl,
      periodChange: series.periodChange,
      isSelected: true,
      rankLabel: "Manual",
      rankSort: Number.MAX_SAFE_INTEGER,
      colorToken: series.colorToken,
      isManual: true,
    });
  }
  return rows;
}

function compareCompositionRows(
  left: Pick<UnrealizedPnlAnalysisDto["tickerComposition"][number], "displayName" | "endUnrealizedPnl" | "marketCode" | "ticker">,
  right: Pick<UnrealizedPnlAnalysisDto["tickerComposition"][number], "displayName" | "endUnrealizedPnl" | "marketCode" | "ticker">,
): number {
  const leftScore = left.endUnrealizedPnl ?? Number.NEGATIVE_INFINITY;
  const rightScore = right.endUnrealizedPnl ?? Number.NEGATIVE_INFINITY;
  if (leftScore !== rightScore) return rightScore - leftScore;
  return left.displayName.localeCompare(right.displayName)
    || left.marketCode.localeCompare(right.marketCode)
    || left.ticker.localeCompare(right.ticker);
}

function buildAvailableFilters(response: ApiUnrealizedPnlAnalysisDto): UnrealizedPnlAnalysisDto["availableFilters"] {
  const marketValues = new Set<string>(response.query.markets);
  const tickerLabels = new Map<string, Set<string>>();
  const accountLabels = new Map<string, string>();

  for (const row of response.rankings) {
    marketValues.add(row.marketCode);
    addTickerLabel(tickerLabels, row.ticker, row.marketCode);
    row.accountIds.forEach((accountId, index) => {
      accountLabels.set(accountId, row.accountNames[index] ?? accountId);
    });
  }

  for (const point of response.tickerSeries) {
    marketValues.add(point.marketCode);
    addTickerLabel(tickerLabels, point.ticker, point.marketCode);
    point.accountIds.forEach((accountId, index) => {
      accountLabels.set(accountId, point.accountNames[index] ?? accountId);
    });
  }

  for (const accountId of response.query.accountIds) {
    accountLabels.set(accountId, accountLabels.get(accountId) ?? accountId);
  }
  for (const ticker of response.query.tickers) {
    if (!tickerLabels.has(ticker)) tickerLabels.set(ticker, new Set());
  }

  return {
    markets: [...marketValues]
      .sort()
      .map((marketCode) => ({ value: marketCode, label: marketCode })) as Array<AnalysisFilterOption & { value: AnalysisMarketCode }>,
    accounts: [...accountLabels.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, label]) => ({ value, label })),
    tickers: [...tickerLabels.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, labels]) => ({
        value,
        label: labels.size > 0 ? `${value} ${[...labels].sort().join("/")}` : value,
      })),
    reportingCurrencies: ["TWD", "USD", "AUD", "KRW", "JPY"].map((currency) => ({ value: currency, label: currency })),
    instrumentTypes: ["STOCK", "ETF", "BOND_ETF"].map((instrumentType) => ({ value: instrumentType, label: instrumentType })),
  };
}

function addTickerLabel(target: Map<string, Set<string>>, ticker: string, marketCode: string): void {
  const labels = target.get(ticker) ?? new Set<string>();
  labels.add(marketCode);
  target.set(ticker, labels);
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
    const firstValue = first.unrealizedPnlAmount;
    const lastValue = last.unrealizedPnlAmount;
    const positionStatus = resolvePositionStatus(first);
    return {
      seriesId,
      ticker: first.ticker,
      marketCode: first.marketCode,
      displayName: first.instrumentName ?? `${first.ticker} ${first.marketCode}`,
      currency,
      instrumentType: first.instrumentType ?? "STOCK",
      stateLabel: positionStatusLabel(positionStatus),
      state: positionStatus === "closed_position" ? "sold-out" : "current",
      positionStatus,
      colorToken: SERIES_COLORS[index % SERIES_COLORS.length]!,
      endUnrealizedPnl: lastValue,
      periodChange: firstValue !== null && lastValue !== null ? lastValue - firstValue : null,
      accountIds: first.accountIds,
      points: seriesPoints.map((point) => ({
        date: point.date,
        unrealizedPnl: point.unrealizedPnlAmount,
        marketValue: point.marketValueAmount,
        costBasis: point.costBasisAmount,
        quantity: point.quantity,
        closePrice: point.closePrice,
        transactionContext: point.isSoldOut ? "Sold-out position carried as zero after exit." : "Open-position snapshot.",
      })),
      markers: markersBySeriesId.get(seriesId) ?? [],
    };
  });
}

function resolvePositionStatus(row: { currentlyHeld?: boolean; isSoldOut?: boolean; positionStatus?: PositionStatus }): PositionStatus {
  if (row.positionStatus === "open_position" || row.positionStatus === "closed_position") return row.positionStatus;
  return row.isSoldOut === true || row.currentlyHeld === false ? "closed_position" : "open_position";
}

function positionStatusLabel(status: PositionStatus): string {
  return status === "open_position" ? "Open position" : "Closed position";
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
