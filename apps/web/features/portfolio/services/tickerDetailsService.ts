import type {
  DashboardOverviewHoldingDto,
  InstrumentCatalogItemDto,
  TickerDetailsDto,
  TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import { getJson } from "../../../lib/api";
import type { DashboardSnapshot } from "../../dashboard/types";
import { findHoldingGroup, resolveHoldingGroups, type DashboardOverviewHoldingGroupDto } from "../holdingGroups";

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
    points: TickerDetailChartPoint[];
  };
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
  instrument?: InstrumentCatalogItemDto | null;
  transactions?: TransactionHistoryItemDto[];
}

function findHolding(
  dashboard: DashboardSnapshot,
  ticker: string,
  accountId?: string,
  marketCode?: string,
): DashboardOverviewHoldingDto | DashboardOverviewHoldingGroupDto | undefined {
  if (accountId) {
    return dashboard.holdings.find(
      (holding) => holding.ticker === ticker && holding.accountId === accountId,
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
      points: buildFallbackChartPoints(transactions, holding),
    },
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
      points:
        isObject(payload.chart) && Array.isArray(payload.chart.points)
          ? (payload.chart.points as TickerDetailChartPoint[])
          : fallback.chart.points,
    },
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

function mapApiDetailsToModel(
  payload: TickerDetailsDto,
  fallback: TickerDetailsModel,
): TickerDetailsModel {
  const currency = payload.identity.priceCurrency;
  const firstUpcoming = payload.dividends.upcoming[0];
  const firstRecent = payload.dividends.recent[0];

  return {
    identity: {
      ticker: payload.identity.ticker,
      name: payload.identity.name,
      marketCode: payload.identity.marketCode,
      instrumentType: payload.identity.instrumentType,
      currency,
    },
    quote: {
      currentPrice: payload.quote.currentUnitPrice,
      previousClose: payload.quote.previousClose,
      changeAmount: payload.quote.change,
      changePercent: payload.quote.changePercent,
      quoteStatus: payload.quote.quoteStatus,
      freshness: fallback.quote.freshness,
      freshnessTooltip: fallback.quote.freshnessTooltip,
    },
    position: {
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
    },
    chart: {
      points: payload.chart.points.length > 0
        ? payload.chart.points.map((point) => ({
            date: point.date,
            label: point.date,
            price: point.close,
            averageCost: payload.position.averageCostPerShare,
            quantity: payload.position.quantity,
          }))
        : fallback.chart.points,
    },
    stats: fallback.stats,
    dividends: {
      upcomingCount: payload.dividends.upcoming.length,
      nextPaymentDate: firstUpcoming?.paymentDate ?? null,
      lastPostedDate: firstRecent?.postedAt ?? null,
    },
    fundamentals: {
      panels: [
        {
          key: "valuation",
          title: "Valuation",
          items: [
            { key: "marketCap", label: "Market cap", ...payload.fundamentals.marketCap },
            { key: "enterpriseValue", label: "Enterprise value", ...payload.fundamentals.enterpriseValue },
            { key: "priceEarningsRatio", label: "P/E ratio", ...payload.fundamentals.priceEarningsRatio },
            { key: "priceBookRatio", label: "P/B ratio", ...payload.fundamentals.priceBookRatio },
            { key: "dividendYield", label: "Dividend yield", ...payload.fundamentals.dividendYield },
          ],
        },
        {
          key: "profitability",
          title: "Profitability",
          items: [
            { key: "earningsPerShare", label: "EPS", ...payload.fundamentals.earningsPerShare },
            { key: "revenueTrailingTwelveMonths", label: "Revenue TTM", ...payload.fundamentals.revenueTrailingTwelveMonths },
            { key: "netIncomeTrailingTwelveMonths", label: "Net income TTM", ...payload.fundamentals.netIncomeTrailingTwelveMonths },
          ],
        },
      ],
    },
  };
}

function isTickerDetailsDto(value: unknown): value is TickerDetailsDto {
  return isObject(value)
    && isObject(value.identity)
    && isObject(value.quote)
    && isObject(value.position)
    && isObject(value.chart)
    && Array.isArray(value.transactions)
    && isObject(value.dividends)
    && isObject(value.fundamentals);
}

export async function fetchTickerDetails(
  options: FetchTickerDetailsOptions,
): Promise<TickerDetailsModel> {
  const fallback = buildPrimaryTickerDetails(options);
  return fetchTickerDetailsEnrichment({
    ticker: options.ticker,
    accountId: options.accountId,
    marketCode: options.marketCode,
    instrument: options.instrument,
    primaryDetails: fallback,
  });
}

function buildTickerDetailsPath(request: TickerDetailsRequest): string {
  const params = new URLSearchParams();
  if (request.accountId) {
    params.set("accountId", request.accountId);
  }
  const marketCode = request.marketCode ?? request.instrument?.marketCode ?? request.transactions?.[0]?.marketCode;
  if (marketCode) {
    params.set("marketCode", marketCode);
  }

  return `/tickers/${encodeURIComponent(request.ticker)}/details${params.toString() ? `?${params.toString()}` : ""}`;
}

export async function fetchTickerDetailsEnrichment({
  ticker,
  accountId,
  marketCode,
  instrument = null,
  transactions = [],
  primaryDetails,
}: TickerDetailsRequest & {
  primaryDetails: TickerDetailsModel;
}): Promise<TickerDetailsModel> {
  const path = buildTickerDetailsPath({ ticker, accountId, marketCode, instrument, transactions });

  try {
    const payload = await getJson<unknown>(path);
    if (isTickerDetailsDto(payload)) {
      return mapApiDetailsToModel(payload, primaryDetails);
    }
    return mergeWithFallback(payload, primaryDetails);
  } catch {
    return primaryDetails;
  }
}
