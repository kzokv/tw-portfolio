import type {
  DashboardPerformanceDto,
  DashboardPerformancePointDto,
  DashboardPerformanceRange,
  DashboardOverviewDto,
  DashboardOverviewHoldingDto,
  DashboardOverviewRecentDividendDto,
  DashboardOverviewUpcomingDividendDto,
  IntegrityIssueDto,
  SymbolOptionDto,
} from "@tw-portfolio/shared-types";
import type { Quote } from "../providers/marketData.js";
import { listTransactionSymbols } from "./symbolRegistry.js";
import type { Store } from "../types/store.js";

interface BuildDashboardOverviewOptions {
  integrityIssue: IntegrityIssueDto | null;
  quotes?: Quote[];
}

interface DashboardOverviewDividends {
  upcoming: DashboardOverviewUpcomingDividendDto[];
  recent: DashboardOverviewRecentDividendDto[];
}

export function buildDashboardOverview(
  store: Store,
  { integrityIssue, quotes = [] }: BuildDashboardOverviewOptions,
): DashboardOverviewDto {
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const dividends = {
    upcoming: buildUpcomingDividends(store),
    recent: buildRecentDividends(store),
  };
  const totalCostAmount = store.accounting.projections.holdings.reduce((sum, holding) => sum + holding.costBasisAmount, 0);
  const holdings = buildOverviewHoldings(store, totalCostAmount, quoteBySymbol, dividends);
  const hasCompleteQuotes = holdings.length > 0 && holdings.every((holding) => holding.currentUnitPrice !== null);
  const marketValueAmount = hasCompleteQuotes
    ? holdings.reduce((sum, holding) => sum + (holding.marketValueAmount ?? 0), 0)
    : null;
  const unrealizedPnlAmount = hasCompleteQuotes
    ? holdings.reduce((sum, holding) => sum + (holding.unrealizedPnlAmount ?? 0), 0)
    : null;

  return {
    settings: store.settings,
    summary: {
      asOf: quotes[0]?.asOf ?? new Date().toISOString(),
      accountCount: store.accounts.length,
      holdingCount: holdings.length,
      totalCostAmount,
      totalCostCurrency: holdings[0]?.currency ?? "TWD",
      marketValueAmount,
      unrealizedPnlAmount,
      upcomingDividendCount: dividends.upcoming.length,
      upcomingDividendAmount: dividends.upcoming.reduce((sum, dividend) => sum + (dividend.expectedAmount ?? 0), 0) || null,
      openIssueCount: integrityIssue ? 1 : 0,
    },
    holdings,
    dividends,
    actions: {
      integrityIssue,
      recomputeAvailable: true,
    },
    symbols: listTransactionSymbols(store.symbols).map(mapSymbolOption),
    accounts: store.accounts,
    feeProfiles: store.feeProfiles,
    feeProfileBindings: store.feeProfileBindings,
  };
}

export function buildDashboardPerformance(
  store: Store,
  {
    range,
    quotes = [],
    asOf = quotes[0]?.asOf ?? new Date().toISOString(),
  }: {
    range: DashboardPerformanceRange;
    quotes?: Quote[];
    asOf?: string;
  },
): DashboardPerformanceDto {
  const snapshotPoints = buildPerformanceFromSnapshots(store, range, asOf);
  if (snapshotPoints.length > 0) {
    return { range, points: snapshotPoints };
  }

  return {
    range,
    points: buildSyntheticPerformance(store, range, asOf, quotes),
  };
}

function mapSymbolOption(symbol: Store["symbols"][number]): SymbolOptionDto {
  return {
    ticker: symbol.ticker,
    instrumentType: symbol.type,
    marketCode: symbol.marketCode ?? null,
    isProvisional: symbol.isProvisional === true,
  };
}

function buildOverviewHoldings(
  store: Store,
  totalCostAmount: number,
  quoteBySymbol: Map<string, Quote>,
  dividends: DashboardOverviewDividends,
): DashboardOverviewHoldingDto[] {
  const recentPostedDividends = new Map(
    dividends.recent.map((dividend) => [`${dividend.accountId}:${dividend.symbol}`, dividend.postedAt]),
  );
  const upcomingDividendDates = new Map(
    dividends.upcoming.map((dividend) => [`${dividend.accountId}:${dividend.symbol}`, dividend.paymentDate ?? dividend.exDividendDate ?? ""]),
  );

  return [...store.accounting.projections.holdings]
    .map((holding) => {
      const quote = quoteBySymbol.get(holding.symbol);
      const marketValueAmount = quote ? quote.unitPrice * holding.quantity : null;
      return {
        accountId: holding.accountId,
        symbol: holding.symbol,
        quantity: holding.quantity,
        costBasisAmount: holding.costBasisAmount,
        currency: holding.currency,
        averageCostPerShare: holding.quantity > 0 ? holding.costBasisAmount / holding.quantity : 0,
        currentUnitPrice: quote?.unitPrice ?? null,
        marketValueAmount,
        unrealizedPnlAmount: marketValueAmount === null ? null : marketValueAmount - holding.costBasisAmount,
        allocationPct: totalCostAmount > 0 ? (holding.costBasisAmount / totalCostAmount) * 100 : null,
        nextDividendDate: upcomingDividendDates.get(`${holding.accountId}:${holding.symbol}`) || null,
        lastDividendPostedDate: recentPostedDividends.get(`${holding.accountId}:${holding.symbol}`) ?? null,
      };
    })
    .sort((left, right) => right.costBasisAmount - left.costBasisAmount || left.symbol.localeCompare(right.symbol));
}

function buildUpcomingDividends(store: Store): DashboardOverviewUpcomingDividendDto[] {
  const activeLedgerByAccountAndEvent = new Map<string, { expectedCashAmount: number; postingStatus: string }>();
  const postedEventKeys = new Set<string>();

  for (const entry of store.accounting.facts.dividendLedgerEntries) {
    const key = `${entry.accountId}:${entry.dividendEventId}`;
    if (!entry.reversalOfDividendLedgerEntryId && !entry.supersededAt) {
      activeLedgerByAccountAndEvent.set(key, {
        expectedCashAmount: entry.expectedCashAmount,
        postingStatus: entry.postingStatus,
      });
    }
    if (entry.postingStatus === "posted") {
      postedEventKeys.add(key);
    }
  }

  return store.accounts
    .flatMap((account) =>
      store.accounting.facts.dividendEvents.flatMap((event): DashboardOverviewUpcomingDividendDto[] => {
        const accountHolding = store.accounting.projections.holdings.find(
          (holding) => holding.accountId === account.id && holding.symbol === event.symbol && holding.quantity > 0,
        );
        if (!accountHolding) return [];

        const ledgerKey = `${account.id}:${event.id}`;
        const activeLedger = activeLedgerByAccountAndEvent.get(ledgerKey);
        if (postedEventKeys.has(ledgerKey)) return [];

        const expectedAmount = activeLedger?.expectedCashAmount
          ?? (event.cashDividendPerShare > 0 ? accountHolding.quantity * event.cashDividendPerShare : null);

        return [
          {
            accountId: account.id,
            symbol: event.symbol,
            exDividendDate: event.exDividendDate,
            paymentDate: event.paymentDate,
            expectedAmount,
            currency: event.cashDividendCurrency,
            status: resolveUpcomingStatus(event.paymentDate, activeLedger?.postingStatus),
          },
        ];
      }),
    )
    .sort(compareUpcomingDividends);
}

function buildRecentDividends(store: Store): DashboardOverviewRecentDividendDto[] {
  const eventById = new Map(store.accounting.facts.dividendEvents.map((event) => [event.id, event]));
  const deductionsByLedgerId = new Map<string, number>();

  for (const deduction of store.accounting.facts.dividendDeductionEntries) {
    deductionsByLedgerId.set(
      deduction.dividendLedgerEntryId,
      (deductionsByLedgerId.get(deduction.dividendLedgerEntryId) ?? 0) + deduction.amount,
    );
  }

  return store.accounting.facts.dividendLedgerEntries
    .filter((entry) => entry.postingStatus === "posted" && !entry.reversalOfDividendLedgerEntryId)
    .map((entry) => {
      const event = eventById.get(entry.dividendEventId);
      const deductionAmount = deductionsByLedgerId.get(entry.id) ?? 0;
      return {
        accountId: entry.accountId,
        symbol: event?.symbol ?? "UNKNOWN",
        postedAt: entry.bookedAt ?? event?.paymentDate ?? new Date().toISOString(),
        netAmount: entry.receivedCashAmount,
        grossAmount: entry.receivedCashAmount + deductionAmount,
        deductionAmount: deductionAmount || null,
        currency: event?.cashDividendCurrency ?? "TWD",
        sourceSummary: resolveSourceSummary(event?.eventType),
        status: entry.reconciliationStatus === "matched" ? "posted" : "unreconciled",
      } satisfies DashboardOverviewRecentDividendDto;
    })
    .sort((left, right) => right.postedAt.localeCompare(left.postedAt));
}

function compareUpcomingDividends(
  left: DashboardOverviewUpcomingDividendDto,
  right: DashboardOverviewUpcomingDividendDto,
): number {
  const leftDate = left.paymentDate ?? left.exDividendDate ?? "";
  const rightDate = right.paymentDate ?? right.exDividendDate ?? "";
  return leftDate.localeCompare(rightDate) || left.symbol.localeCompare(right.symbol) || left.accountId.localeCompare(right.accountId);
}

function resolveSourceSummary(eventType: string | undefined): string | null {
  if (!eventType) return null;
  if (eventType === "STOCK") return "Stock dividend";
  if (eventType === "CASH_AND_STOCK") return "Cash and stock dividend";
  return "Cash dividend";
}

function resolveUpcomingStatus(
  paymentDate: string,
  postingStatus: string | undefined,
): DashboardOverviewUpcomingDividendDto["status"] {
  if (postingStatus === "expected") {
    return "expected";
  }

  const today = new Date();
  const nextTwoWeeks = new Date(today);
  nextTwoWeeks.setUTCDate(nextTwoWeeks.getUTCDate() + 14);
  if (paymentDate <= nextTwoWeeks.toISOString().slice(0, 10)) {
    return "paying-soon";
  }

  return "declared";
}

function buildPerformanceFromSnapshots(
  store: Store,
  range: DashboardPerformanceRange,
  asOf: string,
): DashboardPerformancePointDto[] {
  const { startDate, endDate } = resolveRangeBounds(range, asOf);

  return store.accounting.projections.dailyPortfolioSnapshots
    .filter((snapshot) => snapshot.snapshotDate >= startDate && snapshot.snapshotDate <= endDate)
    .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate))
    .map((snapshot) => ({
      date: snapshot.snapshotDate,
      totalCostAmount: snapshot.totalCostAmount,
      marketValueAmount: snapshot.totalMarketValueAmount,
      unrealizedPnlAmount: snapshot.totalUnrealizedPnlAmount,
    }));
}

function buildSyntheticPerformance(
  store: Store,
  range: DashboardPerformanceRange,
  asOf: string,
  quotes: Quote[],
): DashboardPerformancePointDto[] {
  const { startDate, endDate } = resolveRangeBounds(range, asOf);
  const sortedTrades = [...store.accounting.facts.tradeEvents].sort(compareTradesForPerformance);
  const positions = new Map<string, { quantity: number; costBasisAmount: number }>();
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const points: DashboardPerformancePointDto[] = [];
  let tradeIndex = 0;

  while (tradeIndex < sortedTrades.length && sortedTrades[tradeIndex].tradeDate < startDate) {
    applyTradeToPerformancePosition(positions, sortedTrades[tradeIndex]);
    tradeIndex += 1;
  }

  for (let cursor = new Date(`${startDate}T00:00:00.000Z`); cursor <= new Date(`${endDate}T00:00:00.000Z`); cursor = addUtcDays(cursor, 1)) {
    const currentDate = cursor.toISOString().slice(0, 10);

    while (tradeIndex < sortedTrades.length && sortedTrades[tradeIndex].tradeDate <= currentDate) {
      applyTradeToPerformancePosition(positions, sortedTrades[tradeIndex]);
      tradeIndex += 1;
    }

    const point = summarizePerformancePoint(currentDate, positions, quoteBySymbol);
    if (point.totalCostAmount > 0 || point.marketValueAmount !== null) {
      points.push(point);
    }
  }

  return points;
}

function summarizePerformancePoint(
  date: string,
  positions: Map<string, { quantity: number; costBasisAmount: number }>,
  quoteBySymbol: Map<string, Quote>,
): DashboardPerformancePointDto {
  let totalCostAmount = 0;
  let marketValueAmount = 0;
  let hasPositions = false;
  let hasCompleteQuotes = true;

  for (const [positionKey, position] of positions) {
    if (position.quantity <= 0 || position.costBasisAmount <= 0) continue;
    hasPositions = true;
    totalCostAmount += position.costBasisAmount;

    const symbol = positionKey.includes(":")
      ? positionKey.slice(positionKey.lastIndexOf(":") + 1)
      : positionKey;
    const quote = quoteBySymbol.get(symbol);
    if (!quote) {
      hasCompleteQuotes = false;
      continue;
    }

    marketValueAmount += quote.unitPrice * position.quantity;
  }

  const resolvedMarketValue = hasPositions && hasCompleteQuotes ? marketValueAmount : null;

  return {
    date,
    totalCostAmount,
    marketValueAmount: resolvedMarketValue,
    unrealizedPnlAmount: resolvedMarketValue === null ? null : resolvedMarketValue - totalCostAmount,
  };
}

function applyTradeToPerformancePosition(
  positions: Map<string, { quantity: number; costBasisAmount: number }>,
  trade: Store["accounting"]["facts"]["tradeEvents"][number],
): void {
  const key = `${trade.accountId}:${trade.symbol}`;
  const previous = positions.get(key) ?? { quantity: 0, costBasisAmount: 0 };

  if (trade.type === "BUY") {
    positions.set(key, {
      quantity: previous.quantity + trade.quantity,
      costBasisAmount: previous.costBasisAmount + trade.quantity * trade.unitPrice + trade.commissionAmount + trade.taxAmount,
    });
    return;
  }

  const realizedPnlAmount = trade.realizedPnlAmount ?? 0;
  const proceedsNet = trade.quantity * trade.unitPrice - trade.commissionAmount - trade.taxAmount;
  const allocatedCostAmount = Math.max(0, proceedsNet - realizedPnlAmount);
  const nextQuantity = Math.max(0, previous.quantity - trade.quantity);
  const nextCostBasisAmount = Math.max(0, previous.costBasisAmount - allocatedCostAmount);

  if (nextQuantity === 0) {
    positions.delete(key);
    return;
  }

  positions.set(key, {
    quantity: nextQuantity,
    costBasisAmount: nextCostBasisAmount,
  });
}

function compareTradesForPerformance(
  left: Store["accounting"]["facts"]["tradeEvents"][number],
  right: Store["accounting"]["facts"]["tradeEvents"][number],
): number {
  return (
    left.tradeDate.localeCompare(right.tradeDate)
    || (left.bookingSequence ?? 0) - (right.bookingSequence ?? 0)
    || (left.tradeTimestamp ?? "").localeCompare(right.tradeTimestamp ?? "")
    || left.id.localeCompare(right.id)
  );
}

function resolveRangeBounds(range: DashboardPerformanceRange, asOf: string): { startDate: string; endDate: string } {
  const end = new Date(asOf);
  const endDate = end.toISOString().slice(0, 10);
  const start = new Date(`${endDate}T00:00:00.000Z`);

  if (range === "1M") {
    start.setUTCMonth(start.getUTCMonth() - 1);
  } else if (range === "3M") {
    start.setUTCMonth(start.getUTCMonth() - 3);
  } else if (range === "1Y") {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  } else {
    start.setUTCMonth(0, 1);
  }

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate,
  };
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
