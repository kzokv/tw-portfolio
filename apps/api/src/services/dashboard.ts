import type {
  DashboardOverviewDto,
  DashboardOverviewHoldingChildDto,
  DashboardOverviewHoldingGroupDto,
  DashboardOverviewHoldingDto,
  DashboardOverviewRecentDividendDto,
  DashboardOverviewUpcomingDividendDto,
  IntegrityIssueDto,
  InstrumentOptionDto,
} from "@vakwen/shared-types";
import { currencyFor, MARKET_CODES, marketCodeFor, type MarketCode } from "@vakwen/shared-types";
import { roundToDecimal } from "@vakwen/domain";
import type { QuoteSnapshot } from "@vakwen/domain";
import { deriveEligibleQuantity } from "./dividends.js";
import { listTransactionInstruments } from "./instrumentRegistry.js";
import { quoteSnapshotKey } from "./market-data/quoteSnapshotService.js";
import type { Store } from "../types/store.js";

interface BuildDashboardOverviewOptions {
  integrityIssue: IntegrityIssueDto | null;
  quotes?: QuoteSnapshot[];
}

interface DashboardOverviewDividends {
  upcoming: DashboardOverviewUpcomingDividendDto[];
  recent: DashboardOverviewRecentDividendDto[];
}

/**
 * KZO-180: pre-translation native summary shape — same field set as the wire
 * `DashboardOverviewSummaryDto` minus the `reportingCurrency` + `fxStatus`
 * fields. The route handler pipes this through `translateOverviewSummary` to
 * produce the final wire shape. `buildDashboardOverview` returns this
 * intermediate shape so callers can still access the native summary directly
 * (e.g. for tests that don't care about FX translation).
 */
export interface RawDashboardOverviewSummary {
  asOf: string;
  accountCount: number;
  holdingCount: number;
  totalCostAmount: number;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  dailyChangeAmount: number | null;
  dailyChangePercent: number | null;
  upcomingDividendCount: number;
  upcomingDividendAmount: number | null;
  openIssueCount: number;
}

export interface RawDashboardOverview extends Omit<DashboardOverviewDto, "summary" | "fxRates"> {
  summary: RawDashboardOverviewSummary;
}

export function buildDashboardOverview(
  store: Store,
  { integrityIssue, quotes = [] }: BuildDashboardOverviewOptions,
): RawDashboardOverview {
  const quoteByKey = new Map(quotes.flatMap((quote): Array<[string, QuoteSnapshot]> => {
    const entries: Array<[string, QuoteSnapshot]> = [[quoteSnapshotKey(quote.ticker, quote.marketCode), quote]];
    if (!quote.marketCode) entries.push([quote.ticker, quote]);
    return entries;
  }));
  const dividends = {
    upcoming: buildUpcomingDividends(store),
    recent: buildRecentDividends(store),
  };
  const totalCostAmount = store.accounting.projections.holdings.reduce((sum, holding) => sum + holding.costBasisAmount, 0);
  const holdings = buildOverviewHoldings(store, totalCostAmount, quoteByKey, dividends);
  const hasCompleteQuotes = holdings.length > 0 && holdings.every((holding) => holding.currentUnitPrice !== null);
  const marketValueAmount = hasCompleteQuotes
    ? holdings.reduce((sum, holding) => sum + (holding.marketValueAmount ?? 0), 0)
    : null;
  const unrealizedPnlAmount = hasCompleteQuotes
    ? holdings.reduce((sum, holding) => sum + (holding.unrealizedPnlAmount ?? 0), 0)
    : null;

  const hasMissingQuote = holdings.some((h) => h.quoteStatus === "missing");
  let dailyChangeAmount: number | null = null;
  let dailyChangePercent: number | null = null;

  if (!hasMissingQuote && holdings.length > 0) {
    const allHaveChange = holdings.every((h) => h.change !== null && h.previousClose !== null);
    if (allHaveChange) {
      dailyChangeAmount = roundToDecimal(
        holdings.reduce((sum, h) => sum + h.quantity * (h.change!), 0), 2,
      );
      const previousMarketValue = holdings.reduce(
        (sum, h) => sum + h.quantity * (h.previousClose!), 0,
      );
      dailyChangePercent = previousMarketValue > 0
        ? roundToDecimal((dailyChangeAmount / previousMarketValue) * 100, 4)
        : null;
    }
  }

  // KZO-180: emit a `RawDashboardOverview` (no `reportingCurrency` / `fxStatus`).
  // The route handler pipes the summary through `translateOverviewSummary` to
  // produce the final wire shape with FX-translated KPIs.
  return {
    settings: store.settings,
    summary: {
      asOf: quotes[0]?.asOf ?? new Date().toISOString(),
      accountCount: store.accounts.length,
      holdingCount: holdings.length,
      totalCostAmount,
      marketValueAmount,
      unrealizedPnlAmount,
      dailyChangeAmount,
      dailyChangePercent,
      upcomingDividendCount: dividends.upcoming.length,
      upcomingDividendAmount: dividends.upcoming.reduce((sum, dividend) => sum + (dividend.expectedAmount ?? 0), 0) || null,
      openIssueCount: integrityIssue ? 1 : 0,
    },
    marketValues: [],
    holdings,
    holdingGroups: buildOverviewHoldingGroups(store, holdings),
    dividends,
    actions: {
      integrityIssue,
      recomputeAvailable: true,
    },
    instruments: listTransactionInstruments(store.instruments).map(mapInstrumentOption).filter((i): i is InstrumentOptionDto => i !== null),
    accounts: store.accounts,
    feeProfiles: store.feeProfiles,
    feeProfileBindings: store.feeProfileBindings,
  };
}

// KZO-180: `buildDashboardPerformance` deleted. The FX-aware replacement lives
// in `apps/api/src/services/dashboardReportingCurrency.ts` (`translatePerformancePoints`).
// `buildPerformanceFromSnapshots` and `buildSyntheticPerformance` are deleted
// alongside; their FX-aware analogs live in the new service file. See
// `process-refactor-rename-verification.md` — `buildDashboardPerformance`
// was grep-confirmed to have only the registerRoutes.ts:3258 caller (now
// rewired) and tests; no other consumers.

function mapInstrumentOption(def: Store["instruments"][number]): InstrumentOptionDto | null {
  if (def.type === null) return null;
  return {
    ticker: def.ticker,
    instrumentType: def.type,
    marketCode: def.marketCode,
    isProvisional: def.isProvisional === true,
  };
}

function buildOverviewHoldings(
  store: Store,
  totalCostAmount: number,
  quoteByKey: Map<string, QuoteSnapshot>,
  dividends: DashboardOverviewDividends,
): DashboardOverviewHoldingDto[] {
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
  const accountMarket = new Map(store.accounts.map((account) => [
    account.id,
    marketCodeFor(account.defaultCurrency),
  ]));
  const recentPostedDividends = new Map(
    dividends.recent.map((dividend) => [`${dividend.accountId}:${dividend.ticker}`, dividend.postedAt]),
  );
  const upcomingDividendDates = new Map(
    dividends.upcoming.map((dividend) => [`${dividend.accountId}:${dividend.ticker}`, dividend.paymentDate ?? dividend.exDividendDate ?? ""]),
  );

  return [...store.accounting.projections.holdings]
    .map((holding) => {
      const market = resolveHoldingMarketCode(store, holding, accountMarket);
      const quote = quoteByKey.get(quoteSnapshotKey(holding.ticker, market)) ?? quoteByKey.get(holding.ticker);
      const marketValueAmount = quote ? roundToDecimal(quote.close * holding.quantity, 2) : null;
      return {
        accountId: holding.accountId,
        accountName: accountById.get(holding.accountId)?.name ?? holding.accountId,
        ticker: holding.ticker,
        marketCode: market,
        quantity: holding.quantity,
        costBasisAmount: holding.costBasisAmount,
        currency: holding.currency,
        averageCostPerShare: holding.quantity > 0 ? roundToDecimal(holding.costBasisAmount / holding.quantity, 2) : 0,
        currentUnitPrice: quote?.close ?? null,
        marketValueAmount,
        unrealizedPnlAmount: marketValueAmount === null ? null : marketValueAmount - holding.costBasisAmount,
        allocationPct: totalCostAmount > 0 ? (holding.costBasisAmount / totalCostAmount) * 100 : null,
        change: quote?.change ?? null,
        changePercent: quote?.changePercent ?? null,
        previousClose: quote?.previousClose ?? null,
        quoteStatus: !quote ? "missing" as const : quote.isProvisional ? "provisional" as const : "current" as const,
        nextDividendDate: upcomingDividendDates.get(`${holding.accountId}:${holding.ticker}`) || null,
        lastDividendPostedDate: recentPostedDividends.get(`${holding.accountId}:${holding.ticker}`) ?? null,
        // KZO-177: defaults — the route handler post-processes these via
        // `enrichHoldingsWithFreshness()` using the trading-calendar helper.
        // Sync `buildDashboardOverview` returns these as `current`/`null` so
        // unit tests that don't supply a calendar still produce a valid DTO.
        freshness: "current" as const,
        freshnessTooltip: null,
      };
    })
    .sort((left, right) => right.costBasisAmount - left.costBasisAmount || left.ticker.localeCompare(right.ticker));
}

export function buildOverviewHoldingGroups(
  store: Store,
  holdings: ReadonlyArray<DashboardOverviewHoldingDto>,
): DashboardOverviewHoldingGroupDto[] {
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
  const groups = new Map<string, DashboardOverviewHoldingGroupDto>();
  const totalCostAmount = holdings.reduce((sum, holding) => sum + holding.costBasisAmount, 0);

  for (const holding of holdings) {
    const account = accountById.get(holding.accountId);
    const marketCode = holding.marketCode;
    const groupKey = `${holding.ticker}:${marketCode}:${holding.currency}`;
    const child: DashboardOverviewHoldingChildDto = {
      accountId: holding.accountId,
      accountName: holding.accountName,
      ticker: holding.ticker,
      marketCode,
      quantity: holding.quantity,
      costBasisAmount: holding.costBasisAmount,
      currency: holding.currency,
      averageCostPerShare: holding.averageCostPerShare,
      currentUnitPrice: holding.currentUnitPrice,
      marketValueAmount: holding.marketValueAmount,
      unrealizedPnlAmount: holding.unrealizedPnlAmount,
      allocationPct: holding.allocationPct,
      change: holding.change,
      changePercent: holding.changePercent,
      previousClose: holding.previousClose,
      quoteStatus: holding.quoteStatus,
      nextDividendDate: holding.nextDividendDate,
      lastDividendPostedDate: holding.lastDividendPostedDate,
      freshness: holding.freshness,
      freshnessTooltip: holding.freshnessTooltip,
      reportingCurrency: account?.defaultCurrency ?? currencyFor(marketCode),
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
      reportingDailyChangeAmount: null,
      reportingAllocationPercent: null,
      fxStatus: "complete",
      allocationBasisUsed: "market_value",
      allocationBasisFallbackReason: null,
    };

    const existing = groups.get(groupKey);
    if (existing) {
      existing.quantity += child.quantity;
      existing.costBasisAmount += child.costBasisAmount;
      existing.marketValueAmount = existing.marketValueAmount === null || child.marketValueAmount === null
        ? null
        : roundToDecimal(existing.marketValueAmount + child.marketValueAmount, 2);
      existing.unrealizedPnlAmount = existing.unrealizedPnlAmount === null || child.unrealizedPnlAmount === null
        ? null
        : roundToDecimal(existing.unrealizedPnlAmount + child.unrealizedPnlAmount, 2);
      existing.nextDividendDate = minDate(existing.nextDividendDate, child.nextDividendDate);
      existing.lastDividendPostedDate = maxDate(existing.lastDividendPostedDate, child.lastDividendPostedDate);
      existing.quoteStatus = mergeQuoteStatus(existing.quoteStatus, child.quoteStatus);
      existing.freshness = mergeFreshness(existing.freshness, child.freshness);
      existing.freshnessTooltip = existing.freshnessTooltip ?? child.freshnessTooltip;
      existing.children.push(child);
      existing.accountCount = existing.children.length;
      existing.averageCostPerShare = existing.quantity > 0
        ? roundToDecimal(existing.costBasisAmount / existing.quantity, 2)
        : 0;
      existing.allocationPct = totalCostAmount > 0
        ? (existing.costBasisAmount / totalCostAmount) * 100
        : null;
      continue;
    }

    groups.set(groupKey, {
      ticker: child.ticker,
      marketCode,
      quantity: child.quantity,
      costBasisAmount: child.costBasisAmount,
      currency: child.currency,
      averageCostPerShare: child.averageCostPerShare,
      currentUnitPrice: child.currentUnitPrice,
      marketValueAmount: child.marketValueAmount,
      unrealizedPnlAmount: child.unrealizedPnlAmount,
      allocationPct: totalCostAmount > 0 ? (child.costBasisAmount / totalCostAmount) * 100 : null,
      change: child.change,
      changePercent: child.changePercent,
      previousClose: child.previousClose,
      quoteStatus: child.quoteStatus,
      nextDividendDate: child.nextDividendDate,
      lastDividendPostedDate: child.lastDividendPostedDate,
      freshness: child.freshness,
      freshnessTooltip: child.freshnessTooltip,
      accountCount: 1,
      reportingCurrency: child.reportingCurrency,
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
      reportingDailyChangeAmount: null,
      reportingAllocationPercent: null,
      fxStatus: "complete",
      allocationBasisUsed: "market_value",
      allocationBasisFallbackReason: null,
      children: [child],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      children: [...group.children].sort(
        (left, right) => right.costBasisAmount - left.costBasisAmount || left.accountId.localeCompare(right.accountId),
      ),
    }))
    .sort((left, right) => right.costBasisAmount - left.costBasisAmount || left.ticker.localeCompare(right.ticker));
}

function minDate(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left <= right ? left : right;
}

function maxDate(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left >= right ? left : right;
}

function mergeQuoteStatus(
  left: DashboardOverviewHoldingDto["quoteStatus"],
  right: DashboardOverviewHoldingDto["quoteStatus"],
): DashboardOverviewHoldingDto["quoteStatus"] {
  if (left === "missing" || right === "missing") return "missing";
  if (left === "provisional" || right === "provisional") return "provisional";
  return "current";
}

function resolveHoldingMarketCode(
  store: Store,
  holding: Pick<Store["accounting"]["projections"]["holdings"][number], "accountId" | "ticker" | "currency"> & {
    marketCode?: MarketCode;
  },
  accountMarket: ReadonlyMap<string, MarketCode>,
): MarketCode {
  if (holding.marketCode) return holding.marketCode;

  const tradeEvents = store.accounting.facts.tradeEvents ?? [];
  const tradeMarkets = uniqueMarketCodes(
    tradeEvents
      .filter((trade) => trade.accountId === holding.accountId && trade.ticker === holding.ticker)
      .map((trade) => trade.marketCode),
  );
  if (tradeMarkets.length === 1) return tradeMarkets[0]!;

  const instrumentMarkets = uniqueMarketCodes(
    store.instruments
      .filter((instrument) => instrument.ticker === holding.ticker)
      .map((instrument) => instrument.marketCode),
  );
  if (instrumentMarkets.length === 1) return instrumentMarkets[0]!;

  return accountMarket.get(holding.accountId) ?? marketCodeFor(holding.currency);
}

function uniqueMarketCodes(values: ReadonlyArray<string>): MarketCode[] {
  return [...new Set(values)]
    .filter((market): market is MarketCode => (MARKET_CODES as readonly string[]).includes(market));
}

function mergeFreshness(
  left: DashboardOverviewHoldingDto["freshness"],
  right: DashboardOverviewHoldingDto["freshness"],
): DashboardOverviewHoldingDto["freshness"] {
  if (left === "stale_red" || right === "stale_red") return "stale_red";
  if (left === "stale_amber" || right === "stale_amber") return "stale_amber";
  return "current";
}

const UPCOMING_DIVIDEND_WINDOW_DAYS = 60;

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

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + UPCOMING_DIVIDEND_WINDOW_DAYS);
  const horizonDate = horizon.toISOString().slice(0, 10);

  return store.accounts
    .flatMap((account) =>
      store.marketData.dividendEvents.flatMap((event): DashboardOverviewUpcomingDividendDto[] => {
        const ledgerKey = `${account.id}:${event.id}`;
        const activeLedger = activeLedgerByAccountAndEvent.get(ledgerKey);
        if (postedEventKeys.has(ledgerKey)) return [];

        // Only surface events whose payment date is still ahead of us and inside
        // the upcoming horizon. Events with an unknown payment date (declared
        // but not yet scheduled) are always included.
        if (event.paymentDate !== null) {
          if (event.paymentDate < today) return [];
          if (event.paymentDate > horizonDate) return [];
        }

        // Use the eligible quantity at the ex-dividend date from current
        // trade events — this ensures retroactive trade edits flow into the
        // upcoming widget immediately. Do not trust any stored
        // expected_cash_amount on an active ledger entry: those are
        // snapshots captured at posting time and may be stale.
        const eligibleQuantity = deriveEligibleQuantity(store, account.id, event.ticker, event.exDividendDate);
        if (eligibleQuantity <= 0) return [];

        const expectedAmount = event.cashDividendPerShare > 0
          ? eligibleQuantity * event.cashDividendPerShare
          : null;

        return [
          {
            accountId: account.id,
            accountName: account.name,
            ticker: event.ticker,
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
  const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
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
        accountName: accountById.get(entry.accountId)?.name ?? entry.accountId,
        ticker: event?.ticker ?? "UNKNOWN",
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
  return leftDate.localeCompare(rightDate) || left.ticker.localeCompare(right.ticker) || left.accountId.localeCompare(right.accountId);
}

function resolveSourceSummary(eventType: string | undefined): string | null {
  if (!eventType) return null;
  if (eventType === "STOCK") return "Stock dividend";
  if (eventType === "CASH_AND_STOCK") return "Cash and stock dividend";
  return "Cash dividend";
}

function resolveUpcomingStatus(
  paymentDate: string | null,
  postingStatus: string | undefined,
): DashboardOverviewUpcomingDividendDto["status"] {
  if (postingStatus === "expected") {
    return "expected";
  }

  if (!paymentDate) {
    return "declared";
  }

  const today = new Date();
  const nextTwoWeeks = new Date(today);
  nextTwoWeeks.setUTCDate(nextTwoWeeks.getUTCDate() + 14);
  if (paymentDate <= nextTwoWeeks.toISOString().slice(0, 10)) {
    return "paying-soon";
  }

  return "declared";
}

// KZO-180: `buildPerformanceFromSnapshots`, `buildSyntheticPerformance`,
// `summarizePerformancePoint`, `applyTradeToPerformancePosition`,
// `compareTradesForPerformance`, and `addUtcDays` deleted alongside
// `buildDashboardPerformance`. Their FX-aware analogs live in
// `apps/api/src/services/dashboardReportingCurrency.ts`
// (`buildFxAwareSyntheticPerformance` etc.).
