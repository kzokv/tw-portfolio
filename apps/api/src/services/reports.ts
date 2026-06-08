import type { FastifyInstance } from "fastify";
import { resolveRangeBounds, roundToDecimal, type QuoteSnapshot } from "@vakwen/domain";
import {
  MARKET_CODES,
  marketCodeFor,
  type AccountDefaultCurrency,
  type AllocationBucketDto,
  type CurrencyCode,
  type DailyReviewReportDto,
  type DashboardPerformanceDto,
  type MarketReportDto,
  type MarketCode,
  type PortfolioReportDto,
  type ReportDataHealthDto,
  type ReportFxStatusDto,
  type ReportHoldingRowDto,
  type ReportQueryStateDto,
  type ReportScope,
  type ReportSummaryTotalsDto,
} from "@vakwen/shared-types";
import { buildDashboardOverview, buildOverviewHoldingGroups } from "./dashboard.js";
import { enrichHoldingsWithFreshness } from "./dashboardFreshness.js";
import {
  translateOverviewHoldingGroups,
  translateOverviewSummary,
  translatePerformancePoints,
} from "./dashboardReportingCurrency.js";
import { resolveQuoteSnapshots, type QuoteSnapshotPair } from "./market-data/quoteSnapshotService.js";
import { isInstrumentQuoteable } from "./instrumentRegistry.js";
import { resolveEffectiveRanges, resolveReportingCurrency } from "./userPreferences.js";
import { resolveReportContext } from "./reportContext.js";
import { routeError } from "../lib/routeError.js";
import type { Store } from "../types/store.js";

export interface BuildReportInput {
  scope?: string;
  currencyMode?: string;
  currency?: string;
  range?: string;
  limit?: number;
  offset?: number;
}

interface PreparedReportData {
  reportQuery: ReportQueryStateDto;
  translatedSummary: Awaited<ReturnType<typeof translateOverviewSummary>>;
  translatedHoldingGroups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>;
  dataHealth: ReportDataHealthDto;
  fxStatus: ReportFxStatusDto;
  scopedStore: Store;
  asOf: string;
}

export async function buildDailyReviewReport(
  app: FastifyInstance,
  userId: string,
  input: BuildReportInput,
): Promise<DailyReviewReportDto> {
  const prepared = await prepareReportData(app, userId, input);
  const allRows = mapHoldingRows(prepared.translatedHoldingGroups);
  const holdings = pageRows(allRows, input.limit, input.offset);
  const suggestions = buildDailyReviewSuggestions(prepared, allRows);
  const topMovers = [...allRows]
    .sort((left, right) => Math.abs(right.dailyChangeAmount ?? 0) - Math.abs(left.dailyChangeAmount ?? 0))
    .slice(0, 5);

  return {
    query: prepared.reportQuery,
    summary: await buildSummaryTotals(app, prepared.scopedStore, prepared.reportQuery.reportingCurrency, prepared.asOf, prepared.translatedSummary),
    fxStatus: prepared.fxStatus,
    dataHealth: prepared.dataHealth,
    suggestions,
    topMovers,
    holdings,
  };
}

export async function buildPortfolioReport(
  app: FastifyInstance,
  userId: string,
  input: BuildReportInput,
): Promise<PortfolioReportDto> {
  const prepared = await prepareReportData(app, userId, input);
  const performance = await buildReportPerformance(app, userId, prepared.scopedStore, prepared.reportQuery);
  const allRows = mapHoldingRows(prepared.translatedHoldingGroups);
  const topHoldings = [...allRows]
    .sort((left, right) => (right.reportingAllocationPercent ?? 0) - (left.reportingAllocationPercent ?? 0))
    .slice(0, 10);

  return {
    query: prepared.reportQuery,
    summary: await buildSummaryTotals(app, prepared.scopedStore, prepared.reportQuery.reportingCurrency, prepared.asOf, prepared.translatedSummary),
    fxStatus: prepared.fxStatus,
    dataHealth: prepared.dataHealth,
    performance,
    allocation: {
      byMarket: buildMarketAllocations(prepared.translatedHoldingGroups),
      byAccount: buildAccountAllocations(prepared.scopedStore, prepared.translatedHoldingGroups, prepared.reportQuery.reportingCurrency),
    },
    concentration: {
      topHoldings,
    },
    income: {
      trailingDividendAmount: await buildTrailingDividendAmount(app, prepared.scopedStore, prepared.reportQuery.reportingCurrency),
      recentDividendCount: prepared.scopedStore.accounting.facts.dividendLedgerEntries.filter((entry) => entry.postingStatus === "posted").length,
    },
    holdings: pageRows(allRows, input.limit, input.offset),
  };
}

export async function buildMarketReport(
  app: FastifyInstance,
  userId: string,
  input: BuildReportInput,
): Promise<MarketReportDto> {
  const prepared = await prepareReportData(app, userId, input);
  const performance = await buildReportPerformance(app, userId, prepared.scopedStore, prepared.reportQuery);
  const allRows = mapHoldingRows(prepared.translatedHoldingGroups);

  return {
    query: prepared.reportQuery,
    summary: await buildSummaryTotals(app, prepared.scopedStore, prepared.reportQuery.reportingCurrency, prepared.asOf, prepared.translatedSummary),
    fxStatus: prepared.fxStatus,
    dataHealth: prepared.dataHealth,
    performance,
    marketSummary: buildMarketAllocations(prepared.translatedHoldingGroups),
    topHoldings: [...allRows]
      .sort((left, right) => (right.reportingMarketValueAmount ?? 0) - (left.reportingMarketValueAmount ?? 0))
      .slice(0, 10),
    detail: pageRows(allRows, input.limit, input.offset),
  };
}

async function prepareReportData(
  app: FastifyInstance,
  userId: string,
  input: BuildReportInput,
): Promise<PreparedReportData> {
  const [store, prefs] = await Promise.all([
    app.persistence.loadStore(userId),
    app.persistence.getUserPreferences(userId),
  ]);
  const { ranges } = await resolveEffectiveRanges(app.persistence, userId, prefs);
  const context = resolveReportContext({
    scope: input.scope,
    currencyMode: input.currencyMode,
    currency: input.currency,
    defaultReportingCurrency: resolveReportingCurrency(prefs),
  });
  const range = resolveReportRange(input.range, ranges);
  const scopedStore = scopeStore(store, context.scope);
  const symbols = [...new Set(
    scopedStore.accounting.projections.holdings
      .map((holding) => holding.ticker)
      .filter((symbol) => isInstrumentQuoteable(scopedStore.instruments.find((item) => item.ticker === symbol))),
  )];
  const { pairs, settledByMarket } = await buildQuoteInputs(app, scopedStore, symbols);
  const snapshotMap = await resolveQuoteSnapshots(pairs, app.persistence, settledByMarket);
  const quotes = Object.values(snapshotMap).filter((quote): quote is QuoteSnapshot => quote !== null);
  const overview = buildDashboardOverview(scopedStore, { integrityIssue: null, quotes });
  if (app.tradingCalendarCache) {
    await enrichHoldingsWithFreshness(overview.holdings, scopedStore, {
      persistence: app.persistence,
      tradingCalendar: app.tradingCalendarCache,
    });
  }
  const asOf = overview.summary.asOf;
  const translatedSummary = await translateOverviewSummary(
    overview.summary,
    overview.holdings,
    overview.dividends,
    context.reportingCurrency,
    asOf,
    app.persistence,
  );
  const translatedHoldingGroups = await translateOverviewHoldingGroups(
    buildOverviewHoldingGroups(scopedStore, overview.holdings),
    context.reportingCurrency,
    "market_value",
    asOf,
    app.persistence,
  );

  return {
    reportQuery: {
      scope: context.scope,
      currencyMode: context.currencyMode,
      currency: context.currency,
      reportingCurrency: context.reportingCurrency,
      nativeCurrency: context.nativeCurrency,
      range,
      asOf,
    },
    translatedSummary,
    translatedHoldingGroups,
    dataHealth: buildDataHealth(translatedHoldingGroups),
    fxStatus: await buildFxStatus(app, scopedStore, context.reportingCurrency, asOf),
    scopedStore,
    asOf,
  };
}

function resolveReportRange(inputRange: string | undefined, ranges: readonly string[]): string {
  const fallbackRange = ranges[0] ?? "1Y";
  if (inputRange === undefined) return fallbackRange;

  const range = inputRange.trim();
  if (!ranges.includes(range)) {
    throw routeError(400, "invalid_report_range", `range must be one of ${ranges.join(", ")}`);
  }
  return range;
}

function scopeStore(store: Store, scope: ReportScope): Store {
  if (scope === "all") return store;
  const scopedHoldings = store.accounting.projections.holdings.filter((holding) =>
    resolveHoldingMarketCode(store, holding) === scope);
  const scopedTrades = store.accounting.facts.tradeEvents.filter((trade) =>
    trade.marketCode === scope);
  const marketDividendEventIds = new Set(
    store.marketData.dividendEvents
      .filter((event) => resolveTickerMarketCode(store, event.ticker, event.cashDividendCurrency) === scope)
      .map((event) => event.id),
  );
  const scopedDividendLedgerEntries = store.accounting.facts.dividendLedgerEntries.filter((entry) =>
    marketDividendEventIds.has(entry.dividendEventId));
  const scopedDividendLedgerIds = new Set(scopedDividendLedgerEntries.map((entry) => entry.id));
  const scopedDividendEventIds = new Set(scopedDividendLedgerEntries.map((entry) => entry.dividendEventId));
  const scopedAccountIds = new Set([
    ...scopedHoldings.map((holding) => holding.accountId),
    ...scopedTrades.map((trade) => trade.accountId),
    ...scopedDividendLedgerEntries.map((entry) => entry.accountId),
  ]);
  const scopedTickers = new Set([
    ...scopedHoldings.map((holding) => holding.ticker),
    ...scopedTrades.map((trade) => trade.ticker),
    ...store.marketData.dividendEvents
      .filter((event) => marketDividendEventIds.has(event.id))
      .map((event) => event.ticker),
  ]);

  return {
    ...store,
    accounts: store.accounts.filter((account) => scopedAccountIds.has(account.id)),
    instruments: store.instruments.filter((instrument) =>
      instrument.marketCode === scope && scopedTickers.has(instrument.ticker)),
    accounting: {
      ...store.accounting,
      facts: {
        ...store.accounting.facts,
        tradeEvents: scopedTrades,
        dividendLedgerEntries: scopedDividendLedgerEntries,
        dividendDeductionEntries: store.accounting.facts.dividendDeductionEntries
          .filter((entry) => scopedDividendLedgerIds.has(entry.dividendLedgerEntryId)),
      },
      projections: {
        ...store.accounting.projections,
        holdings: scopedHoldings,
      },
    },
    marketData: {
      ...store.marketData,
      dividendEvents: store.marketData.dividendEvents.filter((entry) => scopedDividendEventIds.has(entry.id)),
    },
  };
}

function resolveHoldingMarketCode(
  store: Store,
  holding: Store["accounting"]["projections"]["holdings"][number],
): MarketCode {
  const tradeMarkets = uniqueMarketCodes(
    store.accounting.facts.tradeEvents
      .filter((trade) => trade.accountId === holding.accountId && trade.ticker === holding.ticker)
      .map((trade) => trade.marketCode),
  );
  if (tradeMarkets.length === 1) return tradeMarkets[0]!;
  return resolveTickerMarketCode(store, holding.ticker, holding.currency);
}

function resolveTickerMarketCode(
  store: Store,
  ticker: string,
  fallbackCurrency: CurrencyCode,
): MarketCode {
  const instrumentMarkets = uniqueMarketCodes(
    store.instruments
      .filter((instrument) => instrument.ticker === ticker)
      .map((instrument) => instrument.marketCode),
  );
  if (instrumentMarkets.length === 1) return instrumentMarkets[0]!;
  return marketCodeFor(fallbackCurrency);
}

function uniqueMarketCodes(values: ReadonlyArray<string>): MarketCode[] {
  return [...new Set(values)]
    .filter((market): market is MarketCode => (MARKET_CODES as readonly string[]).includes(market));
}

async function buildQuoteInputs(
  app: FastifyInstance,
  store: Store,
  tickers: ReadonlyArray<string>,
): Promise<{ pairs: QuoteSnapshotPair[]; settledByMarket: Map<MarketCode, string> }> {
  const tickerToMarkets = new Map<string, Set<MarketCode>>();
  for (const inst of store.instruments) {
    if (!(MARKET_CODES as readonly string[]).includes(inst.marketCode)) continue;
    const markets = tickerToMarkets.get(inst.ticker) ?? new Set<MarketCode>();
    markets.add(inst.marketCode as MarketCode);
    tickerToMarkets.set(inst.ticker, markets);
  }
  const pairs: QuoteSnapshotPair[] = tickers.flatMap((ticker) => {
    const markets = tickerToMarkets.get(ticker);
    return markets ? [...markets].map((marketCode) => ({ ticker, marketCode })) : [{ ticker }];
  });
  const settledByMarket = new Map<MarketCode, string>();
  for (const pair of pairs) {
    if (!pair.marketCode || settledByMarket.has(pair.marketCode as MarketCode)) continue;
    settledByMarket.set(
      pair.marketCode as MarketCode,
      await app.tradingCalendarCache.latestSettledTradingDay(pair.marketCode as MarketCode, new Date()),
    );
  }
  return { pairs, settledByMarket };
}

function mapHoldingRows(groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>): ReportHoldingRowDto[] {
  return groups.map((group) => ({
    ticker: group.ticker,
    marketCode: group.marketCode,
    accountCount: group.accountCount,
    quantity: group.quantity,
    reportingCurrency: group.reportingCurrency,
    reportingCostBasisAmount: group.reportingCostBasisAmount,
    reportingMarketValueAmount: group.reportingMarketValueAmount,
    reportingUnrealizedPnlAmount: group.reportingUnrealizedPnlAmount,
    reportingAllocationPercent: group.reportingAllocationPercent,
    dailyChangeAmount: translateDailyChange(group),
    dailyChangePercent: group.changePercent,
    quoteStatus: group.quoteStatus,
    fxStatus: group.fxStatus,
    freshness: group.freshness,
  }));
}

function translateDailyChange(row: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>[number]): number | null {
  if (row.change === null) return null;
  const nativeAmount = row.quantity * row.change;
  if (row.costBasisAmount > 0 && row.reportingCostBasisAmount !== null) {
    return roundToDecimal(nativeAmount * (row.reportingCostBasisAmount / row.costBasisAmount), 2);
  }
  if (row.marketValueAmount && row.reportingMarketValueAmount !== null) {
    return roundToDecimal(nativeAmount * (row.reportingMarketValueAmount / row.marketValueAmount), 2);
  }
  return null;
}

function buildDataHealth(groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>): ReportDataHealthDto {
  return {
    holdingCount: groups.length,
    missingQuoteCount: groups.filter((group) => group.quoteStatus === "missing").length,
    provisionalQuoteCount: groups.filter((group) => group.quoteStatus === "provisional").length,
    missingFxCount: groups.filter((group) => group.fxStatus !== "complete").length,
    staleQuoteCount: groups.filter((group) => group.freshness !== "current").length,
  };
}

async function buildFxStatus(
  app: FastifyInstance,
  store: Store,
  reportingCurrency: AccountDefaultCurrency,
  asOf: string,
): Promise<ReportFxStatusDto> {
  const nativeCurrencies = [...new Set(store.accounting.projections.holdings.map((holding) => holding.currency as AccountDefaultCurrency))];
  const missingRatePairs: Array<{ from: AccountDefaultCurrency; to: AccountDefaultCurrency }> = [];
  for (const currency of nativeCurrencies) {
    if (currency === reportingCurrency) continue;
    const rate = await app.persistence.getFxRate(currency, reportingCurrency, asOf);
    if (rate === null) missingRatePairs.push({ from: currency, to: reportingCurrency });
  }
  return {
    status: missingRatePairs.length === 0
      ? "complete"
      : missingRatePairs.length === nativeCurrencies.filter((currency) => currency !== reportingCurrency).length
        ? "missing"
        : "partial",
    reportingCurrency,
    nativeCurrencies,
    missingRatePairs,
  };
}

async function buildSummaryTotals(
  app: FastifyInstance,
  store: Store,
  reportingCurrency: AccountDefaultCurrency,
  asOf: string,
  translatedSummary: Awaited<ReturnType<typeof translateOverviewSummary>>,
): Promise<ReportSummaryTotalsDto> {
  const realizedPnlAmount = await translateTradeAmounts(
    app,
    store,
    reportingCurrency,
    "realized_pnl",
  );
  const incomeAmount = await buildTrailingDividendAmount(app, store, reportingCurrency);
  return {
    costBasisAmount: translatedSummary.totalCostAmount,
    marketValueAmount: translatedSummary.marketValueAmount,
    unrealizedPnlAmount: translatedSummary.unrealizedPnlAmount,
    realizedPnlAmount,
    dailyChangeAmount: translatedSummary.dailyChangeAmount,
    dailyChangePercent: translatedSummary.dailyChangePercent,
    incomeAmount,
  };
}

async function translateTradeAmounts(
  app: FastifyInstance,
  store: Store,
  reportingCurrency: AccountDefaultCurrency,
  _kind: "realized_pnl",
): Promise<number> {
  let total = 0;
  for (const trade of store.accounting.facts.tradeEvents) {
    if (trade.realizedPnlAmount === undefined || trade.realizedPnlAmount === null) continue;
    const currency = (trade.realizedPnlCurrency ?? trade.priceCurrency) as AccountDefaultCurrency;
    const fx = currency === reportingCurrency ? 1 : await app.persistence.getFxRate(currency, reportingCurrency, trade.tradeDate);
    if (fx === null) continue;
    total += trade.realizedPnlAmount * fx;
  }
  return roundToDecimal(total, 2);
}

async function buildTrailingDividendAmount(
  app: FastifyInstance,
  store: Store,
  reportingCurrency: AccountDefaultCurrency,
): Promise<number> {
  let total = 0;
  for (const entry of store.accounting.facts.dividendLedgerEntries) {
    if (entry.postingStatus !== "posted" || entry.receivedCashAmount === 0) continue;
    const event = store.marketData.dividendEvents.find((candidate) => candidate.id === entry.dividendEventId);
    const currency = (event?.cashDividendCurrency ?? "TWD") as AccountDefaultCurrency;
    const date = event?.paymentDate ?? event?.exDividendDate ?? new Date().toISOString().slice(0, 10);
    const fx = currency === reportingCurrency ? 1 : await app.persistence.getFxRate(currency, reportingCurrency, date);
    if (fx === null) continue;
    total += entry.receivedCashAmount * fx;
  }
  return roundToDecimal(total, 2);
}

async function buildReportPerformance(
  app: FastifyInstance,
  userId: string,
  scopedStore: Store,
  query: ReportQueryStateDto,
): Promise<DashboardPerformanceDto> {
  const range = query.range ?? "1Y";
  if (query.scope === "all") {
    return translatePerformancePoints(userId, range, query.asOf, query.reportingCurrency, app.persistence, scopedStore, []);
  }

  const earliestTradeDate = scopedStore.accounting.facts.tradeEvents
    .map((trade) => trade.tradeDate)
    .sort()[0];
  const { startDate, endDate } = resolveRangeBounds(range, query.asOf, earliestTradeDate);
  const pairs = [...new Set(scopedStore.accounting.facts.tradeEvents.map((trade) => `${trade.accountId}:${trade.ticker}`))]
    .map((key) => {
      const [accountId, ticker] = key.split(":");
      return { accountId, ticker };
    });
  const byDate = new Map<string, DashboardPerformanceDto["points"][number]>();

  for (const pair of pairs) {
    const snapshots = await app.persistence.getHoldingSnapshotsForTicker(userId, pair.accountId, pair.ticker, startDate, endDate);
    for (const snapshot of snapshots) {
      const current = byDate.get(snapshot.snapshotDate) ?? {
        date: snapshot.snapshotDate,
        totalCostAmount: 0,
        marketValueAmount: 0,
        unrealizedPnlAmount: 0,
        cumulativeRealizedPnlAmount: 0,
        cumulativeDividendsAmount: 0,
        totalReturnAmount: 0,
        totalReturnPercent: null,
        fxAvailable: true,
      };
      const fx = snapshot.currency === query.reportingCurrency
        ? 1
        : await app.persistence.getFxRate(snapshot.currency as AccountDefaultCurrency, query.reportingCurrency, snapshot.snapshotDate);
      if (fx === null) {
        current.fxAvailable = false;
        current.totalCostAmount = null;
        current.marketValueAmount = null;
        current.unrealizedPnlAmount = null;
        current.cumulativeRealizedPnlAmount = null;
        current.cumulativeDividendsAmount = null;
        current.totalReturnAmount = null;
        current.totalReturnPercent = null;
        byDate.set(snapshot.snapshotDate, current);
        continue;
      }
      if (current.totalCostAmount !== null) current.totalCostAmount += snapshot.costBasisNative * fx;
      if (current.marketValueAmount !== null) current.marketValueAmount += (snapshot.valueNative ?? 0) * fx;
      if (current.unrealizedPnlAmount !== null) {
        current.unrealizedPnlAmount = snapshot.unrealizedPnlNative === null
          ? null
          : current.unrealizedPnlAmount + (snapshot.unrealizedPnlNative * fx);
      }
      if (current.cumulativeRealizedPnlAmount !== null) current.cumulativeRealizedPnlAmount += snapshot.cumulativeRealizedPnl * fx;
      if (current.cumulativeDividendsAmount !== null) current.cumulativeDividendsAmount += snapshot.cumulativeDividends * fx;
      byDate.set(snapshot.snapshotDate, current);
    }
  }

  const points = [...byDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((point) => {
      const totalReturnAmount =
        point.marketValueAmount === null
          || point.totalCostAmount === null
          || point.cumulativeRealizedPnlAmount === null
          || point.cumulativeDividendsAmount === null
          ? null
          : roundToDecimal(
            point.marketValueAmount - point.totalCostAmount + point.cumulativeRealizedPnlAmount + point.cumulativeDividendsAmount,
            2,
          );
      const totalReturnPercent = totalReturnAmount !== null && point.totalCostAmount && point.totalCostAmount > 0
        ? roundToDecimal((totalReturnAmount / point.totalCostAmount) * 100, 4)
        : null;
      return {
        ...point,
        totalCostAmount: point.totalCostAmount === null ? null : roundToDecimal(point.totalCostAmount, 2),
        marketValueAmount: point.marketValueAmount === null ? null : roundToDecimal(point.marketValueAmount, 2),
        unrealizedPnlAmount: point.unrealizedPnlAmount === null ? null : roundToDecimal(point.unrealizedPnlAmount, 2),
        cumulativeRealizedPnlAmount: point.cumulativeRealizedPnlAmount === null ? null : roundToDecimal(point.cumulativeRealizedPnlAmount, 2),
        cumulativeDividendsAmount: point.cumulativeDividendsAmount === null ? null : roundToDecimal(point.cumulativeDividendsAmount, 2),
        totalReturnAmount,
        totalReturnPercent,
      };
    });
  const fxStatus = points.length === 0
    ? "complete"
    : points.every((point) => point.fxAvailable)
      ? "complete"
      : points.every((point) => !point.fxAvailable)
        ? "missing"
        : "partial";

  return {
    range,
    points,
    reportingCurrency: query.reportingCurrency,
    fxStatus,
  };
}

function buildMarketAllocations(groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>): AllocationBucketDto[] {
  const byMarket = new Map<string, AllocationBucketDto>();
  for (const group of groups) {
    const current = byMarket.get(group.marketCode) ?? {
      key: group.marketCode,
      label: group.marketCode,
      reportingCurrency: group.reportingCurrency,
      amount: 0,
      allocationPercent: 0,
    };
    current.amount = (current.amount ?? 0) + (group.reportingMarketValueAmount ?? group.reportingCostBasisAmount ?? 0);
    current.allocationPercent = (current.allocationPercent ?? 0) + (group.reportingAllocationPercent ?? 0);
    byMarket.set(group.marketCode, current);
  }
  return [...byMarket.values()].sort((left, right) => (right.amount ?? 0) - (left.amount ?? 0));
}

function buildAccountAllocations(
  store: Store,
  groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>,
  reportingCurrency: AccountDefaultCurrency,
): AllocationBucketDto[] {
  const byAccount = new Map<string, AllocationBucketDto>();
  for (const group of groups) {
    for (const child of group.children) {
      const current = byAccount.get(child.accountId) ?? {
        key: child.accountId,
        label: store.accounts.find((account) => account.id === child.accountId)?.name ?? child.accountId,
        reportingCurrency,
        amount: 0,
        allocationPercent: 0,
      };
      current.amount = (current.amount ?? 0) + (child.reportingMarketValueAmount ?? child.reportingCostBasisAmount ?? 0);
      current.allocationPercent = (current.allocationPercent ?? 0) + (child.reportingAllocationPercent ?? 0);
      byAccount.set(child.accountId, current);
    }
  }
  return [...byAccount.values()].sort((left, right) => (right.amount ?? 0) - (left.amount ?? 0));
}

function buildDailyReviewSuggestions(prepared: PreparedReportData, rows: ReportHoldingRowDto[]) {
  const suggestions = [];
  if (prepared.dataHealth.missingFxCount > 0) {
    suggestions.push({
      code: "fx_missing",
      severity: "warning" as const,
      title: "FX coverage is incomplete",
      detail: `${prepared.dataHealth.missingFxCount} holding group(s) could not be translated into ${prepared.reportQuery.reportingCurrency}.`,
    });
  }
  if (prepared.dataHealth.missingQuoteCount > 0 || prepared.dataHealth.provisionalQuoteCount > 0) {
    suggestions.push({
      code: "quote_quality",
      severity: "warning" as const,
      title: "Quote coverage is mixed",
      detail: `${prepared.dataHealth.missingQuoteCount} group(s) are missing quotes and ${prepared.dataHealth.provisionalQuoteCount} use provisional quotes.`,
    });
  }
  const topHolding = [...rows].sort((left, right) => (right.reportingAllocationPercent ?? 0) - (left.reportingAllocationPercent ?? 0))[0];
  if (topHolding && (topHolding.reportingAllocationPercent ?? 0) >= 35) {
    suggestions.push({
      code: "concentration",
      severity: "info" as const,
      title: "Portfolio concentration is elevated",
      detail: `${topHolding.ticker} represents ${roundToDecimal(topHolding.reportingAllocationPercent ?? 0, 2)}% of scoped holdings value.`,
    });
  }
  const deepestLoss = [...rows]
    .filter((row) => row.reportingUnrealizedPnlAmount !== null)
    .sort((left, right) => (left.reportingUnrealizedPnlAmount ?? 0) - (right.reportingUnrealizedPnlAmount ?? 0))[0];
  if (deepestLoss && (deepestLoss.reportingUnrealizedPnlAmount ?? 0) < 0) {
    suggestions.push({
      code: "largest_unrealized_loss",
      severity: "info" as const,
      title: "Largest unrealized drawdown",
      detail: `${deepestLoss.ticker} is the deepest unrealized detractor at ${deepestLoss.reportingCurrency} ${Math.abs(deepestLoss.reportingUnrealizedPnlAmount ?? 0).toFixed(2)}.`,
    });
  }
  return suggestions.slice(0, 5);
}

function pageRows(rows: ReportHoldingRowDto[], limit?: number, offset?: number) {
  const safeLimit = Math.min(Math.max(limit ?? 25, 1), 100);
  const safeOffset = Math.max(offset ?? 0, 0);
  return {
    total: rows.length,
    limit: safeLimit,
    offset: safeOffset,
    rows: rows.slice(safeOffset, safeOffset + safeLimit),
  };
}
