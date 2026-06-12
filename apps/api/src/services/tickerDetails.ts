import { resolveRangeBounds, roundToDecimal, type DailyBar } from "@vakwen/domain";
import {
  MARKET_CODES,
  currencyFor,
  marketCodeFor,
  type DashboardOverviewHoldingChildDto,
  type DashboardOverviewHoldingGroupDto,
  type DashboardOverviewRecentDividendDto,
  type DashboardOverviewUpcomingDividendDto,
  type MarketCode,
  type TickerDetailsDto,
  type TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import type { PersistedTickerFundamentalsRecord, Persistence } from "../persistence/types.js";
import { routeError } from "../lib/routeError.js";
import { listDividendDeductionEntries, listDividendLedgerEntries, listTradeEvents } from "./accountingStore.js";
import { deriveEligibleQuantity } from "./dividends.js";
import { createEmptyTickerFundamentals } from "./fundamentals/types.js";
import { historyStartFor } from "./market-data/types.js";
import { resolveAccountDisplayName } from "./mcpAccountHelpers.js";
import { listHoldings } from "./portfolio.js";
import type { DividendEvent, Store, Transaction } from "../types/store.js";

type TickerChartRange = "1M" | "3M" | "YTD" | "1Y" | "3Y" | "5Y" | "ALL";
type TickerChartSelection = TickerChartRange | "CUSTOM";

interface BuildTickerDetailsInput {
  persistence: Pick<Persistence, "getDailyBarsForTickerMarket" | "getLatestBarDatesByTickerMarket" | "getLatestBarsByTickerMarket" | "getInstrument">;
  store: Store;
  userId: string;
  ticker: string;
  accountId?: string;
  marketCode?: MarketCode;
  range?: TickerChartRange;
  startDate?: string;
  endDate?: string;
  loadChart?: boolean;
  getSettledTradingDay?: (marketCode: MarketCode) => Promise<string | null>;
  fundamentalsRecord: PersistedTickerFundamentalsRecord | null;
  now?: Date;
}

export async function buildTickerDetails(
  input: BuildTickerDetailsInput,
): Promise<{ details: TickerDetailsDto; marketCode: MarketCode }> {
  const normalizedTicker = input.ticker.trim().toUpperCase();
  const accountById = new Map(input.store.accounts.map((account) => [account.id, account]));

  if (input.accountId && !accountById.has(input.accountId)) {
    throw routeError(404, "account_not_found", "Account not found");
  }

  const matchingTrades = listTradeEvents(input.store)
    .filter((trade) => trade.ticker === normalizedTicker)
    .filter((trade) => (input.accountId ? trade.accountId === input.accountId : true));

  const matchingHoldings = listHoldings(input.store, input.userId)
    .filter((holding) => holding.ticker === normalizedTicker)
    .filter((holding) => (input.accountId ? holding.accountId === input.accountId : true));

  const resolvedMarketCode = await resolveMarketCode({
    requestedMarketCode: input.marketCode,
    requestedAccountId: input.accountId,
    matchingTrades,
    matchingHoldings,
    accountById,
    getInstrument: (ticker, marketCode) => input.persistence.getInstrument(ticker, marketCode),
    ticker: normalizedTicker,
  });

  const instrument = await input.persistence.getInstrument(normalizedTicker, resolvedMarketCode);
  if (!instrument && matchingTrades.length === 0 && matchingHoldings.length === 0) {
    throw routeError(404, "ticker_not_found", "Ticker not found");
  }

  if (input.accountId) {
    const account = accountById.get(input.accountId)!;
    if (marketCodeFor(account.defaultCurrency) !== resolvedMarketCode) {
      throw routeError(400, "account_market_mismatch", "Account does not match the requested market");
    }
  }

  const scopedAccountIds = new Set(
    input.accountId
      ? [input.accountId]
      : input.store.accounts
        .filter((account) => marketCodeFor(account.defaultCurrency) === resolvedMarketCode)
        .map((account) => account.id),
  );

  const filteredTransactions = matchingTrades
    .filter((trade) => trade.marketCode === resolvedMarketCode)
    .sort(compareTransactionsForHistory);
  const filteredHoldings = matchingHoldings.filter((holding) => scopedAccountIds.has(holding.accountId));

  const loadChart = input.loadChart ?? true;
  const { allLocalBars, latestBarDate, quoteBars } = loadChart
    ? await loadTickerChartBars(input.persistence, normalizedTicker, resolvedMarketCode)
    : await loadTickerQuoteBars(input.persistence, normalizedTicker, resolvedMarketCode);
  const settledTradingDay = input.getSettledTradingDay
    ? await input.getSettledTradingDay(resolvedMarketCode)
    : null;
  const quote = buildQuoteFromBars(quoteBars, settledTradingDay);
  const chart = buildChart({
    allLocalBars,
    latestBarDate,
    range: input.range,
    startDate: input.startDate,
    endDate: input.endDate,
  });

  const quantity = filteredHoldings.reduce((sum, holding) => sum + holding.quantity, 0);
  const costBasisAmount = filteredHoldings.reduce((sum, holding) => sum + holding.costBasisAmount, 0);
  const averageCostPerShare = quantity > 0 ? roundToDecimal(costBasisAmount / quantity, 4) : null;
  const marketValueAmount = quote.currentUnitPrice !== null ? roundToDecimal(quantity * quote.currentUnitPrice, 2) : null;
  const unrealizedPnlAmount = marketValueAmount !== null ? roundToDecimal(marketValueAmount - costBasisAmount, 2) : null;
  const realizedPnlAmount = filteredTransactions.reduce((sum, trade) => sum + (trade.realizedPnlAmount ?? 0), 0);
  const currency = filteredHoldings[0]?.currency ?? filteredTransactions[0]?.priceCurrency ?? currencyFor(resolvedMarketCode);
  const upcomingDividends = buildUpcomingDividends(input.store, normalizedTicker, resolvedMarketCode, scopedAccountIds);
  const recentDividends = buildRecentDividends(input.store, normalizedTicker, resolvedMarketCode, scopedAccountIds);
  const accountBreakdown = buildAccountBreakdown({
    holdings: filteredHoldings,
    accountById,
    instrumentName: instrument?.name ?? null,
    marketCode: resolvedMarketCode,
    quote,
    upcomingDividends,
    recentDividends,
  });
  const holdingGroup = buildHoldingGroup({
    ticker: normalizedTicker,
    instrumentName: instrument?.name ?? null,
    marketCode: resolvedMarketCode,
    currency,
    quote,
    accountBreakdown,
  });

  const details: TickerDetailsDto = {
    identity: {
      ticker: normalizedTicker,
      marketCode: resolvedMarketCode,
      accountId: input.accountId ?? null,
      name: instrument?.name ?? null,
      instrumentType: instrument?.instrumentType ?? null,
      priceCurrency: currency,
      barsBackfillStatus: instrument?.barsBackfillStatus ?? null,
    },
    quote,
    position: {
      quantity,
      averageCostPerShare,
      costBasisAmount,
      marketValueAmount,
      unrealizedPnlAmount,
      realizedPnlAmount,
      currency,
      accountIds: [...scopedAccountIds].sort(),
      lastTradeDate: filteredTransactions[0]?.tradeDate ?? null,
    },
    chart: {
      range: chart.range,
      metadata: chart.metadata,
      points: chart.points,
    },
    transactions: filteredTransactions.map((trade) => mapTransactionHistoryItem(trade, accountById)),
    dividends: {
      upcoming: upcomingDividends,
      recent: recentDividends,
    },
    holdingGroup,
    accountBreakdown,
    fundamentals: input.fundamentalsRecord?.fundamentals ?? createEmptyTickerFundamentals(),
    fundamentalsRefresh: buildFundamentalsRefresh(input.fundamentalsRecord, input.now ?? new Date()),
  };

  return {
    details,
    marketCode: resolvedMarketCode,
  };
}

function buildAccountBreakdown(input: {
  holdings: ReturnType<typeof listHoldings>;
  accountById: ReadonlyMap<string, Store["accounts"][number]>;
  instrumentName: string | null;
  marketCode: MarketCode;
  quote: TickerDetailsDto["quote"];
  upcomingDividends: DashboardOverviewUpcomingDividendDto[];
  recentDividends: DashboardOverviewRecentDividendDto[];
}): DashboardOverviewHoldingChildDto[] {
  const reportingCurrency = currencyFor(input.marketCode);
  const allocationBasisUsed = input.quote.currentUnitPrice === null ? "cost_basis" : "market_value";
  const rows = input.holdings.map((holding) => {
    const marketValueAmount = input.quote.currentUnitPrice !== null
      ? roundToDecimal(holding.quantity * input.quote.currentUnitPrice, 2)
      : null;
    return {
      accountId: holding.accountId,
      accountName: input.accountById.get(holding.accountId)?.name ?? holding.accountId,
      ticker: holding.ticker,
      instrumentName: input.instrumentName,
      marketCode: input.marketCode,
      quantity: holding.quantity,
      costBasisAmount: holding.costBasisAmount,
      currency: holding.currency,
      averageCostPerShare: holding.quantity > 0 ? roundToDecimal(holding.costBasisAmount / holding.quantity, 2) : 0,
      currentUnitPrice: input.quote.currentUnitPrice,
      marketValueAmount,
      unrealizedPnlAmount: marketValueAmount === null ? null : roundToDecimal(marketValueAmount - holding.costBasisAmount, 2),
      allocationPct: null,
      change: input.quote.change,
      changePercent: input.quote.changePercent,
      previousClose: input.quote.previousClose,
      quoteStatus: input.quote.quoteStatus,
      nextDividendDate: minNullableDate(
        input.upcomingDividends
          .filter((dividend) => dividend.accountId === holding.accountId)
          .map((dividend) => dividend.paymentDate ?? dividend.exDividendDate),
      ),
      lastDividendPostedDate: maxNullableDate(
        input.recentDividends
          .filter((dividend) => dividend.accountId === holding.accountId)
          .map((dividend) => dividend.postedAt),
      ),
      freshness: "current" as const,
      freshnessTooltip: null,
      reportingCurrency,
      reportingCostBasisAmount: holding.costBasisAmount,
      reportingMarketValueAmount: marketValueAmount,
      reportingUnrealizedPnlAmount: marketValueAmount === null ? null : roundToDecimal(marketValueAmount - holding.costBasisAmount, 2),
      reportingDailyChangeAmount: input.quote.change === null || input.quote.previousClose === null
        ? null
        : roundToDecimal(input.quote.change * holding.quantity, 2),
      reportingAllocationPercent: null,
      fxStatus: "complete" as const,
      allocationBasisUsed,
      allocationBasisFallbackReason: input.quote.currentUnitPrice === null ? "missing_quote" as const : null,
    } satisfies DashboardOverviewHoldingChildDto;
  });

  const allocationTotal = rows.reduce((sum, row) => {
    const value = allocationBasisUsed === "market_value"
      ? row.reportingMarketValueAmount
      : row.reportingCostBasisAmount;
    return sum + (value ?? 0);
  }, 0);

  return rows
    .map((row) => {
      const value = allocationBasisUsed === "market_value"
        ? row.reportingMarketValueAmount
        : row.reportingCostBasisAmount;
      return {
        ...row,
        allocationPct: allocationTotal > 0 && value !== null ? (value / allocationTotal) * 100 : null,
        reportingAllocationPercent: allocationTotal > 0 && value !== null
          ? roundToDecimal((value / allocationTotal) * 100, 4)
          : null,
      };
    })
    .sort((left, right) => right.costBasisAmount - left.costBasisAmount || left.accountId.localeCompare(right.accountId));
}

function buildHoldingGroup(input: {
  ticker: string;
  instrumentName: string | null;
  marketCode: MarketCode;
  currency: string;
  quote: TickerDetailsDto["quote"];
  accountBreakdown: DashboardOverviewHoldingChildDto[];
}): DashboardOverviewHoldingGroupDto | null {
  if (input.accountBreakdown.length === 0) return null;

  const quantity = input.accountBreakdown.reduce((sum, child) => sum + child.quantity, 0);
  const costBasisAmount = roundToDecimal(
    input.accountBreakdown.reduce((sum, child) => sum + child.costBasisAmount, 0),
    2,
  );
  const marketValueAmount = input.quote.currentUnitPrice !== null
    ? roundToDecimal(quantity * input.quote.currentUnitPrice, 2)
    : null;
  const unrealizedPnlAmount = marketValueAmount === null
    ? null
    : roundToDecimal(marketValueAmount - costBasisAmount, 2);
  const reportingCurrency = currencyFor(input.marketCode);
  const allocationBasisUsed = input.quote.currentUnitPrice === null ? "cost_basis" : "market_value";

  return {
    ticker: input.ticker,
    instrumentName: input.instrumentName,
    marketCode: input.marketCode,
    quantity,
    costBasisAmount,
    currency: input.currency,
    averageCostPerShare: quantity > 0 ? roundToDecimal(costBasisAmount / quantity, 2) : 0,
    currentUnitPrice: input.quote.currentUnitPrice,
    marketValueAmount,
    unrealizedPnlAmount,
    allocationPct: null,
    change: input.quote.change,
    changePercent: input.quote.changePercent,
    previousClose: input.quote.previousClose,
    quoteStatus: input.quote.quoteStatus,
    nextDividendDate: minNullableDate(input.accountBreakdown.map((child) => child.nextDividendDate)),
    lastDividendPostedDate: maxNullableDate(input.accountBreakdown.map((child) => child.lastDividendPostedDate)),
    freshness: "current",
    freshnessTooltip: null,
    accountCount: new Set(input.accountBreakdown.map((child) => child.accountId)).size,
    reportingCurrency,
    reportingCostBasisAmount: costBasisAmount,
    reportingMarketValueAmount: marketValueAmount,
    reportingUnrealizedPnlAmount: unrealizedPnlAmount,
    reportingDailyChangeAmount: input.accountBreakdown.some((child) => child.reportingDailyChangeAmount == null)
      ? null
      : roundToDecimal(input.accountBreakdown.reduce((sum, child) => sum + (child.reportingDailyChangeAmount ?? 0), 0), 2),
    reportingAllocationPercent: null,
    fxStatus: "complete",
    allocationBasisUsed,
    allocationBasisFallbackReason: input.quote.currentUnitPrice === null ? "missing_quote" : null,
    children: input.accountBreakdown,
  };
}

function minNullableDate(values: Array<string | null>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort()[0] ?? null;
}

function maxNullableDate(values: Array<string | null>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

async function resolveMarketCode(input: {
  requestedMarketCode?: MarketCode;
  requestedAccountId?: string;
  matchingTrades: Store["accounting"]["facts"]["tradeEvents"];
  matchingHoldings: ReturnType<typeof listHoldings>;
  accountById: ReadonlyMap<string, Store["accounts"][number]>;
  getInstrument: Persistence["getInstrument"];
  ticker: string;
}): Promise<MarketCode> {
  if (input.requestedMarketCode) {
    return input.requestedMarketCode;
  }

  if (input.requestedAccountId) {
    const account = input.accountById.get(input.requestedAccountId);
    if (account) {
      return marketCodeFor(account.defaultCurrency);
    }
  }

  const tradeMarkets = [...new Set(input.matchingTrades.map((trade) => trade.marketCode))];
  const holdingMarkets = [...new Set(
    input.matchingHoldings
      .map((holding) => input.accountById.get(holding.accountId)?.defaultCurrency)
      .filter((currency): currency is NonNullable<typeof currency> => Boolean(currency))
      .map((currency) => marketCodeFor(currency)),
  )];

  const candidateMarkets = [...new Set([...tradeMarkets, ...holdingMarkets])];
  if (candidateMarkets.length === 1) {
    return candidateMarkets[0] as MarketCode;
  }
  if (candidateMarkets.length === 0) {
    const catalogMarkets = (
      await Promise.all(MARKET_CODES.map(async (marketCode) => {
        const instrument = await input.getInstrument(input.ticker, marketCode);
        return instrument ? marketCode : null;
      }))
    ).filter((marketCode): marketCode is MarketCode => marketCode !== null);

    if (catalogMarkets.length === 1) {
      return catalogMarkets[0];
    }
    if (catalogMarkets.length === 0) {
      return "TW";
    }
  }

  throw routeError(
    400,
    "ticker_market_required",
    "marketCode is required when the ticker exists in multiple markets",
  );
}

async function loadTickerChartBars(
  persistence: BuildTickerDetailsInput["persistence"],
  ticker: string,
  marketCode: MarketCode,
): Promise<{ allLocalBars: DailyBar[]; latestBarDate: string | null; quoteBars: DailyBar[] }> {
  const latestBarDates = await persistence.getLatestBarDatesByTickerMarket([{ ticker, marketCode }]);
  const latestBarDate = latestBarDates.get(`${ticker}:${marketCode}`) ?? null;
  const allLocalBars = latestBarDate
    ? await persistence.getDailyBarsForTickerMarket(ticker, marketCode, historyStartFor(marketCode), latestBarDate)
    : [];
  return {
    allLocalBars,
    latestBarDate,
    quoteBars: allLocalBars.slice(-2),
  };
}

async function loadTickerQuoteBars(
  persistence: BuildTickerDetailsInput["persistence"],
  ticker: string,
  marketCode: MarketCode,
): Promise<{ allLocalBars: DailyBar[]; latestBarDate: string | null; quoteBars: DailyBar[] }> {
  const latestBars = await persistence.getLatestBarsByTickerMarket([{ ticker, marketCode }], 2);
  const quoteBars = latestBars
    .map((bar) => ({
      ticker: bar.ticker,
      barDate: bar.barDate,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      source: bar.source,
      ingestedAt: bar.ingestedAt,
    }))
    .sort((left, right) => left.barDate.localeCompare(right.barDate));
  return {
    allLocalBars: [],
    latestBarDate: quoteBars.at(-1)?.barDate ?? null,
    quoteBars,
  };
}

function buildQuoteFromBars(
  chartBars: readonly DailyBar[],
  settledTradingDay: string | null,
): TickerDetailsDto["quote"] {
  const latest = chartBars.at(-1);
  if (!latest) {
    return {
      currentUnitPrice: null,
      previousClose: null,
      change: null,
      changePercent: null,
      asOf: null,
      source: null,
      quoteStatus: "missing",
    };
  }

  const previous = chartBars.length >= 2 ? chartBars[chartBars.length - 2] : null;
  const previousClose = previous?.close ?? null;
  const change = previousClose === null ? null : roundToDecimal(latest.close - previousClose, 4);
  const changePercent = previousClose === null || previousClose === 0
    ? null
    : roundToDecimal(((latest.close - previousClose) / previousClose) * 100, 4);
  const quoteStatus = settledTradingDay && latest.barDate < settledTradingDay ? "provisional" : "current";

  return {
    currentUnitPrice: latest.close,
    previousClose,
    change,
    changePercent,
    asOf: latest.barDate,
    source: latest.source,
    quoteStatus,
  };
}

function buildChart(input: {
  allLocalBars: readonly DailyBar[];
  latestBarDate: string | null;
  range?: TickerChartRange;
  startDate?: string;
  endDate?: string;
}): TickerDetailsDto["chart"] {
  const requestedRange = input.startDate || input.endDate ? null : (input.range ?? "1Y");
  const resolvedRange: TickerChartSelection = input.startDate || input.endDate ? "CUSTOM" : (requestedRange ?? "1Y");
  const availableStartDate = input.allLocalBars[0]?.barDate ?? null;
  const availableEndDate = input.allLocalBars.at(-1)?.barDate ?? null;

  if (input.startDate && input.endDate) {
    assertCustomRangeWithinTenYears(input.startDate, input.endDate);
  }

  const resolvedBounds = resolveChartBounds({
    latestBarDate: input.latestBarDate,
    availableStartDate,
    availableEndDate,
    range: requestedRange,
    startDate: input.startDate,
    endDate: input.endDate,
  });

  return {
    range: resolvedRange,
    metadata: {
      requested: {
        range: requestedRange,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
      },
      resolved: {
        range: resolvedRange,
        startDate: resolvedBounds.startDate,
        endDate: resolvedBounds.endDate,
      },
      available: {
        startDate: availableStartDate,
        endDate: availableEndDate,
      },
      truncated: {
        startDate: Boolean(
          resolvedBounds.startDate
          && availableStartDate
          && resolvedBounds.startDate < availableStartDate,
        ),
        endDate: Boolean(
          resolvedBounds.endDate
          && availableEndDate
          && resolvedBounds.endDate > availableEndDate,
        ),
      },
    },
    points: input.allLocalBars
      .filter((bar) => (
        resolvedBounds.startDate !== null
        && resolvedBounds.endDate !== null
        && bar.barDate >= resolvedBounds.startDate
        && bar.barDate <= resolvedBounds.endDate
      ))
      .map((bar) => ({
        date: bar.barDate,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        source: bar.source,
      })),
  };
}

function resolveChartBounds(input: {
  latestBarDate: string | null;
  availableStartDate: string | null;
  availableEndDate: string | null;
  range: TickerChartRange | null;
  startDate?: string;
  endDate?: string;
}): { startDate: string | null; endDate: string | null } {
  if (input.startDate && input.endDate) {
    return {
      startDate: input.startDate,
      endDate: input.endDate,
    };
  }

  if (!input.latestBarDate) {
    return {
      startDate: null,
      endDate: null,
    };
  }

  if (input.range === "ALL") {
    return {
      startDate: input.availableStartDate ?? input.latestBarDate,
      endDate: input.availableEndDate ?? input.latestBarDate,
    };
  }

  const { startDate, endDate } = resolveRangeBounds(
    input.range ?? "1Y",
    input.latestBarDate,
    input.availableStartDate ?? undefined,
  );
  return { startDate, endDate };
}

function assertCustomRangeWithinTenYears(startDate: string, endDate: string): void {
  if (startDate > endDate) {
    throw routeError(400, "ticker_chart_invalid_date_range", "startDate must be before or equal to endDate");
  }

  if (endDate > addYears(startDate, 10)) {
    throw routeError(
      400,
      "ticker_chart_custom_range_too_large",
      "Custom ticker chart ranges cannot exceed 10 years",
    );
  }
}

function buildUpcomingDividends(
  store: Store,
  ticker: string,
  marketCode: MarketCode,
  scopedAccountIds: ReadonlySet<string>,
): DashboardOverviewUpcomingDividendDto[] {
  const activeLedgerByAccountAndEvent = new Map<string, { postingStatus: string }>();
  const postedEventKeys = new Set<string>();

  for (const entry of listDividendLedgerEntries(store)) {
    const key = `${entry.accountId}:${entry.dividendEventId}`;
    if (!entry.reversalOfDividendLedgerEntryId && !entry.supersededAt) {
      activeLedgerByAccountAndEvent.set(key, { postingStatus: entry.postingStatus });
    }
    if (entry.postingStatus === "posted") {
      postedEventKeys.add(key);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + 365);
  const horizonDate = horizon.toISOString().slice(0, 10);

  return store.accounts
    .filter((account) => scopedAccountIds.has(account.id))
    .flatMap((account) =>
      store.marketData.dividendEvents.flatMap((event): DashboardOverviewUpcomingDividendDto[] => {
        if (event.ticker !== ticker) return [];
        if (resolveDividendEventMarketCode(event) !== marketCode) return [];
        const ledgerKey = `${account.id}:${event.id}`;
        if (postedEventKeys.has(ledgerKey)) return [];
        if (event.paymentDate !== null) {
          if (event.paymentDate < today) return [];
          if (event.paymentDate > horizonDate) return [];
        }

        const eligibleQuantity = deriveEligibleQuantity(store, account.id, event.ticker, event.exDividendDate, marketCode);
        if (eligibleQuantity <= 0) return [];

        return [{
          accountId: account.id,
          accountName: account.name,
          ticker: event.ticker,
          exDividendDate: event.exDividendDate,
          paymentDate: event.paymentDate,
          expectedAmount: event.cashDividendPerShare > 0
            ? eligibleQuantity * event.cashDividendPerShare
            : null,
          currency: event.cashDividendCurrency,
          status: resolveUpcomingStatus(event.paymentDate, activeLedgerByAccountAndEvent.get(ledgerKey)?.postingStatus),
        }];
      }),
    )
    .sort((left, right) => (
      (left.paymentDate ?? left.exDividendDate ?? "").localeCompare(right.paymentDate ?? right.exDividendDate ?? "")
      || left.accountId.localeCompare(right.accountId)
    ));
}

function buildRecentDividends(
  store: Store,
  ticker: string,
  marketCode: MarketCode,
  scopedAccountIds: ReadonlySet<string>,
): DashboardOverviewRecentDividendDto[] {
  const eventById = new Map(
    store.marketData.dividendEvents
      .filter((event) => event.ticker === ticker)
      .filter((event) => resolveDividendEventMarketCode(event) === marketCode)
      .map((event) => [event.id, event]),
  );
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
  const deductionsByLedgerId = new Map<string, number>();

  for (const deduction of listDividendDeductionEntries(store)) {
    deductionsByLedgerId.set(
      deduction.dividendLedgerEntryId,
      (deductionsByLedgerId.get(deduction.dividendLedgerEntryId) ?? 0) + deduction.amount,
    );
  }

  return listDividendLedgerEntries(store)
    .filter((entry) => entry.postingStatus === "posted" && !entry.reversalOfDividendLedgerEntryId)
    .filter((entry) => scopedAccountIds.has(entry.accountId))
    .flatMap((entry): DashboardOverviewRecentDividendDto[] => {
      const event = eventById.get(entry.dividendEventId);
      if (!event) return [];
      const deductionAmount = deductionsByLedgerId.get(entry.id) ?? 0;
      return [{
        accountId: entry.accountId,
        accountName: accountById.get(entry.accountId)?.name ?? entry.accountId,
        ticker: event.ticker,
        postedAt: entry.bookedAt ?? event.paymentDate ?? new Date().toISOString(),
        netAmount: entry.receivedCashAmount,
        grossAmount: entry.receivedCashAmount + deductionAmount,
        deductionAmount: deductionAmount || null,
        currency: event.cashDividendCurrency,
        sourceSummary: resolveSourceSummary(event.eventType),
        status: entry.reconciliationStatus === "matched" ? "posted" : "unreconciled",
      }];
    })
    .sort((left, right) => right.postedAt.localeCompare(left.postedAt));
}

function resolveDividendEventMarketCode(event: Pick<DividendEvent, "marketCode" | "cashDividendCurrency">): MarketCode {
  return (event.marketCode ?? marketCodeFor(event.cashDividendCurrency)) as MarketCode;
}

function buildFundamentalsRefresh(
  record: PersistedTickerFundamentalsRecord | null,
  now: Date,
): TickerDetailsDto["fundamentalsRefresh"] {
  if (!record) {
    return {
      providerId: null,
      refreshedAt: null,
      nextRefreshAt: null,
      lastAttemptedAt: null,
      lastError: null,
      status: "missing",
    };
  }

  const status = !record.refreshedAt
    ? "missing"
    : record.nextRefreshAt && record.nextRefreshAt <= now.toISOString()
      ? "stale"
      : "fresh";

  return {
    providerId: record.providerId,
    refreshedAt: record.refreshedAt,
    nextRefreshAt: record.nextRefreshAt,
    lastAttemptedAt: record.lastAttemptedAt,
    lastError: record.lastError,
    status,
  };
}

function mapTransactionHistoryItem(
  trade: Transaction,
  accountById: ReadonlyMap<string, { id: string; name: string }>,
): TransactionHistoryItemDto {
  return {
    id: trade.id,
    accountId: trade.accountId,
    accountName: resolveAccountDisplayName(accountById, trade.accountId),
    ticker: trade.ticker,
    marketCode: trade.marketCode,
    instrumentType: trade.instrumentType,
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
    realizedPnlAmount: trade.realizedPnlAmount ?? null,
    realizedPnlCurrency: trade.realizedPnlCurrency ?? null,
    feeProfileId: trade.feeSnapshot.id,
    feeProfileName: trade.feeSnapshot.name,
    bookedAt: trade.bookedAt ?? null,
    feesSource: trade.feesSource ?? "CALCULATED",
  };
}

function compareTransactionsForHistory(left: Transaction, right: Transaction): number {
  return (
    right.tradeDate.localeCompare(left.tradeDate)
    || (right.bookingSequence ?? 0) - (left.bookingSequence ?? 0)
    || (right.tradeTimestamp ?? "").localeCompare(left.tradeTimestamp ?? "")
    || (right.bookedAt ?? "").localeCompare(left.bookedAt ?? "")
    || right.id.localeCompare(left.id)
  );
}

function resolveSourceSummary(eventType: string | undefined): string | null {
  if (eventType === "STOCK") return "Stock dividend";
  if (eventType === "CASH_AND_STOCK") return "Cash and stock dividend";
  if (eventType === "CASH") return "Cash dividend";
  return null;
}

function resolveUpcomingStatus(
  paymentDate: string | null,
  postingStatus: string | undefined,
): DashboardOverviewUpcomingDividendDto["status"] {
  if (postingStatus === "expected") return "expected";
  if (!paymentDate) return "declared";

  const now = new Date();
  const payment = new Date(`${paymentDate}T00:00:00.000Z`);
  const diffMs = payment.getTime() - now.getTime();
  return diffMs <= 7 * 24 * 60 * 60 * 1000 ? "paying-soon" : "declared";
}

function addYears(date: string, years: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next.toISOString().slice(0, 10);
}
