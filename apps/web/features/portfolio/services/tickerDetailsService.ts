import { TICKER_CHART_RANGES } from "@vakwen/shared-types";
import type {
  DashboardOverviewHoldingDto,
  DashboardOverviewHoldingChildDto,
  DashboardOverviewHoldingGroupDto,
  InstrumentCatalogItemDto,
  TickerChartRange,
  TickerChartSelection,
  TickerDetailsChartMetadataDto,
  TickerDetailsDto,
  TickerEnrichmentDto,
  TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import { getJson } from "../../../lib/api";
import type { DashboardSnapshot } from "../../dashboard/types";
import { findHoldingGroup, resolveHoldingGroups } from "../holdingGroups";

export interface TickerDetailStat {
  label: string;
  value: number | string | null;
  unit?: string;
}

export interface TickerDetailChartPoint {
  date: string;
  label: string;
  price: number | null;
  averageCost: number | null;
  quantity: number;
}

export interface TickerFundamentalField {
  key: string;
  label: string;
  value: number | string | null;
  source: string | null;
  asOf: string | null;
}

export interface TickerFundamentalsPanel {
  key: string;
  title: string;
  items: TickerFundamentalField[];
}

export interface TickerDetailsModel {
  identity: {
    ticker: string;
    name: string | null;
    marketCode: string;
    instrumentType: string | null;
    currency: string;
  };
  quote: {
    currentPrice: number | null;
    previousClose: number | null;
    changeAmount: number | null;
    changePercent: number | null;
    quoteStatus: "current" | "provisional" | "missing";
    freshness: "current" | "stale_amber" | "stale_red";
    freshnessTooltip: string | null;
  };
  position: {
    accountScope: string;
    quantity: number;
    averageCost: number | null;
    costBasis: number | null;
    marketValue: number | null;
    unrealizedPnl: number | null;
    realizedPnl: number;
    transactionsCount: number;
    nextDividendDate: string | null;
    lastDividendPostedDate: string | null;
  };
  chart: {
    range: TickerChartSelection;
    metadata: TickerDetailsChartMetadataDto;
    points: TickerDetailChartPoint[];
  };
  holdingGroup: DashboardOverviewHoldingGroupDto | null;
  accountBreakdown: DashboardOverviewHoldingChildDto[];
  stats: TickerDetailStat[];
  dividends: {
    upcomingCount: number;
    nextPaymentDate: string | null;
    lastPostedDate: string | null;
  };
  fundamentals: {
    panels: TickerFundamentalsPanel[];
  };
}

interface FetchTickerDetailsOptions {
  ticker: string;
  accountId?: string;
  marketCode?: string;
  dashboard: DashboardSnapshot;
  transactions: TransactionHistoryItemDto[];
  instrument: InstrumentCatalogItemDto | null;
}

interface TickerDetailsRequest {
  ticker: string;
  accountId?: string;
  marketCode?: string;
  range?: TickerChartRange;
  startDate?: string;
  endDate?: string;
  instrument?: InstrumentCatalogItemDto | null;
  transactions?: TransactionHistoryItemDto[];
}

const DEFAULT_TICKER_CHART_RANGE: TickerChartRange = "1Y";

function buildFallbackChartMetadata(
  range: TickerChartSelection,
  points: TickerDetailChartPoint[],
): TickerDetailsChartMetadataDto {
  const startDate = points[0]?.date ?? null;
  const endDate = points.at(-1)?.date ?? null;
  return {
    requested: {
      range: range === "CUSTOM" ? null : range,
      startDate: range === "CUSTOM" ? startDate : null,
      endDate: range === "CUSTOM" ? endDate : null,
    },
    resolved: {
      range,
      startDate,
      endDate,
    },
    available: {
      startDate,
      endDate,
    },
    truncated: {
      startDate: false,
      endDate: false,
    },
  };
}

function findHolding(
  dashboard: DashboardSnapshot,
  ticker: string,
  accountId?: string,
  marketCode?: string,
): DashboardOverviewHoldingDto | DashboardOverviewHoldingGroupDto | undefined {
  if (accountId) {
    return dashboard.holdings.find(
      (holding) => holding.ticker === ticker
        && holding.accountId === accountId
        && (!marketCode || holding.marketCode === marketCode),
    );
  }

  return findHoldingGroup(
    resolveHoldingGroups({
      holdings: dashboard.holdings,
      holdingGroups: dashboard.holdingGroups,
      instruments: dashboard.instruments,
      accounts: dashboard.accounts,
    }),
    ticker,
    marketCode,
  ) ?? undefined;
}

function buildFallbackChartPoints(
  transactions: TransactionHistoryItemDto[],
  holding: DashboardOverviewHoldingDto | DashboardOverviewHoldingGroupDto | undefined,
): TickerDetailChartPoint[] {
  const chronological = [...transactions].sort((left, right) =>
    left.tradeDate.localeCompare(right.tradeDate) || left.id.localeCompare(right.id),
  );

  let runningQuantity = 0;
  let runningCostBasis = 0;
  const points: TickerDetailChartPoint[] = chronological.map((transaction) => {
    if (transaction.type === "BUY") {
      runningQuantity += transaction.quantity;
      runningCostBasis += transaction.unitPrice * transaction.quantity;
    } else {
      const averageCost = runningQuantity > 0 ? runningCostBasis / runningQuantity : 0;
      runningQuantity = Math.max(0, runningQuantity - transaction.quantity);
      runningCostBasis = Math.max(0, runningCostBasis - averageCost * transaction.quantity);
    }

    return {
      date: transaction.tradeDate,
      label: transaction.tradeDate,
      price: transaction.unitPrice,
      averageCost: runningQuantity > 0 ? runningCostBasis / runningQuantity : null,
      quantity: runningQuantity,
    };
  });

  if (holding?.currentUnitPrice != null) {
    points.push({
      date: new Date().toISOString().slice(0, 10),
      label: "Now",
      price: holding.currentUnitPrice,
      averageCost: holding.averageCostPerShare,
      quantity: holding.quantity,
    });
  }

  if (points.length === 0) {
    points.push({
      date: new Date().toISOString().slice(0, 10),
      label: "Now",
      price: holding?.currentUnitPrice ?? null,
      averageCost: holding?.averageCostPerShare ?? null,
      quantity: holding?.quantity ?? 0,
    });
  }

  return points;
}

function buildFallbackFundamentals(
  instrument: InstrumentCatalogItemDto | null,
  holding: DashboardOverviewHoldingDto | DashboardOverviewHoldingGroupDto | undefined,
): TickerFundamentalsPanel[] {
  return [
    {
      key: "instrument",
      title: "Instrument",
      items: [
        {
          key: "market",
          label: "Market",
          value: instrument?.marketCode ?? null,
          source: instrument ? "portfolio" : null,
          asOf: null,
        },
        {
          key: "type",
          label: "Type",
          value: instrument?.instrumentType ?? null,
          source: instrument ? "portfolio" : null,
          asOf: null,
        },
        {
          key: "quoteStatus",
          label: "Quote status",
          value: holding?.quoteStatus ?? null,
          source: holding ? "dashboard" : null,
          asOf: null,
        },
        {
          key: "industryGroup",
          label: "Industry group",
          value: instrument?.gicsIndustryGroup ?? null,
          source: instrument?.gicsIndustryGroup ? "catalog" : null,
          asOf: null,
        },
      ],
    },
    {
      key: "pricing",
      title: "Pricing",
      items: [
        {
          key: "previousClose",
          label: "Previous close",
          value: holding?.previousClose ?? null,
          source: holding?.previousClose != null ? "dashboard" : null,
          asOf: null,
        },
        {
          key: "currentPrice",
          label: "Current price",
          value: holding?.currentUnitPrice ?? null,
          source: holding?.currentUnitPrice != null ? "dashboard" : null,
          asOf: null,
        },
        {
          key: "changePercent",
          label: "Day change %",
          value: holding?.changePercent ?? null,
          source: holding?.changePercent != null ? "dashboard" : null,
          asOf: null,
        },
        {
          key: "freshness",
          label: "Freshness",
          value: holding?.freshness ?? null,
          source: holding?.freshness ? "dashboard" : null,
          asOf: null,
        },
      ],
    },
  ];
}

export function buildPrimaryTickerDetails({
  ticker,
  accountId,
  marketCode,
  dashboard,
  transactions,
  instrument,
}: FetchTickerDetailsOptions): TickerDetailsModel {
  const holding = findHolding(dashboard, ticker, accountId, marketCode);
  const resolvedGroups = resolveHoldingGroups({
    holdings: dashboard.holdings,
    holdingGroups: dashboard.holdingGroups,
    instruments: dashboard.instruments,
    accounts: dashboard.accounts,
  });
  const holdingGroup = findHoldingGroup(resolvedGroups, ticker, marketCode) ?? null;
  const realizedPnl = transactions.reduce((sum, transaction) => sum + (transaction.realizedPnlAmount ?? 0), 0);
  const currency = holding?.currency ?? transactions[0]?.priceCurrency ?? "TWD";
  const upcomingDividends = dashboard.dividends.upcoming.filter(
    (dividend) => dividend.ticker === ticker && (!accountId || dividend.accountId === accountId),
  );
  const recentDividends = dashboard.dividends.recent.filter(
    (dividend) => dividend.ticker === ticker && (!accountId || dividend.accountId === accountId),
  );
  const fallbackChartPoints = buildFallbackChartPoints(transactions, holding);

  return {
    identity: {
      ticker,
      name: instrument?.name ?? null,
      marketCode: marketCode ?? instrument?.marketCode ?? transactions[0]?.marketCode ?? "TW",
      instrumentType: instrument?.instrumentType ?? transactions[0]?.instrumentType ?? null,
      currency,
    },
    quote: {
      currentPrice: holding?.currentUnitPrice ?? null,
      previousClose: holding?.previousClose ?? null,
      changeAmount: holding?.change ?? null,
      changePercent: holding?.changePercent ?? null,
      quoteStatus: holding?.quoteStatus ?? "missing",
      freshness: holding?.freshness ?? "current",
      freshnessTooltip: holding?.freshnessTooltip ?? null,
    },
    position: {
      accountScope: accountId ?? marketCode ?? "all",
      quantity: holding?.quantity ?? 0,
      averageCost: holding?.averageCostPerShare ?? null,
      costBasis: holding?.costBasisAmount ?? null,
      marketValue: holding?.marketValueAmount ?? null,
      unrealizedPnl: holding?.unrealizedPnlAmount ?? null,
      realizedPnl,
      transactionsCount: transactions.length,
      nextDividendDate: holding?.nextDividendDate ?? null,
      lastDividendPostedDate: holding?.lastDividendPostedDate ?? null,
    },
    chart: {
      range: DEFAULT_TICKER_CHART_RANGE,
      metadata: buildFallbackChartMetadata(DEFAULT_TICKER_CHART_RANGE, fallbackChartPoints),
      points: fallbackChartPoints,
    },
    holdingGroup,
    accountBreakdown: holdingGroup?.children ?? [],
    stats: [
      { label: "Quantity", value: holding?.quantity ?? 0, unit: "shares" },
      { label: "Avg cost", value: holding?.averageCostPerShare ?? null, unit: currency },
      { label: "Market value", value: holding?.marketValueAmount ?? null, unit: currency },
      { label: "Total cost", value: holding?.costBasisAmount ?? null, unit: currency },
      { label: "Unrealized P&L", value: holding?.unrealizedPnlAmount ?? null, unit: currency },
      { label: "Realized P&L", value: realizedPnl, unit: currency },
    ],
    dividends: {
      upcomingCount: upcomingDividends.length,
      nextPaymentDate: upcomingDividends[0]?.paymentDate ?? null,
      lastPostedDate: recentDividends[0]?.postedAt ?? holding?.lastDividendPostedDate ?? null,
    },
    fundamentals: {
      panels: buildFallbackFundamentals(instrument, holding),
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeWithFallback(
  payload: unknown,
  fallback: TickerDetailsModel,
): TickerDetailsModel {
  if (!isObject(payload)) return fallback;

  return {
    identity: {
      ...fallback.identity,
      ...(isObject(payload.identity) ? payload.identity : {}),
    },
    quote: {
      ...fallback.quote,
      ...(isObject(payload.quote) ? payload.quote : {}),
    },
    position: {
      ...fallback.position,
      ...(isObject(payload.position) ? payload.position : {}),
    },
    chart: {
      range: fallback.chart.range,
      metadata: fallback.chart.metadata,
      points:
        isObject(payload.chart) && Array.isArray(payload.chart.points)
          ? (payload.chart.points as TickerDetailChartPoint[])
          : fallback.chart.points,
    },
    holdingGroup: isObject(payload.holdingGroup)
      ? (payload.holdingGroup as unknown as DashboardOverviewHoldingGroupDto)
      : fallback.holdingGroup,
    accountBreakdown: Array.isArray(payload.accountBreakdown)
      ? (payload.accountBreakdown as DashboardOverviewHoldingChildDto[])
      : fallback.accountBreakdown,
    stats: Array.isArray(payload.stats) ? (payload.stats as TickerDetailStat[]) : fallback.stats,
    dividends: {
      ...fallback.dividends,
      ...(isObject(payload.dividends) ? payload.dividends : {}),
    },
    fundamentals: {
      panels:
        isObject(payload.fundamentals) && Array.isArray(payload.fundamentals.panels)
          ? (payload.fundamentals.panels as TickerFundamentalsPanel[])
          : fallback.fundamentals.panels,
    },
  };
}

function mapApiFundamentalsToPanels(
  payload: TickerDetailsDto["fundamentals"],
): TickerFundamentalsPanel[] {
  return [
    {
      key: "valuation",
      title: "Valuation",
      items: [
        { key: "marketCap", label: "Market cap", ...payload.marketCap },
        { key: "enterpriseValue", label: "Enterprise value", ...payload.enterpriseValue },
        { key: "priceEarningsRatio", label: "P/E ratio", ...payload.priceEarningsRatio },
        { key: "priceBookRatio", label: "P/B ratio", ...payload.priceBookRatio },
        { key: "dividendYield", label: "Dividend yield", ...payload.dividendYield },
      ],
    },
    {
      key: "profitability",
      title: "Profitability",
      items: [
        { key: "earningsPerShare", label: "EPS", ...payload.earningsPerShare },
        { key: "revenueTrailingTwelveMonths", label: "Revenue TTM", ...payload.revenueTrailingTwelveMonths },
        { key: "netIncomeTrailingTwelveMonths", label: "Net income TTM", ...payload.netIncomeTrailingTwelveMonths },
      ],
    },
  ];
}

function mapApiChartPoints(
  payload: TickerDetailsDto["chart"],
  fallback: TickerDetailsModel,
): TickerDetailChartPoint[] {
  return payload.points.map((point) => ({
    date: point.date,
    label: point.date,
    price: point.close,
    averageCost: fallback.position.averageCost,
    quantity: fallback.position.quantity,
  }));
}

function normalizeApiChartPayload(
  payload: TickerDetailsDto["chart"],
  fallbackChart: TickerDetailsModel["chart"],
): TickerDetailsDto["chart"] {
  const range = payload.range && (payload.range === "CUSTOM" || TICKER_CHART_RANGES.includes(payload.range as TickerChartRange))
    ? payload.range
    : fallbackChart.range;
  const metadata = isObject(payload.metadata)
    ? payload.metadata as TickerDetailsDto["chart"]["metadata"]
    : buildApiChartMetadata(range, payload.points);
  return {
    range,
    metadata,
    points: payload.points,
  };
}

function buildApiChartMetadata(
  range: TickerChartSelection,
  points: TickerDetailsDto["chart"]["points"],
): TickerDetailsDto["chart"]["metadata"] {
  const startDate = points[0]?.date ?? null;
  const endDate = points.at(-1)?.date ?? null;
  return {
    requested: {
      range: range === "CUSTOM" ? null : range,
      startDate: null,
      endDate: null,
    },
    resolved: {
      range,
      startDate,
      endDate,
    },
    available: {
      startDate,
      endDate,
    },
    truncated: {
      startDate: false,
      endDate: false,
    },
  };
}

function roundToDecimal(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function deriveQuoteFromChartPoints(
  payload: TickerDetailsDto["chart"],
): Pick<TickerDetailsModel["quote"], "currentPrice" | "previousClose" | "changeAmount" | "changePercent" | "quoteStatus"> | null {
  const latest = payload.points.at(-1);
  if (!latest) return null;
  if (payload.metadata.available.endDate !== latest.date) return null;

  const previous = payload.points.length >= 2 ? payload.points[payload.points.length - 2] : null;
  const previousClose = previous?.close ?? null;
  const changeAmount = previousClose === null ? null : roundToDecimal(latest.close - previousClose, 4);
  const changePercent = previousClose === null || previousClose === 0
    ? null
    : roundToDecimal(((latest.close - previousClose) / previousClose) * 100, 4);

  return {
    currentPrice: latest.close,
    previousClose,
    changeAmount,
    changePercent,
    quoteStatus: "current",
  };
}

function withDerivedSnapshotValuation(
  fallback: TickerDetailsModel,
  chart: TickerDetailsDto["chart"],
): TickerDetailsModel {
  if (fallback.quote.currentPrice !== null) return fallback;

  const derivedQuote = deriveQuoteFromChartPoints(chart);
  if (!derivedQuote || fallback.position.quantity <= 0) return fallback;
  const currentPrice = derivedQuote.currentPrice;
  if (currentPrice === null) return fallback;

  const marketValue = roundToDecimal(fallback.position.quantity * currentPrice, 2);
  const unrealizedPnl = fallback.position.costBasis === null
    ? fallback.position.unrealizedPnl
    : roundToDecimal(marketValue - fallback.position.costBasis, 2);

  const accountMarketValues = fallback.accountBreakdown.map((child) =>
    roundToDecimal(child.quantity * currentPrice, 2),
  );
  const accountMarketValueTotal = accountMarketValues.reduce((sum, value) => sum + value, 0);

  const enrichChild = (child: DashboardOverviewHoldingChildDto, index: number): DashboardOverviewHoldingChildDto => {
    const childMarketValue = accountMarketValues[index] ?? roundToDecimal(child.quantity * currentPrice, 2);
    const childUnrealizedPnl = roundToDecimal(childMarketValue - child.costBasisAmount, 2);
    const allocationPercent = accountMarketValueTotal > 0
      ? roundToDecimal((childMarketValue / accountMarketValueTotal) * 100, 4)
      : child.reportingAllocationPercent;
    const canDeriveReportingAmounts = child.reportingCurrency === child.currency;

    return {
      ...child,
      currentUnitPrice: currentPrice,
      marketValueAmount: childMarketValue,
      unrealizedPnlAmount: childUnrealizedPnl,
      change: derivedQuote.changeAmount,
      changePercent: derivedQuote.changePercent,
      previousClose: derivedQuote.previousClose,
      quoteStatus: derivedQuote.quoteStatus,
      reportingMarketValueAmount: child.reportingMarketValueAmount ?? (canDeriveReportingAmounts ? childMarketValue : null),
      reportingUnrealizedPnlAmount: child.reportingUnrealizedPnlAmount ?? (canDeriveReportingAmounts ? childUnrealizedPnl : null),
      reportingDailyChangeAmount: derivedQuote.changeAmount === null
        ? child.reportingDailyChangeAmount
        : child.reportingDailyChangeAmount ?? (canDeriveReportingAmounts ? roundToDecimal(derivedQuote.changeAmount * child.quantity, 2) : null),
      allocationPct: allocationPercent,
      reportingAllocationPercent: allocationPercent,
      allocationBasisUsed: "market_value",
      allocationBasisFallbackReason: null,
    };
  };

  const accountBreakdown = fallback.accountBreakdown.map(enrichChild);
  const holdingGroup = fallback.holdingGroup
    ? {
        ...fallback.holdingGroup,
        currentUnitPrice: currentPrice,
        marketValueAmount: marketValue,
        unrealizedPnlAmount: unrealizedPnl,
        change: derivedQuote.changeAmount,
        changePercent: derivedQuote.changePercent,
        previousClose: derivedQuote.previousClose,
        quoteStatus: derivedQuote.quoteStatus,
        reportingMarketValueAmount: fallback.holdingGroup.reportingMarketValueAmount
          ?? (fallback.holdingGroup.reportingCurrency === fallback.holdingGroup.currency ? marketValue : null),
        reportingUnrealizedPnlAmount: fallback.holdingGroup.reportingUnrealizedPnlAmount
          ?? (fallback.holdingGroup.reportingCurrency === fallback.holdingGroup.currency ? unrealizedPnl : null),
        reportingDailyChangeAmount: derivedQuote.changeAmount === null
          ? fallback.holdingGroup.reportingDailyChangeAmount
          : fallback.holdingGroup.reportingDailyChangeAmount
            ?? (fallback.holdingGroup.reportingCurrency === fallback.holdingGroup.currency
              ? roundToDecimal(derivedQuote.changeAmount * fallback.position.quantity, 2)
              : null),
        allocationBasisUsed: "market_value" as const,
        allocationBasisFallbackReason: null,
        children: accountBreakdown,
      }
    : fallback.holdingGroup;

  return {
    ...fallback,
    quote: {
      ...fallback.quote,
      ...derivedQuote,
    },
    position: {
      ...fallback.position,
      marketValue,
      unrealizedPnl,
    },
    holdingGroup,
    accountBreakdown,
  };
}

function mapApiDetailsToModel(
  payload: TickerDetailsDto,
  fallback: TickerDetailsModel,
): TickerDetailsModel {
  const currency = payload.identity.priceCurrency;
  const firstUpcoming = payload.dividends.upcoming[0];
  const firstRecent = payload.dividends.recent[0];
  const quote = payload.quote.currentUnitPrice === null && fallback.quote.currentPrice !== null
    ? fallback.quote
    : {
        currentPrice: payload.quote.currentUnitPrice,
        previousClose: payload.quote.previousClose,
        changeAmount: payload.quote.change,
        changePercent: payload.quote.changePercent,
        quoteStatus: payload.quote.quoteStatus,
        freshness: fallback.quote.freshness,
        freshnessTooltip: fallback.quote.freshnessTooltip,
      };
  const position = {
    accountScope: payload.identity.accountId ?? "all",
    quantity: payload.position.quantity,
    averageCost: payload.position.averageCostPerShare,
    costBasis: payload.position.costBasisAmount,
    marketValue: payload.position.marketValueAmount ?? fallback.position.marketValue,
    unrealizedPnl: payload.position.unrealizedPnlAmount ?? fallback.position.unrealizedPnl,
    realizedPnl: payload.position.realizedPnlAmount,
    transactionsCount: payload.transactions.length,
    nextDividendDate: firstUpcoming?.paymentDate ?? firstUpcoming?.exDividendDate ?? null,
    lastDividendPostedDate: firstRecent?.postedAt ?? null,
  };
  const chartFallback = { ...fallback, position };
  const chart = normalizeApiChartPayload(payload.chart, chartFallback.chart);
  const holdingGroup = payload.holdingGroup?.reportingMarketValueAmount === null && fallback.holdingGroup?.reportingMarketValueAmount !== null
    ? fallback.holdingGroup
    : payload.holdingGroup;
  const accountBreakdown = payload.accountBreakdown.some((row) => row.reportingMarketValueAmount !== null)
    || fallback.accountBreakdown.every((row) => row.reportingMarketValueAmount === null)
    ? payload.accountBreakdown
    : fallback.accountBreakdown;

  return {
    identity: {
      ticker: payload.identity.ticker,
      name: payload.identity.name,
      marketCode: payload.identity.marketCode,
      instrumentType: payload.identity.instrumentType,
      currency,
    },
    quote,
    position,
    chart: {
      range: chart.range,
      metadata: chart.metadata,
      points: mapApiChartPoints(chart, chartFallback),
    },
    holdingGroup,
    accountBreakdown,
    stats: fallback.stats,
    dividends: {
      upcomingCount: payload.dividends.upcoming.length,
      nextPaymentDate: firstUpcoming?.paymentDate ?? null,
      lastPostedDate: firstRecent?.postedAt ?? null,
    },
    fundamentals: {
      panels: mapApiFundamentalsToPanels(payload.fundamentals),
    },
  };
}

function isTickerDetailsDto(value: unknown): value is TickerDetailsDto {
  return isObject(value)
    && isObject(value.identity)
    && isObject(value.quote)
    && isObject(value.position)
    && isObject(value.chart)
    && Array.isArray(value.chart.points)
    && Array.isArray(value.transactions)
    && isObject(value.dividends)
    && isObject(value.fundamentals);
}

function isTickerEnrichmentDto(value: unknown): value is TickerEnrichmentDto {
  return isObject(value)
    && isObject(value.identity)
    && isObject(value.chart)
    && Array.isArray(value.chart.points)
    && isObject(value.fundamentals)
    && isObject(value.fundamentalsRefresh);
}

export async function fetchTickerDetails(
  options: FetchTickerDetailsOptions,
): Promise<TickerDetailsModel> {
  const fallback = buildPrimaryTickerDetails(options);
  return fetchTickerDetailsFromEndpoint({
    ticker: options.ticker,
    accountId: options.accountId,
    marketCode: options.marketCode,
    instrument: options.instrument,
    transactions: options.transactions,
    primaryDetails: fallback,
  }, "details");
}

function buildTickerDetailsPath(request: TickerDetailsRequest, endpoint: "details" | "enrichment"): string {
  const params = new URLSearchParams();
  if (request.accountId) {
    params.set("accountId", request.accountId);
  }
  const marketCode = request.marketCode ?? request.instrument?.marketCode ?? request.transactions?.[0]?.marketCode;
  if (marketCode) {
    params.set("marketCode", marketCode);
  }
  if (request.startDate && request.endDate) {
    params.set("startDate", request.startDate);
    params.set("endDate", request.endDate);
  } else if (request.range) {
    params.set("range", request.range);
  }

  return `/tickers/${encodeURIComponent(request.ticker)}/${endpoint}${params.toString() ? `?${params.toString()}` : ""}`;
}

function mapApiEnrichmentToModel(
  payload: TickerEnrichmentDto,
  fallback: TickerDetailsModel,
): TickerDetailsModel {
  const chart = normalizeApiChartPayload(payload.chart, fallback.chart);
  const enrichedFallback = withDerivedSnapshotValuation(fallback, chart);

  return {
    ...enrichedFallback,
    identity: {
      ticker: payload.identity.ticker,
      name: payload.identity.name,
      marketCode: payload.identity.marketCode,
      instrumentType: payload.identity.instrumentType,
      currency: payload.identity.priceCurrency,
    },
    chart: {
      range: chart.range,
      metadata: chart.metadata,
      points: mapApiChartPoints(chart, enrichedFallback),
    },
    holdingGroup: enrichedFallback.holdingGroup,
    accountBreakdown: enrichedFallback.accountBreakdown,
    fundamentals: {
      panels: mapApiFundamentalsToPanels(payload.fundamentals),
    },
  };
}

export async function fetchTickerDetailsHydration({
  ticker,
  accountId,
  marketCode,
  range,
  startDate,
  endDate,
  instrument = null,
  transactions = [],
  primaryDetails,
}: TickerDetailsRequest & {
  primaryDetails: TickerDetailsModel;
}): Promise<TickerDetailsModel> {
  return fetchTickerDetailsFromEndpoint({
    ticker,
    accountId,
    marketCode,
    range,
    startDate,
    endDate,
    instrument,
    transactions,
    primaryDetails,
  }, "enrichment");
}

export async function fetchTickerDetailsFullRefresh({
  ticker,
  accountId,
  marketCode,
  range,
  startDate,
  endDate,
  instrument = null,
  transactions = [],
  primaryDetails,
}: TickerDetailsRequest & {
  primaryDetails: TickerDetailsModel;
}): Promise<TickerDetailsModel> {
  return fetchTickerDetailsFromEndpoint({
    ticker,
    accountId,
    marketCode,
    range,
    startDate,
    endDate,
    instrument,
    transactions,
    primaryDetails,
  }, "details");
}

export async function fetchTickerDetailsEnrichment({
  ticker,
  accountId,
  marketCode,
  range,
  startDate,
  endDate,
  instrument = null,
  transactions = [],
  primaryDetails,
}: TickerDetailsRequest & {
  primaryDetails: TickerDetailsModel;
}): Promise<TickerDetailsModel> {
  return fetchTickerDetailsFromEndpoint({
    ticker,
    accountId,
    marketCode,
    range,
    startDate,
    endDate,
    instrument,
    transactions,
    primaryDetails,
  }, "enrichment");
}

async function fetchTickerDetailsFromEndpoint({
  ticker,
  accountId,
  marketCode,
  range,
  startDate,
  endDate,
  instrument = null,
  transactions = [],
  primaryDetails,
}: TickerDetailsRequest & {
  primaryDetails: TickerDetailsModel;
}, endpoint: "details" | "enrichment"): Promise<TickerDetailsModel> {
  const path = buildTickerDetailsPath({ ticker, accountId, marketCode, range, startDate, endDate, instrument, transactions }, endpoint);

  try {
    const payload = await getJson<unknown>(path);
    if (isTickerDetailsDto(payload)) {
      return mapApiDetailsToModel(payload, primaryDetails);
    }
    if (isTickerEnrichmentDto(payload)) {
      return mapApiEnrichmentToModel(payload, primaryDetails);
    }
    return mergeWithFallback(payload, primaryDetails);
  } catch {
    return primaryDetails;
  }
}
