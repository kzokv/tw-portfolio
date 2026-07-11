"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DividendLedgerHistoryItemDto,
  DividendLedgerHistoryPageDto,
  DividendReviewPageLimit,
  DividendUpcomingListItemDto,
  DividendUpcomingPageDto,
  LocaleCode,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { fetchDividendLedgerEntry } from "../../features/dividends/services/dividendService";
import {
  fetchTickerOpenReconciliation,
  fetchTickerPostedDividendHistory,
  fetchTickerUpcomingDividends,
} from "../../features/dividends/services/tickerDividendService";
import type { DividendLedgerEntryDetails } from "../../features/dividends/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { DividendReviewDrawer } from "./DividendReviewDrawer";

interface TickerDividendsTabProps {
  dict: AppDictionary;
  locale: LocaleCode;
  marketCode: string;
  ticker: string;
  tickerName: string | null;
  accountId?: string;
  accountIds?: string[];
  dividends: {
    upcomingCount: number;
    nextPaymentDate: string | null;
    lastPostedDate: string | null;
    openReconciliationCount: number;
  };
  onMarkMatched: (dividendLedgerEntryId: string) => Promise<void> | void;
  pendingLedgerEntryId: string | null;
  canWriteDividends: boolean;
}

interface SectionState<T> {
  data: T | null;
  isLoading: boolean;
  error: string;
}

const PAGE_SIZE_OPTIONS: readonly DividendReviewPageLimit[] = [10, 25, 50] as const;
const UPCOMING_LIMIT: DividendReviewPageLimit = 50;
const OPEN_LIMIT: DividendReviewPageLimit = 50;
const POSTED_PAGE_KEY = "tickerDividendPostedPage";
const POSTED_LIMIT_KEY = "tickerDividendPostedLimit";

function normalizePage(value: string | null): number {
  const page = Number.parseInt(value ?? "", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function normalizeLimit(value: string | null): DividendReviewPageLimit {
  if (value === "25") return 25;
  if (value === "50") return 50;
  return 10;
}

function buildDividendReviewHref(
  ticker: string,
  marketCode: string,
  accountId?: string,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams({ view: "ledger", ticker, marketCode });
  if (accountId) params.set("accountId", accountId);
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  return `/dividends?${params.toString()}`;
}

function reviewYearBounds(date: string | null | undefined): Record<string, string> | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return undefined;
  const year = date.slice(0, 4);
  return { fromPaymentDate: `${year}-01-01`, toPaymentDate: `${year}-12-31` };
}

function resolveUpcomingStatusLabel(dict: AppDictionary, status: DividendUpcomingListItemDto["status"]): string {
  if (status === "expected") return dict.dashboardHome.statusExpected;
  if (status === "paying-soon") return dict.dashboardHome.statusPayingSoon;
  return dict.dashboardHome.statusDeclared;
}

function resolveReconciliationStatusLabel(
  dict: AppDictionary,
  status: DividendLedgerHistoryItemDto["reconciliationStatus"],
): string {
  if (status === "matched") return dict.dividends.form.reconciliation.statusMatched;
  if (status === "explained") return dict.dividends.form.reconciliation.statusExplained;
  if (status === "resolved") return dict.dividends.form.reconciliation.statusResolved;
  return dict.dividends.form.reconciliation.statusOpen;
}

function statusClassName(status: DividendUpcomingListItemDto["status"] | DividendLedgerHistoryItemDto["reconciliationStatus"]) {
  switch (status) {
    case "expected": return "border-sky-200 bg-sky-50 text-sky-700";
    case "paying-soon": return "border-slate-200 bg-slate-100 text-slate-700";
    case "matched": return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "explained": return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "resolved": return "border-teal-200 bg-teal-50 text-teal-700";
    case "open": return "border-rose-200 bg-rose-50 text-rose-700";
    default: return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function SummaryCard({ eyebrow, value, detail, badge, testId }: {
  eyebrow: string;
  value: string;
  detail: string;
  badge?: string;
  testId: string;
}) {
  return (
    <Card className="rounded-lg border border-slate-200 bg-white/94 p-5 shadow-sm" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
        {badge ? <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{badge}</span> : null}
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

function SectionMessage({ message, testId }: { message: string; testId: string }) {
  return <div className="px-5 py-8 text-sm text-slate-500" data-testid={testId}>{message}</div>;
}

export function TickerDividendsTab({
  dict,
  locale,
  marketCode,
  ticker,
  tickerName,
  accountId,
  accountIds,
  dividends,
  onMarkMatched,
  pendingLedgerEntryId,
  canWriteDividends,
}: TickerDividendsTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamKey = searchParams?.toString() ?? "";
  const initialParams = useMemo(() => new URLSearchParams(searchParamKey), [searchParamKey]);
  const [postedPage, setPostedPage] = useState(() => normalizePage(initialParams.get(POSTED_PAGE_KEY)));
  const [postedLimit, setPostedLimit] = useState<DividendReviewPageLimit>(() => normalizeLimit(initialParams.get(POSTED_LIMIT_KEY)));
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [upcoming, setUpcoming] = useState<SectionState<DividendUpcomingPageDto>>({ data: null, isLoading: true, error: "" });
  const [openReconciliation, setOpenReconciliation] = useState<SectionState<DividendLedgerHistoryPageDto>>({ data: null, isLoading: true, error: "" });
  const [posted, setPosted] = useState<SectionState<DividendLedgerHistoryPageDto>>({ data: null, isLoading: true, error: "" });
  const [drawerEntry, setDrawerEntry] = useState<DividendLedgerEntryDetails | null>(null);
  const [drawerLoadingId, setDrawerLoadingId] = useState<string | null>(null);
  const [drawerError, setDrawerError] = useState("");
  const drawerRequestRef = useRef(0);
  const scopeKey = accountIds?.join(",") ?? "";
  const queryScope = useMemo(() => ({
    accountId,
    accountIds,
    marketCode,
  }), [accountId, accountIds, marketCode]);

  useEffect(() => {
    const params = new URLSearchParams(searchParamKey);
    const nextPage = normalizePage(params.get(POSTED_PAGE_KEY));
    const nextLimit = normalizeLimit(params.get(POSTED_LIMIT_KEY));
    setPostedPage(nextPage);
    setPostedLimit(nextLimit);
  }, [searchParamKey]);

  useEffect(() => {
    const controller = new AbortController();
    setUpcoming((current) => ({ ...current, isLoading: current.data === null, error: "" }));
    void fetchTickerUpcomingDividends(ticker, { ...queryScope, page: 1, limit: UPCOMING_LIMIT }, { signal: controller.signal })
      .then((data) => setUpcoming({ data, isLoading: false, error: "" }))
      .catch((error: unknown) => {
        if ((error as { name?: string } | null)?.name === "AbortError") return;
        setUpcoming((current) => ({ ...current, isLoading: false, error: error instanceof Error ? error.message : String(error) }));
      });
    return () => controller.abort();
  }, [accountId, marketCode, refreshVersion, scopeKey, ticker]);

  useEffect(() => {
    const controller = new AbortController();
    setOpenReconciliation((current) => ({ ...current, isLoading: current.data === null, error: "" }));
    void fetchTickerOpenReconciliation(ticker, { ...queryScope, page: 1, limit: OPEN_LIMIT }, { signal: controller.signal })
      .then((data) => setOpenReconciliation({ data, isLoading: false, error: "" }))
      .catch((error: unknown) => {
        if ((error as { name?: string } | null)?.name === "AbortError") return;
        setOpenReconciliation((current) => ({ ...current, isLoading: false, error: error instanceof Error ? error.message : String(error) }));
      });
    return () => controller.abort();
  }, [accountId, marketCode, refreshVersion, scopeKey, ticker]);

  useEffect(() => {
    const controller = new AbortController();
    setPosted((current) => ({ ...current, isLoading: current.data === null, error: "" }));
    void fetchTickerPostedDividendHistory(ticker, { ...queryScope, page: postedPage, limit: postedLimit }, { signal: controller.signal })
      .then((data) => setPosted({ data, isLoading: false, error: "" }))
      .catch((error: unknown) => {
        if ((error as { name?: string } | null)?.name === "AbortError") return;
        setPosted((current) => ({ ...current, isLoading: false, error: error instanceof Error ? error.message : String(error) }));
      });
    return () => controller.abort();
  }, [accountId, marketCode, postedLimit, postedPage, refreshVersion, scopeKey, ticker]);

  function updatePostedRoute(page: number, limit: DividendReviewPageLimit) {
    setPostedPage(page);
    setPostedLimit(limit);
    const next = new URLSearchParams(searchParamKey);
    next.set(POSTED_PAGE_KEY, String(page));
    next.set(POSTED_LIMIT_KEY, String(limit));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function refreshSections() {
    setRefreshVersion((version) => version + 1);
  }

  async function openDrawer(
    item: DividendLedgerHistoryItemDto,
  ) {
    const requestId = drawerRequestRef.current + 1;
    drawerRequestRef.current = requestId;
    setDrawerLoadingId(item.dividendLedgerEntryId);
    setDrawerError("");
    try {
      const entry = await fetchDividendLedgerEntry(item.dividendLedgerEntryId);
      if (drawerRequestRef.current === requestId) setDrawerEntry(entry);
    } catch (error: unknown) {
      if (drawerRequestRef.current === requestId) setDrawerError(error instanceof Error ? error.message : String(error));
    } finally {
      if (drawerRequestRef.current === requestId) setDrawerLoadingId(null);
    }
  }

  function closeDrawer() {
    drawerRequestRef.current += 1;
    setDrawerEntry(null);
    setDrawerLoadingId(null);
    setDrawerError("");
  }

  const upcomingRows = upcoming.data?.items ?? [];
  const openRows = openReconciliation.data?.items ?? [];
  const postedRows = posted.data?.items ?? [];
  const upcomingCount = upcoming.data?.total ?? dividends.upcomingCount;
  const openCount = openReconciliation.data?.total ?? dividends.openReconciliationCount;
  const nextPaymentDate = upcoming.data
    ? upcomingRows.find((row) => row.paymentDate)?.paymentDate ?? null
    : dividends.nextPaymentDate;
  const lastPosted = postedRows[0] ?? null;
  const lastPostedDate = posted.data ? lastPosted?.postedAt ?? null : dividends.lastPostedDate;
  const hasUpcomingRows = upcomingCount > 0;
  const resolvedTickerName = tickerName
    ?? upcomingRows.find((row) => row.tickerName?.trim())?.tickerName?.trim()
    ?? postedRows.find((row) => row.tickerName?.trim())?.tickerName?.trim()
    ?? null;
  const tickerLabel = resolvedTickerName ? `${ticker} ${resolvedTickerName}` : ticker;
  const totalPostedPages = Math.max(1, Math.ceil((posted.data?.total ?? 0) / postedLimit));
  const openReviewHref = buildDividendReviewHref(ticker, marketCode, accountId);
  const loadError = dict.tickerHistory.loadError.replace("{ticker}", tickerLabel);

  return (
    <div className="grid gap-6" data-testid="ticker-detail-dividends">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-sky-600/80">{dict.dividends.ticker.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">{dict.tickerHistory.dividendsTabLabel}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{dict.dividends.ticker.description.replace("{ticker}", tickerLabel)}</p>
        </div>
        <Button asChild className="min-w-[220px]">
          <Link href={openReviewHref} data-testid="ticker-dividends-open-review">
            {dict.dividends.ticker.openReview}
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard eyebrow={dict.dividends.ticker.summary.upcoming} value={formatNumber(upcomingCount, locale)} detail={nextPaymentDate ? dict.dividends.ticker.summary.upcomingDetail.replace("{date}", formatDateLabel(nextPaymentDate, locale)) : hasUpcomingRows ? dict.dividends.paymentDateTbdSection : dict.dividends.ticker.summary.noUpcoming} badge={upcomingCount > 0 ? String(upcomingCount) : undefined} testId="ticker-dividends-summary-upcoming" />
        <SummaryCard eyebrow={dict.dividends.ticker.summary.lastPosted} value={lastPosted ? formatCurrencyAmount(lastPosted.actualNetAmount, lastPosted.cashDividendCurrency, locale) : dict.tickerHistory.noHoldingData} detail={lastPosted ? dict.dividends.ticker.summary.lastPostedDetail.replace("{account}", lastPosted.accountName ?? lastPosted.accountId) : dict.dividends.ticker.summary.noPosted} badge={lastPostedDate ? formatDateLabel(lastPostedDate, locale) : undefined} testId="ticker-dividends-summary-last-posted" />
        <SummaryCard eyebrow={dict.dividends.ticker.summary.openReconciliation} value={formatNumber(openCount, locale)} detail={openCount > 0 ? dict.dividends.ticker.summary.openReconciliationDetail : dict.dividends.ticker.summary.noOpenReconciliation} badge={openCount > 0 ? String(openCount) : undefined} testId="ticker-dividends-summary-open-reconciliation" />
        <SummaryCard eyebrow={dict.dividends.ticker.summary.nextPayment} value={nextPaymentDate ? formatDateLabel(nextPaymentDate, locale) : hasUpcomingRows ? dict.dividends.paymentDateTbdSection : dict.tickerHistory.noHoldingData} detail={nextPaymentDate ? dict.dividends.ticker.summary.nextPaymentDetail : hasUpcomingRows ? dict.dividends.paymentDateTbdSection : dict.dividends.ticker.summary.noUpcoming} testId="ticker-dividends-summary-next-payment" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.75fr)_minmax(320px,0.8fr)]">
        <div className="grid gap-6">
          <Card className="rounded-lg border border-slate-200 bg-white/94 p-0 shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4"><h3 className="text-2xl font-semibold text-slate-950">{dict.dividends.ticker.upcoming.title}</h3><p className="mt-1 text-sm text-slate-600">{dict.dividends.ticker.upcoming.description}</p></div>
            {upcoming.isLoading && !upcoming.data ? <SectionMessage message={dict.tickerHistory.refreshingDetails} testId="ticker-upcoming-loading" />
              : upcoming.error && !upcoming.data ? <SectionMessage message={loadError} testId="ticker-upcoming-error" />
                : upcomingRows.length === 0 ? <SectionMessage message={dict.dividends.ticker.upcoming.empty} testId="ticker-upcoming-empty" />
                  : <div className="divide-y divide-slate-200">{upcomingRows.map((item, index) => (
                    <article key={item.id} className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,0.8fr))_auto]" data-testid={`ticker-upcoming-dividend-${index}`}>
                      <div><p className="text-lg font-semibold text-slate-950">{item.ticker}{item.tickerName ? ` ${item.tickerName}` : ""}</p><p className="mt-1 text-sm text-slate-500">{item.accountName ?? item.accountId}</p></div>
                      <KeyValueRow label={dict.dashboardHome.exDividendDateLabel} value={formatDateLabel(item.exDividendDate, locale)} />
                      <KeyValueRow label={dict.dashboardHome.paymentDateLabel} value={item.paymentDate ? formatDateLabel(item.paymentDate, locale) : dict.dividends.paymentDateTbdSection} />
                      <KeyValueRow label={dict.dashboardHome.expectedAmountLabel} value={formatCurrencyAmount(item.expectedCashAmount, item.cashDividendCurrency, locale)} />
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end"><span className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-semibold", statusClassName(item.status))}>{resolveUpcomingStatusLabel(dict, item.status)}</span><Link href={buildDividendReviewHref(ticker, marketCode, accountId, reviewYearBounds(item.paymentDate ?? item.exDividendDate))} className="text-sm font-semibold text-sky-700" data-testid={`ticker-upcoming-dividend-review-${index}`}>{dict.dividends.ticker.openRowReview}</Link></div>
                    </article>
                  ))}</div>}
          </Card>

          <Card className="rounded-lg border border-slate-200 bg-white/94 p-0 shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4"><h3 className="text-2xl font-semibold text-slate-950">{dict.dividends.ticker.postedHistory.title}</h3><p className="mt-1 text-sm text-slate-600">{dict.dividends.ticker.postedHistory.description}</p></div>
            {posted.isLoading && !posted.data ? <SectionMessage message={dict.tickerHistory.refreshingDetails} testId="ticker-posted-loading" />
              : posted.error && !posted.data ? <SectionMessage message={loadError} testId="ticker-posted-error" />
                : postedRows.length === 0 ? <SectionMessage message={dict.dividends.ticker.postedHistory.empty} testId="ticker-posted-empty" />
                  : <div className="divide-y divide-slate-200">{postedRows.map((item, index) => (
                    <article key={item.dividendLedgerEntryId} className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-start md:justify-between" data-testid={`ticker-posted-dividend-${index}`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-xl font-semibold text-slate-950" data-testid={`ticker-posted-title-${index}`}>{item.ticker}{item.tickerName ? ` ${item.tickerName}` : ""} {item.paymentDate ? formatDateLabel(item.paymentDate, locale) : dict.dividends.paymentDateTbdSection}</p>
                        <dl className="mt-3 grid gap-3 sm:grid-cols-4 xl:grid-cols-6">
                          <KeyValueRow label={dict.dashboardHome.exDividendDateLabel} value={formatDateLabel(item.exDividendDate, locale)} />
                          <KeyValueRow label={dict.dashboardHome.paymentDateLabel} value={item.paymentDate ? formatDateLabel(item.paymentDate, locale) : dict.dividends.paymentDateTbdSection} />
                          <KeyValueRow label={dict.dividends.overview.postedLabel} value={formatDateLabel(item.postedAt, locale)} />
                          <KeyValueRow label={dict.dashboardHome.grossAmountLabel} value={formatCurrencyAmount(item.expectedCashAmount, item.cashDividendCurrency, locale)} />
                          <KeyValueRow label={dict.dividends.review.table.nhi} value={formatCurrencyAmount(item.deductions.nhiAmount, item.cashDividendCurrency, locale)} />
                          <KeyValueRow label={dict.dividends.review.table.bankFee} value={formatCurrencyAmount(item.deductions.bankFeeAmount, item.cashDividendCurrency, locale)} />
                          <KeyValueRow label={dict.dividends.review.table.otherDeduction} value={formatCurrencyAmount(item.deductions.otherDeductionAmount, item.cashDividendCurrency, locale)} />
                          <KeyValueRow label={dict.dashboardHome.netAmountLabel} value={formatCurrencyAmount(item.actualNetAmount, item.cashDividendCurrency, locale)} />
                          <KeyValueRow label={dict.dividends.review.drawer.receivedStock} value={formatNumber(item.receivedStockQuantity, locale)} />
                          <KeyValueRow label={dict.dividends.ticker.postedHistory.accountLabel} value={item.accountName ?? item.accountId} />
                          <KeyValueRow label={dict.dividends.form.reconciliation.title} value={resolveReconciliationStatusLabel(dict, item.reconciliationStatus)} />
                        </dl>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-semibold", statusClassName(item.reconciliationStatus))}>{resolveReconciliationStatusLabel(dict, item.reconciliationStatus)}</span>
                        <Button size="sm" variant="secondary" onClick={() => void openDrawer(item)} disabled={drawerLoadingId === item.dividendLedgerEntryId} data-testid={`ticker-posted-dividend-review-${index}`}>{dict.dividends.ticker.openRowReview}</Button>
                      </div>
                    </article>
                  ))}</div>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
              <label className="flex items-center gap-2 text-sm text-slate-600"><span>{dict.dividends.review.pagination.pageSize}</span><select className="rounded-md border border-slate-200 bg-white px-2 py-1" value={String(postedLimit)} onChange={(event) => updatePostedRoute(1, normalizeLimit(event.target.value))} data-testid="ticker-posted-page-size">{PAGE_SIZE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <div className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={postedPage <= 1} onClick={() => updatePostedRoute(postedPage - 1, postedLimit)}>{dict.dividends.review.pagination.previous}</Button><span className="text-sm text-slate-600">{dict.dividends.review.pagination.page} {postedPage} {dict.dividends.review.pagination.of} {totalPostedPages}{dict.dividends.review.pagination.totalSuffix}</span><Button size="sm" variant="secondary" disabled={postedPage >= totalPostedPages} onClick={() => updatePostedRoute(postedPage + 1, postedLimit)}>{dict.dividends.review.pagination.next}</Button></div>
            </div>
          </Card>
        </div>

        <Card className="rounded-lg border border-slate-200 bg-white/94 p-0 shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4"><h3 className="text-2xl font-semibold text-slate-950">{dict.dividends.ticker.reconciliation.title}</h3><p className="mt-1 text-sm text-slate-600">{dict.dividends.ticker.reconciliation.description.replace("{ticker}", tickerLabel)}</p></div>
          {openReconciliation.isLoading && !openReconciliation.data ? <SectionMessage message={dict.tickerHistory.refreshingDetails} testId="ticker-open-loading" />
            : openReconciliation.error && !openReconciliation.data ? <SectionMessage message={loadError} testId="ticker-open-error" />
              : openRows.length === 0 ? <SectionMessage message={dict.dividends.ticker.reconciliation.empty} testId="ticker-open-empty" />
                : <div className="divide-y divide-slate-200">{openRows.map((item, index) => (
                  <article key={item.dividendLedgerEntryId} className="px-5 py-4" data-testid={`ticker-open-reconciliation-${index}`}>
                    <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-semibold text-slate-950">{item.ticker}{item.tickerName ? ` ${item.tickerName}` : ""}</p><p className="mt-1 text-sm text-slate-600">{dict.dividends.ticker.reconciliation.openReceiptDetail.replace("{entryId}", item.dividendLedgerEntryId)}</p></div><span className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-semibold", statusClassName("open"))}>{dict.dividends.form.reconciliation.statusOpen}</span></div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {canWriteDividends ? <Button size="sm" onClick={async () => { await onMarkMatched(item.dividendLedgerEntryId); refreshSections(); }} disabled={pendingLedgerEntryId === item.dividendLedgerEntryId} data-testid={`ticker-reconciliation-mark-matched-${item.dividendLedgerEntryId}`}>{dict.dividends.action.markMatched}</Button> : null}
                      <Button size="sm" variant="secondary" onClick={() => void openDrawer(item)} disabled={drawerLoadingId === item.dividendLedgerEntryId} data-testid={`ticker-open-reconciliation-review-${index}`}>{dict.dividends.ticker.openRowReview}</Button>
                    </div>
                  </article>
                ))}</div>}
          {drawerError ? <p className="border-t border-rose-200 px-5 py-3 text-sm text-rose-700" role="alert">{drawerError}</p> : null}
        </Card>
      </div>

      <DividendReviewDrawer dict={dict} locale={locale} entry={drawerEntry} onClose={closeDrawer} onSaved={refreshSections} allowMutations={canWriteDividends} readOnlyMessage={dict.tickerHistory.noWritePermission} />
    </div>
  );
}
