"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  DividendReviewRowDetailDto,
  DividendReviewRowSummaryDto,
  LocaleCode,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatNumber } from "../../lib/utils";
import type { DividendCalendarRow, DividendLedgerEntryDetails } from "../../features/dividends/types";
import { Card } from "../ui/Card";
import { Drawer } from "../ui/Drawer";
import { DividendPostingForm } from "./DividendPostingForm";
import { fetchDividendLedgerEntry } from "../../features/dividends/services/dividendService";

const drawerDetailCache = new Map<string, DividendReviewRowDetailDto>();

function drawerDetailCacheKey(cacheScope: string, entry: Pick<DividendReviewRowSummaryDto, "id" | "version">): string {
  return `${cacheScope}:${entry.id}:${entry.version}`;
}

export function clearDividendReviewDrawerDetailCache(): void {
  drawerDetailCache.clear();
}

export function primeDividendReviewDrawerDetailCache(
  cacheScope: string,
  detail: DividendReviewRowDetailDto,
): void {
  drawerDetailCache.set(drawerDetailCacheKey(cacheScope, detail), detail);
}

function sumDeductions(
  entry: DividendLedgerEntryDetails,
  predicate: (deduction: DividendLedgerEntryDetails["deductions"][number]) => boolean,
): number {
  return entry.deductions
    .filter(predicate)
    .reduce((sum, deduction) => sum + deduction.amount, 0);
}

function cashInLieuAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.cashInLieuAmount != null) return entry.cashInLieuAmount;
  return entry.deductions
    .filter((deduction) => deduction.deductionType === "CASH_IN_LIEU_ADJUSTMENT")
    .reduce((sum, deduction) => sum + deduction.amount, 0);
}

function nhiAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.nhiAmount != null) return entry.nhiAmount;
  return sumDeductions(entry, (deduction) => deduction.deductionType === "NHI_SUPPLEMENTAL_PREMIUM");
}

function bankFeeAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.bankFeeAmount != null) return entry.bankFeeAmount;
  return sumDeductions(entry, (deduction) => deduction.deductionType === "BANK_FEE");
}

function otherDeductionAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.otherDeductionAmount != null) return entry.otherDeductionAmount;
  return sumDeductions(entry, (deduction) => (
    deduction.deductionType !== "NHI_SUPPLEMENTAL_PREMIUM"
    && deduction.deductionType !== "BANK_FEE"
  ));
}

function expectedGrossAmount(entry: DividendLedgerEntryDetails): number {
  return entry.expectedGrossAmount ?? entry.expectedCashAmount;
}

function expectedNetAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.expectedNetAmount != null) return entry.expectedNetAmount;
  return expectedGrossAmount(entry) - nhiAmount(entry) - bankFeeAmount(entry) - otherDeductionAmount(entry);
}

function actualNetAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.actualNetAmount != null) return entry.actualNetAmount;
  return entry.receivedCashAmount;
}

function premiumBaseAmount(entry: DividendLedgerEntryDetails): number | null {
  if (entry.nhiPremiumBaseAmount != null) return entry.nhiPremiumBaseAmount;
  if (entry.parValueBaseAmount != null && entry.premiumBaseAmount != null) {
    return entry.parValueBaseAmount + entry.premiumBaseAmount;
  }
  return entry.parValueBaseAmount ?? null;
}

function snapshotRefreshLabel(dict: AppDictionary, status: DividendLedgerEntryDetails["snapshotRefreshStatus"]): string {
  switch (status) {
    case "queued":
      return dict.dividends.review.drawer.snapshotQueued;
    case "running":
      return dict.dividends.review.drawer.snapshotRunning;
    case "complete":
      return dict.dividends.review.drawer.snapshotComplete;
    case "failed":
      return dict.dividends.review.drawer.snapshotFailed;
    default:
      return dict.dividends.review.drawer.snapshotIdle;
  }
}

function linkedPositionActionStatusLabel(dict: AppDictionary, status: DividendLedgerEntryDetails["linkedPositionActionStatus"]): string {
  switch (status) {
    case "posted":
      return dict.dividends.review.drawer.positionActionPosted;
    case null:
    case undefined:
      return "—";
    default:
      return status;
  }
}

export function buildDividendCalendarRowFromEntry(entry: DividendLedgerEntryDetails): DividendCalendarRow {
  const isLedgerRow = entry.rowKind !== "expected" && entry.postingStatus !== "expected";
  return {
    key: `${entry.accountId}:${entry.dividendEventId}`,
    event: {
      id: entry.dividendEventId,
      accountId: entry.accountId,
      accountName: entry.accountName,
      ticker: entry.ticker,
      tickerName: entry.tickerName,
      marketCode: entry.marketCode,
      instrumentType: entry.instrumentType,
      eventType: entry.eventType,
      exDividendDate: entry.exDividendDate,
      paymentDate: entry.paymentDate,
      cashDividendCurrency: entry.cashCurrency,
      expectedCashAmount: entry.expectedCashAmount,
      expectedStockQuantity: entry.expectedStockQuantity,
      stockDistributionRatio: entry.stockDistributionRatio ?? null,
      stockDistributionRatioState: entry.stockDistributionRatioState ?? "unresolved",
      eligibleQuantity: entry.eligibleQuantity,
      parValuePerShare: entry.expectedStockParValueAmount ?? entry.parValueAmount ?? null,
      hasPostedLedgerEntry: isLedgerRow,
      dividendLedgerEntryId: isLedgerRow ? entry.id : null,
    },
    ledgerEntry: isLedgerRow ? entry : null,
  };
}

interface DividendReviewDrawerProps {
  dict: AppDictionary;
  locale: LocaleCode;
  entry: DividendReviewRowSummaryDto | null;
  cacheScope: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  resolveAccountName?: (accountId: string) => string;
  allowMutations?: boolean;
  readOnlyMessage?: string;
}

export function DividendReviewDrawer({
  dict,
  locale,
  entry,
  cacheScope,
  onClose,
  onSaved,
  resolveAccountName,
  allowMutations = true,
  readOnlyMessage,
}: DividendReviewDrawerProps) {
  const [isDirty, setIsDirty] = useState(false);
  const [fetchedDetail, setDetail] = useState<DividendLedgerEntryDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const detail = useMemo<DividendLedgerEntryDetails | null>(() => {
    if (entry?.rowKind === "expected") return { ...entry, deductions: [], sourceLines: [] };
    return fetchedDetail;
  }, [entry, fetchedDetail]);
  const drawerRow = useMemo(() => (detail ? buildDividendCalendarRowFromEntry(detail) : null), [detail]);
  const isPostedLedgerEntry = detail != null
    && detail.rowKind !== "expected"
    && detail.postingStatus !== "expected";

  useEffect(() => {
    setIsDirty(false);
    setError("");
    if (!entry) {
      setDetail(null);
      setIsLoading(false);
      return;
    }
    if (entry.rowKind === "expected") {
      setDetail({ ...entry, deductions: [], sourceLines: [] });
      setIsLoading(false);
      return;
    }

    const cacheKey = drawerDetailCacheKey(cacheScope, entry);
    const cached = drawerDetailCache.get(cacheKey);
    if (cached) {
      setDetail(cached);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setDetail(null);
    setIsLoading(true);
    void fetchDividendLedgerEntry(entry.id, { signal: controller.signal })
      .then((next) => {
        if (controller.signal.aborted) return;
        drawerDetailCache.set(cacheKey, next);
        setDetail(next);
      })
      .catch((caught) => {
        if (controller.signal.aborted || caught instanceof Error && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [cacheScope, entry, retryVersion]);

  function closeWithConfirm() {
    if (isDirty && typeof window !== "undefined") {
      const confirmed = window.confirm(dict.dividends.form.unsavedChangesConfirm);
      if (!confirmed) return;
    }
    setIsDirty(false);
    onClose();
  }

  const title = entry
    ? `${entry.ticker}${entry.tickerName ? ` · ${entry.tickerName}` : ""} · ${entry.accountName ?? resolveAccountName?.(entry.accountId) ?? entry.accountId}`
    : dict.dividends.review.pageTitle;

  return (
    <Drawer
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) closeWithConfirm();
      }}
      title={title}
      dirty={isDirty}
      dirtyConfirmMessage={dict.dividends.form.unsavedChangesConfirm}
    >
      {entry && isLoading ? (
        <div className="grid gap-3" aria-busy="true" data-testid="review-drawer-loading">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-muted/50" />)}
        </div>
      ) : entry && error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4" role="alert" data-testid="review-drawer-error">
          <p className="text-sm text-rose-700">{dict.dividends.review.loading.drawerError}: {error}</p>
          <button type="button" className="mt-3 rounded-md border border-rose-300 px-3 py-1.5 text-sm text-rose-700" onClick={() => setRetryVersion((value) => value + 1)} data-testid="review-drawer-retry">
            {dict.dividends.review.loading.retry}
          </button>
        </div>
      ) : detail && drawerRow ? (
        <div className="grid gap-4">
          <Card className="rounded-lg border border-slate-200 bg-white p-4 shadow-none">
            <div className="grid gap-3 md:grid-cols-3">
              <DrawerMetric label={dict.dividends.review.table.expected} value={formatCurrencyAmount(expectedGrossAmount(detail), detail.cashCurrency, locale)} />
              <DrawerMetric label={dict.dividends.review.table.expectedNet} value={formatCurrencyAmount(expectedNetAmount(detail), detail.cashCurrency, locale)} />
              <DrawerMetric label={dict.dividends.review.table.actualNet} value={formatCurrencyAmount(actualNetAmount(detail), detail.cashCurrency, locale)} />
              <DrawerMetric label={dict.dividends.review.table.nhi} value={nhiAmount(detail) > 0 ? formatCurrencyAmount(nhiAmount(detail), detail.cashCurrency, locale) : "—"} />
              <DrawerMetric label={dict.dividends.review.table.bankFee} value={bankFeeAmount(detail) > 0 ? formatCurrencyAmount(bankFeeAmount(detail), detail.cashCurrency, locale) : "—"} />
              <DrawerMetric label={dict.dividends.review.table.otherDeduction} value={otherDeductionAmount(detail) > 0 ? formatCurrencyAmount(otherDeductionAmount(detail), detail.cashCurrency, locale) : "—"} />
            </div>
          </Card>
          <Card
            className="rounded-lg border border-sky-200 bg-sky-50 p-4 shadow-none"
            data-testid="dividend-removal-guidance"
          >
            <p className="font-semibold text-sky-950">{dict.dividends.review.drawer.removalGuidanceTitle}</p>
            <p className="mt-1 text-sm text-sky-900">
              {isPostedLedgerEntry
                ? dict.dividends.review.drawer.postedCorrectionGuidance
                : dict.dividends.review.drawer.expectedRemovalGuidance}
            </p>
            <Link
              href={`/tickers/${encodeURIComponent(detail.ticker)}?${new URLSearchParams({
                marketCode: detail.marketCode,
                accountId: detail.accountId,
                tab: "transactions",
              }).toString()}`}
              className="mt-3 inline-flex min-h-9 items-center rounded-md border border-sky-300 bg-white px-3 py-2 text-sm font-medium text-sky-900 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
            >
              {dict.dividends.review.drawer.openTickerTransactions}
            </Link>
          </Card>
          {(detail.receivedStockQuantity > 0 || cashInLieuAmount(detail) > 0) ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.95fr)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <DrawerMetric label={dict.dividends.review.drawer.eligibleShares} value={formatNumber(detail.eligibleQuantity, locale)} />
                <DrawerMetric label={dict.dividends.review.drawer.receivedShares} value={formatNumber(detail.receivedStockQuantity, locale)} />
                <DrawerMetric label={dict.dividends.review.drawer.portfolioCostAdded} value={formatCurrencyAmount(detail.portfolioCostBasisAddedAmount ?? 0, detail.cashCurrency, locale)} />
                <DrawerMetric label={dict.dividends.review.drawer.parValueBase} value={detail.parValueBaseAmount != null ? formatCurrencyAmount(detail.parValueBaseAmount, detail.cashCurrency, locale) : "—"} />
                <DrawerMetric label={dict.dividends.review.drawer.expectedStock} value={formatNumber(detail.expectedStockQuantity, locale)} />
                <DrawerMetric label={dict.dividends.review.drawer.receivedStock} value={formatNumber(detail.receivedStockQuantity, locale)} />
                <DrawerMetric label={dict.dividends.review.drawer.cashInLieu} value={cashInLieuAmount(detail) > 0 ? formatCurrencyAmount(cashInLieuAmount(detail), detail.cashCurrency, locale) : "—"} />
                <DrawerMetric label={dict.dividends.review.drawer.nhiPremiumBase} value={premiumBaseAmount(detail) != null ? formatCurrencyAmount(premiumBaseAmount(detail) ?? 0, detail.cashCurrency, locale) : "—"} />
              </div>
              <div className="grid gap-3">
                <div
                  className={cn(
                    "rounded-lg border px-4 py-3 text-sm",
                    detail.amendmentBlockedReason || detail.correctionMode === "reversal_replacement"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900",
                  )}
                >
                  <p className="font-semibold">{dict.dividends.review.drawer.correctionPathTitle}</p>
                  <p className="mt-1">
                    {detail.amendmentBlockedReason || detail.correctionMode === "reversal_replacement"
                      ? dict.dividends.review.drawer.correctionPathBlocked
                      : dict.dividends.review.drawer.correctionPathAmend}
                  </p>
                </div>
                <div className="overflow-hidden rounded-lg border border-border/70">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">{dict.dividends.review.drawer.linkedRecord}</th>
                        <th className="px-4 py-2 text-left font-medium">{dict.dividends.review.drawer.linkedRecordStatus}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border/70">
                        <td className="px-4 py-3">{detail.linkedPositionActionId ? `${dict.dividends.review.drawer.positionActionRecord} #${detail.linkedPositionActionId}` : dict.dividends.review.drawer.positionActionPending}</td>
                        <td className="px-4 py-3">{linkedPositionActionStatusLabel(dict, detail.linkedPositionActionStatus)}</td>
                      </tr>
                      <tr className="border-t border-border/70">
                        <td className="px-4 py-3">{dict.dividends.review.drawer.snapshotRefreshRecord}</td>
                        <td className="px-4 py-3">{snapshotRefreshLabel(dict, detail.snapshotRefreshStatus)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
          {allowMutations ? (
            <DividendPostingForm
              row={drawerRow}
              dict={dict}
              locale={locale}
              onDirtyChange={setIsDirty}
              onCancel={closeWithConfirm}
              onSaved={async () => {
                await onSaved();
                setIsDirty(false);
                onClose();
              }}
            />
          ) : (
            <Card className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-none">
              <p className="text-sm text-slate-700">{readOnlyMessage ?? "Read-only"}</p>
            </Card>
          )}
        </div>
      ) : null}
    </Drawer>
  );
}

function DrawerMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}
