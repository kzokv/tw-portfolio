"use client";

import { useMemo, useState } from "react";
import type { LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatNumber } from "../../lib/utils";
import type { DividendCalendarRow, DividendLedgerEntryDetails } from "../../features/dividends/types";
import { Card } from "../ui/Card";
import { Drawer } from "../ui/Drawer";
import { DividendPostingForm } from "./DividendPostingForm";

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
  entry: DividendLedgerEntryDetails | null;
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
  onClose,
  onSaved,
  resolveAccountName,
  allowMutations = true,
  readOnlyMessage,
}: DividendReviewDrawerProps) {
  const [isDirty, setIsDirty] = useState(false);
  const drawerRow = useMemo(() => (entry ? buildDividendCalendarRowFromEntry(entry) : null), [entry]);

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
      {entry && drawerRow ? (
        <div className="grid gap-4">
          <Card className="rounded-lg border border-slate-200 bg-white p-4 shadow-none">
            <div className="grid gap-3 md:grid-cols-3">
              <DrawerMetric label={dict.dividends.review.table.expected} value={formatCurrencyAmount(expectedGrossAmount(entry), entry.cashCurrency, locale)} />
              <DrawerMetric label={dict.dividends.review.table.expectedNet} value={formatCurrencyAmount(expectedNetAmount(entry), entry.cashCurrency, locale)} />
              <DrawerMetric label={dict.dividends.review.table.actualNet} value={formatCurrencyAmount(actualNetAmount(entry), entry.cashCurrency, locale)} />
              <DrawerMetric label={dict.dividends.review.table.nhi} value={nhiAmount(entry) > 0 ? formatCurrencyAmount(nhiAmount(entry), entry.cashCurrency, locale) : "—"} />
              <DrawerMetric label={dict.dividends.review.table.bankFee} value={bankFeeAmount(entry) > 0 ? formatCurrencyAmount(bankFeeAmount(entry), entry.cashCurrency, locale) : "—"} />
              <DrawerMetric label={dict.dividends.review.table.otherDeduction} value={otherDeductionAmount(entry) > 0 ? formatCurrencyAmount(otherDeductionAmount(entry), entry.cashCurrency, locale) : "—"} />
            </div>
          </Card>
          {(entry.receivedStockQuantity > 0 || cashInLieuAmount(entry) > 0) ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.95fr)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <DrawerMetric label={dict.dividends.review.drawer.eligibleShares} value={formatNumber(entry.eligibleQuantity, locale)} />
                <DrawerMetric label={dict.dividends.review.drawer.receivedShares} value={formatNumber(entry.receivedStockQuantity, locale)} />
                <DrawerMetric label={dict.dividends.review.drawer.portfolioCostAdded} value={formatCurrencyAmount(entry.portfolioCostBasisAddedAmount ?? 0, entry.cashCurrency, locale)} />
                <DrawerMetric label={dict.dividends.review.drawer.parValueBase} value={entry.parValueBaseAmount != null ? formatCurrencyAmount(entry.parValueBaseAmount, entry.cashCurrency, locale) : "—"} />
                <DrawerMetric label={dict.dividends.review.drawer.expectedStock} value={formatNumber(entry.expectedStockQuantity, locale)} />
                <DrawerMetric label={dict.dividends.review.drawer.receivedStock} value={formatNumber(entry.receivedStockQuantity, locale)} />
                <DrawerMetric label={dict.dividends.review.drawer.cashInLieu} value={cashInLieuAmount(entry) > 0 ? formatCurrencyAmount(cashInLieuAmount(entry), entry.cashCurrency, locale) : "—"} />
                <DrawerMetric label={dict.dividends.review.drawer.nhiPremiumBase} value={premiumBaseAmount(entry) != null ? formatCurrencyAmount(premiumBaseAmount(entry) ?? 0, entry.cashCurrency, locale) : "—"} />
              </div>
              <div className="grid gap-3">
                <div
                  className={cn(
                    "rounded-lg border px-4 py-3 text-sm",
                    entry.amendmentBlockedReason || entry.correctionMode === "reversal_replacement"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900",
                  )}
                >
                  <p className="font-semibold">{dict.dividends.review.drawer.correctionPathTitle}</p>
                  <p className="mt-1">
                    {entry.amendmentBlockedReason || entry.correctionMode === "reversal_replacement"
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
                        <td className="px-4 py-3">{entry.linkedPositionActionId ? `${dict.dividends.review.drawer.positionActionRecord} #${entry.linkedPositionActionId}` : dict.dividends.review.drawer.positionActionPending}</td>
                        <td className="px-4 py-3">{linkedPositionActionStatusLabel(dict, entry.linkedPositionActionStatus)}</td>
                      </tr>
                      <tr className="border-t border-border/70">
                        <td className="px-4 py-3">{dict.dividends.review.drawer.snapshotRefreshRecord}</td>
                        <td className="px-4 py-3">{snapshotRefreshLabel(dict, entry.snapshotRefreshStatus)}</td>
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
