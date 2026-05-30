import type { CurrencyCode, MarketCode, QuoteSnapshot } from "@vakwen/domain";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  MARKET_CODES,
  type AccountDefaultCurrency,
  type DashboardPerformanceRange,
} from "@vakwen/shared-types";
import { resolveReportingCurrency, resolveEffectiveRanges } from "./userPreferences.js";
import { buildDashboardOverview } from "./dashboard.js";
import { translateOverviewSummary, translatePerformancePoints } from "./dashboardReportingCurrency.js";
import { enrichHoldingsWithFreshness } from "./dashboardFreshness.js";
import { resolveQuoteSnapshots, type QuoteSnapshotPair } from "./market-data/quoteSnapshotService.js";
import { isInstrumentQuoteable } from "./instrumentRegistry.js";
import { routeError } from "../lib/routeError.js";
import type { McpReadServiceDeps } from "../mcp/types.js";
import type { Store } from "../types/store.js";

interface ReadOverrides {
  reportingCurrency?: CurrencyCode;
  locale?: string;
}

function compareTransactionsForHistory(
  left: Store["accounting"]["facts"]["tradeEvents"][number],
  right: Store["accounting"]["facts"]["tradeEvents"][number],
): number {
  return right.tradeDate.localeCompare(left.tradeDate)
    || (right.bookingSequence ?? 0) - (left.bookingSequence ?? 0)
    || right.id.localeCompare(left.id);
}

async function buildQuoteInputs(
  deps: McpReadServiceDeps,
  store: Store,
  tickers: ReadonlyArray<string>,
): Promise<{ pairs: QuoteSnapshotPair[]; settledByMarket: Map<MarketCode, string> }> {
  const tickerToMarket = new Map<string, MarketCode>();
  for (const instrument of store.instruments) {
    tickerToMarket.set(instrument.ticker, instrument.marketCode);
  }
  const pairs = tickers.map((ticker) => {
    const marketCode = tickerToMarket.get(ticker);
    return marketCode ? { ticker, marketCode } : { ticker };
  });
  const settledByMarket = new Map<MarketCode, string>();
  for (const pair of pairs) {
    if (!pair.marketCode || settledByMarket.has(pair.marketCode)) continue;
    settledByMarket.set(
      pair.marketCode,
      await deps.tradingCalendar.latestSettledTradingDay(pair.marketCode, new Date()),
    );
  }
  return { pairs, settledByMarket };
}

async function loadStoreAndPrefs(deps: McpReadServiceDeps) {
  const { portfolioContextUserId } = deps.requestContext.resolvedContext;
  const [store, prefs] = await Promise.all([
    deps.app.persistence.loadStore(portfolioContextUserId),
    deps.app.persistence.getUserPreferences(portfolioContextUserId),
  ]);
  return { store, prefs, portfolioContextUserId };
}

function resolveRequestedReportingCurrency(
  requested: CurrencyCode | undefined,
  fallback: AccountDefaultCurrency,
): AccountDefaultCurrency {
  if (!requested) return fallback;
  if ((ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(requested)) return requested as AccountDefaultCurrency;
  throw routeError(400, "mcp_invalid_reporting_currency", "reportingCurrency must be TWD, USD, AUD, or KRW");
}

function resolveOverrides(prefs: Record<string, unknown>, overrides: ReadOverrides): {
  reportingCurrency: AccountDefaultCurrency;
  locale: string;
} {
  const defaultCurrency = resolveReportingCurrency(prefs);
  return {
    reportingCurrency: resolveRequestedReportingCurrency(overrides.reportingCurrency, defaultCurrency),
    locale: overrides.locale ?? "default",
  };
}

export async function getPortfolioOverview(
  deps: McpReadServiceDeps,
  overrides: ReadOverrides,
) {
  const { store, prefs } = await loadStoreAndPrefs(deps);
  const holdings = store.accounting.projections.holdings
    .filter((holding) => isInstrumentQuoteable(store.instruments.find((instrument) => instrument.ticker === holding.ticker)));
  const symbols = [...new Set(holdings.map((holding) => holding.ticker))];
  const { pairs, settledByMarket } = await buildQuoteInputs(deps, store, symbols);
  const snapshotMap = await resolveQuoteSnapshots(pairs, deps.app.persistence, settledByMarket);
  const quotes = Object.values(snapshotMap).filter((quote): quote is QuoteSnapshot => quote !== null);
  const overview = buildDashboardOverview(store, { integrityIssue: null, quotes });
  await enrichHoldingsWithFreshness(overview.holdings, store, {
    persistence: deps.app.persistence,
    tradingCalendar: deps.tradingCalendar,
  });
  const { reportingCurrency, locale } = resolveOverrides(prefs, overrides);
  const summary = await translateOverviewSummary(
    overview.summary,
    overview.holdings,
    overview.dividends,
    reportingCurrency,
    overview.summary.asOf,
    deps.app.persistence,
  );
  return {
    locale,
    reportingCurrency,
    portfolioContextUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
    summary,
    holdings: overview.holdings,
    dividends: overview.dividends,
  };
}

export async function getHoldings(
  deps: McpReadServiceDeps,
  input: ReadOverrides & { tickers?: string[] },
) {
  const overview = await getPortfolioOverview(deps, input);
  const tickers = input.tickers ? new Set(input.tickers.map((ticker) => ticker.trim().toUpperCase())) : null;
  return {
    ...overview,
    holdings: tickers
      ? overview.holdings.filter((holding) => tickers.has(holding.ticker))
      : overview.holdings,
  };
}

export async function getPerformance(
  deps: McpReadServiceDeps,
  input: ReadOverrides & { range?: string },
) {
  const { store, prefs, portfolioContextUserId } = await loadStoreAndPrefs(deps);
  const { ranges } = await resolveEffectiveRanges(deps.app.persistence, portfolioContextUserId, prefs);
  const range = input.range ?? ranges[0];
  if (!ranges.includes(range)) {
    throw routeError(400, "mcp_invalid_range", `Unsupported performance range ${range}`);
  }
  const symbols = [...new Set(
    store.accounting.facts.tradeEvents
      .map((trade) => trade.ticker)
      .filter((ticker) => isInstrumentQuoteable(store.instruments.find((instrument) => instrument.ticker === ticker))),
  )];
  const { pairs, settledByMarket } = await buildQuoteInputs(deps, store, symbols);
  const snapshotMap = await resolveQuoteSnapshots(pairs, deps.app.persistence, settledByMarket);
  const quotes = Object.values(snapshotMap).filter((quote): quote is QuoteSnapshot => quote !== null);
  const reportingCurrency = resolveRequestedReportingCurrency(input.reportingCurrency, resolveReportingCurrency(prefs));
  const asOf = quotes[0]?.asOf ?? new Date().toISOString();
  const performance = await translatePerformancePoints(
    portfolioContextUserId,
    range as DashboardPerformanceRange,
    asOf,
    reportingCurrency,
    deps.app.persistence,
    store,
    quotes,
  );
  return {
    locale: input.locale ?? "default",
    reportingCurrency,
    portfolioContextUserId,
    performance,
  };
}

function defaultRecentWindow(): { fromDate: string; toDate: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 90);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  };
}

export async function getRecentTransactions(
  deps: McpReadServiceDeps,
  input: ReadOverrides & {
    fromDate?: string;
    toDate?: string;
    limit: number;
    offset: number;
    tickers?: string[];
    accountIds?: string[];
  },
) {
  const { store, portfolioContextUserId } = await loadStoreAndPrefs(deps);
  const defaults = defaultRecentWindow();
  const fromDate = input.fromDate ?? defaults.fromDate;
  const toDate = input.toDate ?? defaults.toDate;
  if (fromDate > toDate) {
    throw routeError(400, "mcp_invalid_date_range", "fromDate must be on or before toDate");
  }
  const windowDays = Math.floor((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
  if (windowDays > 366) {
    throw routeError(400, "mcp_invalid_date_range", "Recent transaction window cannot exceed one year");
  }
  const tickerFilter = input.tickers ? new Set(input.tickers.map((ticker) => ticker.trim().toUpperCase())) : null;
  const accountFilter = input.accountIds ? new Set(input.accountIds) : null;
  const all = store.accounting.facts.tradeEvents
    .filter((trade) => trade.tradeDate >= fromDate && trade.tradeDate <= toDate)
    .filter((trade) => !tickerFilter || tickerFilter.has(trade.ticker))
    .filter((trade) => !accountFilter || accountFilter.has(trade.accountId))
    .sort(compareTransactionsForHistory)
    .map((trade) => ({
      id: trade.id,
      accountId: trade.accountId,
      ticker: trade.ticker,
      marketCode: trade.marketCode,
      type: trade.type,
      quantity: trade.quantity,
      unitPrice: trade.unitPrice,
      priceCurrency: trade.priceCurrency,
      tradeDate: trade.tradeDate,
      tradeTimestamp: trade.tradeTimestamp ?? null,
      bookingSequence: trade.bookingSequence ?? null,
      commissionAmount: trade.commissionAmount,
      taxAmount: trade.taxAmount,
      isDayTrade: trade.isDayTrade,
      source: trade.source ?? null,
      sourceReference: trade.sourceReference ?? null,
    }));
  return {
    portfolioContextUserId,
    fromDate,
    toDate,
    total: all.length,
    offset: input.offset,
    limit: input.limit,
    items: all.slice(input.offset, input.offset + input.limit),
  };
}

export async function getDividendsOverview(
  deps: McpReadServiceDeps,
  overrides: ReadOverrides,
) {
  const overview = await getPortfolioOverview(deps, overrides);
  return {
    locale: overview.locale,
    reportingCurrency: overview.reportingCurrency,
    portfolioContextUserId: overview.portfolioContextUserId,
    upcoming: overview.dividends.upcoming,
    recent: overview.dividends.recent,
    summary: {
      upcomingCount: overview.dividends.upcoming.length,
      recentCount: overview.dividends.recent.length,
      upcomingAmount: overview.summary.upcomingDividendAmount,
    },
  };
}

export async function getQuoteFreshness(
  deps: McpReadServiceDeps,
  input: ReadOverrides & { tickers?: string[] },
) {
  const overview = await getHoldings(deps, input);
  return {
    locale: overview.locale,
    reportingCurrency: overview.reportingCurrency,
    portfolioContextUserId: overview.portfolioContextUserId,
    quotes: overview.holdings.map((holding) => ({
      accountId: holding.accountId,
      ticker: holding.ticker,
      freshness: holding.freshness,
      freshnessTooltip: holding.freshnessTooltip,
      quoteStatus: holding.quoteStatus,
      currentUnitPrice: holding.currentUnitPrice,
      previousClose: holding.previousClose,
    })),
  };
}

export async function getCashBalanceSummary(
  deps: McpReadServiceDeps,
  input: ReadOverrides & { accountIds?: string[] },
) {
  const { store, portfolioContextUserId } = await loadStoreAndPrefs(deps);
  const allowedAccounts = input.accountIds ? new Set(input.accountIds) : null;
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
  const grouped = new Map<string, { accountId: string; currency: string; balanceAmount: number }>();
  for (const entry of store.accounting.facts.cashLedgerEntries) {
    if (allowedAccounts && !allowedAccounts.has(entry.accountId)) continue;
    const key = `${entry.accountId}:${entry.currency}`;
    const current = grouped.get(key) ?? { accountId: entry.accountId, currency: entry.currency, balanceAmount: 0 };
    current.balanceAmount += entry.amount;
    grouped.set(key, current);
  }
  return {
    locale: input.locale ?? "default",
    portfolioContextUserId,
    balances: [...grouped.values()].map((item) => ({
      ...item,
      accountName: accountById.get(item.accountId)?.name ?? item.accountId,
    })),
  };
}

export async function searchInstruments(
  deps: McpReadServiceDeps,
  input: { query: string; markets?: MarketCode[]; limit: number },
) {
  const markets = input.markets && input.markets.length > 0 ? input.markets : [...MARKET_CODES];
  const rows = await Promise.all(
    markets.map((market) => deps.app.persistence.listInstrumentsCatalog(input.query, undefined, market, deps.requestContext.auth.sessionUserId)),
  );
  const merged = rows
    .flat()
    .slice(0, input.limit)
    .map((instrument) => ({
      ticker: instrument.ticker,
      marketCode: instrument.marketCode,
      name: instrument.name,
      instrumentType: instrument.instrumentType,
      barsBackfillStatus: instrument.barsBackfillStatus,
      lastRepairAt: instrument.lastRepairAt,
      gicsIndustryGroup: instrument.gicsIndustryGroup,
    }));
  return {
    query: input.query,
    markets,
    items: merged,
  };
}
