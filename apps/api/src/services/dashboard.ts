import type {
  DashboardOverviewDto,
  DashboardOverviewHoldingDto,
  DashboardOverviewRecentDividendDto,
  DashboardOverviewUpcomingDividendDto,
  IntegrityIssueDto,
  InstrumentOptionDto,
} from "@tw-portfolio/shared-types";
import { roundToDecimal } from "@tw-portfolio/domain";
import type { QuoteSnapshot } from "@tw-portfolio/domain";
import { deriveEligibleQuantity } from "./dividends.js";
import { listTransactionInstruments } from "./instrumentRegistry.js";
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

export interface RawDashboardOverview extends Omit<DashboardOverviewDto, "summary"> {
  summary: RawDashboardOverviewSummary;
}

export function buildDashboardOverview(
  store: Store,
  { integrityIssue, quotes = [] }: BuildDashboardOverviewOptions,
): RawDashboardOverview {
  const quoteByTicker = new Map(quotes.map((quote) => [quote.ticker, quote]));
  const dividends = {
    upcoming: buildUpcomingDividends(store),
    recent: buildRecentDividends(store),
  };
  const totalCostAmount = store.accounting.projections.holdings.reduce((sum, holding) => sum + holding.costBasisAmount, 0);
  const holdings = buildOverviewHoldings(store, totalCostAmount, quoteByTicker, dividends);
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
    holdings,
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
    marketCode: def.marketCode ?? null,
    isProvisional: def.isProvisional === true,
  };
}

function buildOverviewHoldings(
  store: Store,
  totalCostAmount: number,
  quoteByTicker: Map<string, QuoteSnapshot>,
  dividends: DashboardOverviewDividends,
): DashboardOverviewHoldingDto[] {
  const recentPostedDividends = new Map(
    dividends.recent.map((dividend) => [`${dividend.accountId}:${dividend.ticker}`, dividend.postedAt]),
  );
  const upcomingDividendDates = new Map(
    dividends.upcoming.map((dividend) => [`${dividend.accountId}:${dividend.ticker}`, dividend.paymentDate ?? dividend.exDividendDate ?? ""]),
  );

  return [...store.accounting.projections.holdings]
    .map((holding) => {
      const quote = quoteByTicker.get(holding.ticker);
      const marketValueAmount = quote ? roundToDecimal(quote.close * holding.quantity, 2) : null;
      return {
        accountId: holding.accountId,
        ticker: holding.ticker,
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
      };
    })
    .sort((left, right) => right.costBasisAmount - left.costBasisAmount || left.ticker.localeCompare(right.ticker));
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
