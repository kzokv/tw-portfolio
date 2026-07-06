"use client";

import Link from "next/link";
import type {
  DashboardOverviewRecentDividendDto,
  DashboardOverviewUpcomingDividendDto,
  LocaleCode,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

interface TickerDividendsTabProps {
  dict: AppDictionary;
  locale: LocaleCode;
  marketCode: string;
  ticker: string;
  tickerName: string | null;
  dividends: {
    upcomingCount: number;
    nextPaymentDate: string | null;
    lastPostedDate: string | null;
    openReconciliationCount: number;
    upcoming: DashboardOverviewUpcomingDividendDto[];
    recent: DashboardOverviewRecentDividendDto[];
  };
  onMarkMatched: (dividendLedgerEntryId: string) => void;
  pendingLedgerEntryId: string | null;
}

function buildDividendReviewHref(ticker: string, marketCode: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({
    view: "ledger",
    ticker,
    marketCode,
  });

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      params.set(key, value);
    }
  }

  return `/dividends?${params.toString()}`;
}

function resolveUpcomingStatusLabel(
  dict: AppDictionary,
  status: DashboardOverviewUpcomingDividendDto["status"],
): string {
  if (status === "expected") return dict.dashboardHome.statusExpected;
  if (status === "paying-soon") return dict.dashboardHome.statusPayingSoon;
  return dict.dashboardHome.statusDeclared;
}

function resolveRecentStatusLabel(
  dict: AppDictionary,
  status: DashboardOverviewRecentDividendDto["reconciliationStatus"],
): string {
  if (status === "matched") return dict.dividends.form.reconciliation.statusMatched;
  if (status === "explained") return dict.dividends.form.reconciliation.statusExplained;
  if (status === "resolved") return dict.dividends.form.reconciliation.statusResolved;
  return dict.dividends.form.reconciliation.statusOpen;
}

function statusClassName(status: "expected" | "declared" | "paying-soon" | "open" | "matched" | "explained" | "resolved") {
  switch (status) {
    case "expected":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "paying-soon":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "matched":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "explained":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "resolved":
      return "border-teal-200 bg-teal-50 text-teal-700";
    case "open":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function SummaryCard({
  eyebrow,
  value,
  detail,
  badge,
  testId,
}: {
  eyebrow: string;
  value: string;
  detail: string;
  badge?: string;
  testId: string;
}) {
  return (
    <Card className="rounded-[24px] border border-slate-200 bg-white/94 p-5 shadow-[0_16px_34px_rgba(148,163,184,0.12)]" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
        {badge ? (
          <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
    </Card>
  );
}

function KeyValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

export function TickerDividendsTab({
  dict,
  locale,
  marketCode,
  ticker,
  tickerName,
  dividends,
  onMarkMatched,
  pendingLedgerEntryId,
}: TickerDividendsTabProps) {
  const openReviewHref = buildDividendReviewHref(ticker, marketCode);
  const upcomingEvents = dividends.upcoming;
  const postedHistory = dividends.recent;
  const openRows = postedHistory.filter((row) => row.reconciliationStatus === "open" && row.dividendLedgerEntryId);
  const resolvedTickerName = tickerName
    ?? upcomingEvents.find((row) => row.tickerName?.trim())?.tickerName?.trim()
    ?? postedHistory.find((row) => row.tickerName?.trim())?.tickerName?.trim()
    ?? null;
  const tickerLabel = resolvedTickerName ? `${ticker} ${resolvedTickerName}` : ticker;

  return (
    <div className="grid gap-6" data-testid="ticker-detail-dividends">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-sky-600/80">{dict.dividends.ticker.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">{dict.tickerHistory.dividendsTabLabel}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            {dict.dividends.ticker.description.replace("{ticker}", tickerLabel)}
          </p>
        </div>
        <Button asChild className="min-w-[220px]">
          <Link href={openReviewHref} data-testid="ticker-dividends-open-review">
            {dict.dividends.ticker.openReview}
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          eyebrow={dict.dividends.ticker.summary.upcoming}
          value={formatNumber(dividends.upcomingCount, locale)}
          detail={dividends.nextPaymentDate
            ? dict.dividends.ticker.summary.upcomingDetail.replace("{date}", formatDateLabel(dividends.nextPaymentDate, locale))
            : dict.dividends.ticker.summary.noUpcoming}
          badge={dividends.upcomingCount > 0 ? String(dividends.upcomingCount) : undefined}
          testId="ticker-dividends-summary-upcoming"
        />
        <SummaryCard
          eyebrow={dict.dividends.ticker.summary.lastPosted}
          value={postedHistory[0]
            ? formatCurrencyAmount(postedHistory[0].netAmount, postedHistory[0].currency, locale)
            : dict.tickerHistory.noHoldingData}
          detail={postedHistory[0]
            ? dict.dividends.ticker.summary.lastPostedDetail.replace("{account}", postedHistory[0].accountName ?? postedHistory[0].accountId)
            : dict.dividends.ticker.summary.noPosted}
          badge={dividends.lastPostedDate ? formatDateLabel(dividends.lastPostedDate, locale) : undefined}
          testId="ticker-dividends-summary-last-posted"
        />
        <SummaryCard
          eyebrow={dict.dividends.ticker.summary.openReconciliation}
          value={formatNumber(dividends.openReconciliationCount, locale)}
          detail={dividends.openReconciliationCount > 0
            ? dict.dividends.ticker.summary.openReconciliationDetail
            : dict.dividends.ticker.summary.noOpenReconciliation}
          badge={dividends.openReconciliationCount > 0 ? String(dividends.openReconciliationCount) : undefined}
          testId="ticker-dividends-summary-open-reconciliation"
        />
        <SummaryCard
          eyebrow={dict.dividends.ticker.summary.nextPayment}
          value={dividends.nextPaymentDate ? formatDateLabel(dividends.nextPaymentDate, locale) : dict.tickerHistory.noHoldingData}
          detail={dividends.nextPaymentDate
            ? dict.dividends.ticker.summary.nextPaymentDetail
            : dict.dividends.ticker.summary.noUpcoming}
          testId="ticker-dividends-summary-next-payment"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.75fr)_minmax(320px,0.8fr)]">
        <div className="grid gap-6">
          <Card className="rounded-[28px] border border-slate-200 bg-white/94 p-0 shadow-[0_18px_36px_rgba(148,163,184,0.12)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-slate-950">{dict.dividends.ticker.upcoming.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{dict.dividends.ticker.upcoming.description}</p>
              </div>
              <Link href={openReviewHref} className="text-sm font-semibold text-sky-700 hover:text-sky-900" data-testid="ticker-dividends-open-filtered-ledger-top">
                {dict.dividends.ticker.filteredLedger}
              </Link>
            </div>
            {upcomingEvents.length === 0 ? (
              <div className="px-5 py-8 text-sm text-slate-500">{dict.dividends.ticker.upcoming.empty}</div>
            ) : (
              <div className="divide-y divide-slate-200">
                {upcomingEvents.map((item, index) => (
                  <article
                    key={`${item.accountId}-${item.ticker}-${item.paymentDate ?? item.exDividendDate ?? index}`}
                    className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,0.8fr))_auto]"
                    data-testid={`ticker-upcoming-dividend-${index}`}
                  >
                    <div className="min-w-0">
                      <p className="text-lg font-semibold text-slate-950">{item.ticker}{item.tickerName ? ` ${item.tickerName}` : ""}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.accountName ?? item.accountId}</p>
                    </div>
                    <KeyValueRow label={dict.dashboardHome.exDividendDateLabel} value={item.exDividendDate ? formatDateLabel(item.exDividendDate, locale) : "-"} />
                    <KeyValueRow label={dict.dashboardHome.paymentDateLabel} value={item.paymentDate ? formatDateLabel(item.paymentDate, locale) : dict.dividends.paymentDateTbdSection} />
                    <KeyValueRow label={dict.dashboardHome.expectedAmountLabel} value={item.expectedAmount !== null ? formatCurrencyAmount(item.expectedAmount, item.currency, locale) : "-"} />
                    <div className="flex items-center sm:justify-end">
                      <span className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]", statusClassName(item.status))}>
                        {resolveUpcomingStatusLabel(dict, item.status)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Card>

          <Card className="rounded-[28px] border border-slate-200 bg-white/94 p-0 shadow-[0_18px_36px_rgba(148,163,184,0.12)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-slate-950">{dict.dividends.ticker.postedHistory.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{dict.dividends.ticker.postedHistory.description}</p>
              </div>
              <Button asChild size="sm" variant="secondary">
                <Link href={openReviewHref} data-testid="ticker-dividends-filter-ledger">
                  {dict.dividends.ticker.filteredLedger}
                </Link>
              </Button>
            </div>
            {postedHistory.length === 0 ? (
              <div className="px-5 py-8 text-sm text-slate-500">{dict.dividends.ticker.postedHistory.empty}</div>
            ) : (
              <div className="divide-y divide-slate-200">
                {postedHistory.map((item, index) => {
                  const canMarkMatched = item.reconciliationStatus === "open" && item.dividendLedgerEntryId;
                  return (
                    <article
                      key={`${item.dividendLedgerEntryId ?? item.postedAt}-${index}`}
                      className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-start md:justify-between"
                      data-testid={`ticker-posted-dividend-${index}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xl font-semibold text-slate-950">
                          {item.ticker}{item.tickerName ? ` ${item.tickerName}` : ""} · {formatDateLabel(item.postedAt, locale)}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {item.sourceSummary
                            ? item.sourceSummary
                            : dict.dividends.ticker.postedHistory.entryFallback.replace("{ticker}", item.tickerName ? `${item.ticker} ${item.tickerName}` : item.ticker)}
                        </p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-4">
                          <KeyValueRow label={dict.dashboardHome.netAmountLabel} value={formatCurrencyAmount(item.netAmount, item.currency, locale)} />
                          <KeyValueRow label={dict.dashboardHome.grossAmountLabel} value={item.grossAmount !== null ? formatCurrencyAmount(item.grossAmount, item.currency, locale) : "-"} />
                          <KeyValueRow label={dict.dashboardHome.deductionAmountLabel} value={item.deductionAmount !== null ? formatCurrencyAmount(item.deductionAmount, item.currency, locale) : "-"} />
                          <KeyValueRow label={dict.dividends.ticker.postedHistory.accountLabel} value={item.accountName ?? item.accountId} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <span className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]", statusClassName(item.reconciliationStatus ?? "open"))}>
                          {resolveRecentStatusLabel(dict, item.reconciliationStatus)}
                        </span>
                        {canMarkMatched ? (
                          <Button
                            size="sm"
                            onClick={() => onMarkMatched(item.dividendLedgerEntryId!)}
                            disabled={pendingLedgerEntryId === item.dividendLedgerEntryId}
                            data-testid={`ticker-dividends-mark-matched-${item.dividendLedgerEntryId}`}
                          >
                            {dict.dividends.action.markMatched}
                          </Button>
                        ) : null}
                        <Button asChild size="sm" variant="secondary">
                          <Link href={openReviewHref} data-testid={`ticker-posted-dividend-review-${index}`}>
                            {dict.dividends.ticker.openRowReview}
                          </Link>
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <Card className="rounded-[28px] border border-slate-200 bg-white/94 p-0 shadow-[0_18px_36px_rgba(148,163,184,0.12)]">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-2xl font-semibold text-slate-950">{dict.dividends.ticker.reconciliation.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{dict.dividends.ticker.reconciliation.description.replace("{ticker}", tickerLabel)}</p>
          </div>
          <div className="divide-y divide-slate-200">
            {openRows.length === 0 ? (
              <div className="px-5 py-8 text-sm text-slate-500">{dict.dividends.ticker.reconciliation.empty}</div>
            ) : (
              openRows.map((item, index) => (
                <article key={`${item.dividendLedgerEntryId}-${index}`} className="px-5 py-4" data-testid={`ticker-open-reconciliation-${index}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold text-slate-950">{dict.dividends.ticker.reconciliation.openReceipt}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {dict.dividends.ticker.reconciliation.openReceiptDetail.replace("{entryId}", item.dividendLedgerEntryId ?? "-")}
                      </p>
                    </div>
                    <span className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]", statusClassName("open"))}>
                      {dict.dividends.form.reconciliation.statusOpen}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.dividendLedgerEntryId ? (
                      <Button
                        size="sm"
                        onClick={() => onMarkMatched(item.dividendLedgerEntryId!)}
                        disabled={pendingLedgerEntryId === item.dividendLedgerEntryId}
                        data-testid={`ticker-reconciliation-mark-matched-${item.dividendLedgerEntryId}`}
                      >
                        {dict.dividends.action.markMatched}
                      </Button>
                    ) : null}
                    <Button asChild size="sm" variant="secondary">
                      <Link href={openReviewHref} data-testid={`ticker-open-reconciliation-review-${index}`}>
                        {dict.dividends.ticker.openRowReview}
                      </Link>
                    </Button>
                  </div>
                </article>
              ))
            )}
            <article className="px-5 py-4">
              <p className="text-lg font-semibold text-slate-950">{dict.dividends.ticker.reconciliation.marketContextTitle}</p>
              <p className="mt-1 text-sm text-slate-600">
                {dict.dividends.ticker.reconciliation.marketContextDetail.replace("{marketCode}", marketCode)}
              </p>
              <div className="mt-4">
                <Link href={openReviewHref} className="text-sm font-semibold text-sky-700 hover:text-sky-900" data-testid="ticker-dividends-open-filtered-ledger-bottom">
                  {dict.dividends.ticker.filteredLedger}
                </Link>
              </div>
            </article>
          </div>
        </Card>
      </div>
    </div>
  );
}
