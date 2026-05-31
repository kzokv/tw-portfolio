import { roundToDecimal } from "@vakwen/domain";
import { currencyFor, marketCodeFor, type DashboardOverviewRecentDividendDto, type DashboardOverviewUpcomingDividendDto, type MarketCode, type TickerDetailsDto, type TransactionHistoryItemDto } from "@vakwen/shared-types";
import type { PersistedTickerFundamentalsRecord, Persistence } from "../persistence/types.js";
import { routeError } from "../lib/routeError.js";
import { listDividendDeductionEntries, listDividendLedgerEntries, listTradeEvents } from "./accountingStore.js";
import { deriveEligibleQuantity } from "./dividends.js";
import { createEmptyTickerFundamentals } from "./fundamentals/types.js";
import { listHoldings } from "./portfolio.js";
import type { Store, Transaction } from "../types/store.js";

interface BuildTickerDetailsInput {
  persistence: Pick<Persistence, "getDailyBarsForTickerMarket" | "getLatestBarDatesByTickerMarket" | "getInstrument">;
  store: Store;
  userId: string;
  ticker: string;
  accountId?: string;
  marketCode?: MarketCode;
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

  const resolvedMarketCode = resolveMarketCode({
    requestedMarketCode: input.marketCode,
    requestedAccountId: input.accountId,
    matchingTrades,
    matchingHoldings,
    accountById,
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

  const latestBarDates = await input.persistence.getLatestBarDatesByTickerMarket([
    { ticker: normalizedTicker, marketCode: resolvedMarketCode },
  ]);
  const latestBarDate = latestBarDates.get(`${normalizedTicker}:${resolvedMarketCode}`) ?? null;
  const chartBars = latestBarDate
    ? await input.persistence.getDailyBarsForTickerMarket(
      normalizedTicker,
      resolvedMarketCode,
      subtractDays(latestBarDate, 365),
      latestBarDate,
    )
    : [];
  const settledTradingDay = input.getSettledTradingDay
    ? await input.getSettledTradingDay(resolvedMarketCode)
    : null;
  const quote = buildQuoteFromBars(chartBars, settledTradingDay);

  const quantity = filteredHoldings.reduce((sum, holding) => sum + holding.quantity, 0);
  const costBasisAmount = filteredHoldings.reduce((sum, holding) => sum + holding.costBasisAmount, 0);
  const averageCostPerShare = quantity > 0 ? roundToDecimal(costBasisAmount / quantity, 4) : null;
  const marketValueAmount = quote.currentUnitPrice !== null ? roundToDecimal(quantity * quote.currentUnitPrice, 2) : null;
  const unrealizedPnlAmount = marketValueAmount !== null ? roundToDecimal(marketValueAmount - costBasisAmount, 2) : null;
  const realizedPnlAmount = filteredTransactions.reduce((sum, trade) => sum + (trade.realizedPnlAmount ?? 0), 0);
  const currency = filteredHoldings[0]?.currency ?? filteredTransactions[0]?.priceCurrency ?? currencyFor(resolvedMarketCode);

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
      range: "1Y",
      points: chartBars.map((bar) => ({
        date: bar.barDate,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        source: bar.source,
      })),
    },
    transactions: filteredTransactions.map(mapTransactionHistoryItem),
    dividends: {
      upcoming: buildUpcomingDividends(input.store, normalizedTicker, scopedAccountIds),
      recent: buildRecentDividends(input.store, normalizedTicker, scopedAccountIds),
    },
    fundamentals: input.fundamentalsRecord?.fundamentals ?? createEmptyTickerFundamentals(),
    fundamentalsRefresh: buildFundamentalsRefresh(input.fundamentalsRecord, input.now ?? new Date()),
  };

  return {
    details,
    marketCode: resolvedMarketCode,
  };
}

function resolveMarketCode(input: {
  requestedMarketCode?: MarketCode;
  requestedAccountId?: string;
  matchingTrades: Store["accounting"]["facts"]["tradeEvents"];
  matchingHoldings: ReturnType<typeof listHoldings>;
  accountById: ReadonlyMap<string, Store["accounts"][number]>;
}): MarketCode {
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
  if (tradeMarkets.length === 1) {
    return tradeMarkets[0] as MarketCode;
  }

  const holdingMarkets = [...new Set(
    input.matchingHoldings
      .map((holding) => input.accountById.get(holding.accountId)?.defaultCurrency)
      .filter((currency): currency is NonNullable<typeof currency> => Boolean(currency))
      .map((currency) => marketCodeFor(currency)),
  )];
  if (holdingMarkets.length === 1) {
    return holdingMarkets[0]!;
  }

  return "TW";
}

function buildQuoteFromBars(
  chartBars: Awaited<ReturnType<BuildTickerDetailsInput["persistence"]["getDailyBarsForTickerMarket"]>>,
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

function buildUpcomingDividends(
  store: Store,
  ticker: string,
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
        const ledgerKey = `${account.id}:${event.id}`;
        if (postedEventKeys.has(ledgerKey)) return [];
        if (event.paymentDate !== null) {
          if (event.paymentDate < today) return [];
          if (event.paymentDate > horizonDate) return [];
        }

        const eligibleQuantity = deriveEligibleQuantity(store, account.id, event.ticker, event.exDividendDate);
        if (eligibleQuantity <= 0) return [];

        return [{
          accountId: account.id,
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
  scopedAccountIds: ReadonlySet<string>,
): DashboardOverviewRecentDividendDto[] {
  const eventById = new Map(
    store.marketData.dividendEvents
      .filter((event) => event.ticker === ticker)
      .map((event) => [event.id, event]),
  );
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

function mapTransactionHistoryItem(trade: Transaction): TransactionHistoryItemDto {
  return {
    id: trade.id,
    accountId: trade.accountId,
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

function subtractDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() - days);
  return next.toISOString().slice(0, 10);
}
