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
          value: "missing",
          source: null,
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
          value: null,
          source: null,
          asOf: null,
        },
        {
          key: "currentPrice",
          label: "Current price",
          value: null,
          source: null,
          asOf: null,
        },
        {
          key: "changePercent",
          label: "Day change %",
          value: null,
          source: null,
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
  const realizedPnl = transactions.reduce((sum, transaction) => sum + (transaction.realizedPnlAmount ?? 0), 0);
  const currency = holding?.currency ?? transactions[0]?.priceCurrency ?? "TWD";
  const upcomingDividends = dashboard.dividends.upcoming.filter(
    (dividend) => dividend.ticker === ticker && (!accountId || dividend.accountId === accountId),
  );
  const recentDividends = dashboard.dividends.recent.filter(
    (dividend) => dividend.ticker === ticker && (!accountId || dividend.accountId === accountId),
  );

  return {
    identity: {
      ticker,
      name: instrument?.name ?? null,
      marketCode: marketCode ?? instrument?.marketCode ?? transactions[0]?.marketCode ?? "TW",
      instrumentType: instrument?.instrumentType ?? transactions[0]?.instrumentType ?? null,
      currency,
    },
    quote: {
      currentPrice: null,
      previousClose: null,
      changeAmount: null,
      changePercent: null,
      quoteStatus: "missing",
      freshness: holding?.freshness ?? "current",
      freshnessTooltip: holding?.freshnessTooltip ?? null,
    },
    position: {
      accountScope: accountId ?? marketCode ?? "all",
      quantity: holding?.quantity ?? 0,
      averageCost: holding?.averageCostPerShare ?? null,
      costBasis: holding?.costBasisAmount ?? null,
      marketValue: null,
      unrealizedPnl: null,
      realizedPnl,
      transactionsCount: transactions.length,
      nextDividendDate: holding?.nextDividendDate ?? null,
      lastDividendPostedDate: holding?.lastDividendPostedDate ?? null,
    },
    chart: {
      range: DEFAULT_TICKER_CHART_RANGE,
      metadata: buildFallbackChartMetadata(DEFAULT_TICKER_CHART_RANGE, []),
      points: [],
    },
    holdingGroup: null,
    accountBreakdown: [],
    stats: [
      { label: "Quantity", value: holding?.quantity ?? 0, unit: "shares" },
      { label: "Avg cost", value: holding?.averageCostPerShare ?? null, unit: currency },
      { label: "Market value", value: null, unit: currency },
      { label: "Total cost", value: holding?.costBasisAmount ?? null, unit: currency },
      { label: "Unrealized P&L", value: null, unit: currency },
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

function mapApiDetailsToModel(
  payload: TickerDetailsDto,
  fallback: TickerDetailsModel,
): TickerDetailsModel {
  const currency = payload.identity.priceCurrency;
  const firstUpcoming = payload.dividends.upcoming[0];
  const firstRecent = payload.dividends.recent[0];
  const quote = {
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
    marketValue: payload.position.marketValueAmount,
    unrealizedPnl: payload.position.unrealizedPnlAmount,
    realizedPnl: payload.position.realizedPnlAmount,
    transactionsCount: payload.transactions.length,
    nextDividendDate: firstUpcoming?.paymentDate ?? firstUpcoming?.exDividendDate ?? null,
    lastDividendPostedDate: firstRecent?.postedAt ?? null,
  };
  const chartFallback = { ...fallback, position };
  const chart = normalizeApiChartPayload(payload.chart, chartFallback.chart);
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
    holdingGroup: payload.holdingGroup,
    accountBreakdown: payload.accountBreakdown,
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

  return {
    ...fallback,
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
      points: mapApiChartPoints(chart, fallback),
    },
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
