"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount, formatNumber } from "../../lib/utils";
import type { LocaleCode } from "@vakwen/shared-types";
import { Button } from "../ui/Button";
import { fieldClassName } from "../ui/fieldStyles";
import { useDividendPosting } from "../../features/dividends/hooks/useDividendPosting";
import { updateDividendReconciliation } from "../../features/dividends/services/dividendService";
import type {
  DividendCalendarRow,
  DividendDeductionInput,
  DividendDeductionType,
  DividendPostingPayload,
  DividendReconciliationStatus,
  DividendSourceLineInput,
} from "../../features/dividends/types";
import { SourceCompositionTab } from "./SourceCompositionTab";
import type { DividendSourceBucket } from "@vakwen/shared-types";

interface DividendPostingFormProps {
  row: DividendCalendarRow;
  dict: AppDictionary;
  locale: LocaleCode;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
}

const DEDUCTION_TYPES: DividendDeductionType[] = [
  "WITHHOLDING_TAX",
  "NHI_SUPPLEMENTAL_PREMIUM",
  "BROKER_FEE",
  "BANK_FEE",
  "TRANSFER_FEE",
  "CASH_IN_LIEU_ADJUSTMENT",
  "ROUNDING_ADJUSTMENT",
  "OTHER",
];

const SOURCE_BUCKETS = [
  "DIVIDEND_INCOME",
  "INTEREST_INCOME",
  "SECURITIES_GAIN_INCOME",
  "REVENUE_EQUALIZATION",
  "CAPITAL_EQUALIZATION",
  "CAPITAL_RETURN",
  "OTHER",
] as const;

// Mirrors libs/domain/src/dividend-deductions.ts. Kept in sync manually to
// avoid adding a runtime dependency from the web app on @vakwen/domain.
const NHI_RATE = 0.0211;
const NHI_THRESHOLD_TWD = 20_000;
const DEFAULT_BANK_FEE_TWD = 10;

const NHI_SUBJECT_BUCKETS = new Set<DividendSourceBucket>([
  "DIVIDEND_INCOME",
  "INTEREST_INCOME",
]);

function eventAccountLabel(row: DividendCalendarRow): string {
  return row.event.accountName?.trim() || row.event.accountId;
}

function roundTwd(value: number): number {
  return Math.round(value + Number.EPSILON);
}

function authoritativeStockPremiumBase(row: DividendCalendarRow): number | null {
  if (row.event.expectedStockQuantity <= 0) return 0;
  const parValuePerShare = row.event.parValuePerShare;
  if (parValuePerShare == null || !Number.isFinite(parValuePerShare) || parValuePerShare <= 0) {
    return null;
  }
  return row.event.expectedStockQuantity * parValuePerShare;
}

function buildDefaultDeductions(row: DividendCalendarRow): DividendDeductionInput[] {
  const defaults: DividendDeductionInput[] = [];

  const isEtf = row.event.instrumentType === "ETF" || row.event.instrumentType === "BOND_ETF";
  const isTwd = row.event.cashDividendCurrency === "TWD";

  if (!isEtf && isTwd) {
    // Taiwan NHI supplemental premium (2.11% of single dividend receipts
    // NT$20,000 and above).
    //
    // The premium base sums BOTH legs of the distribution when the stock leg
    // has an authoritative par value. If that value is unknown, the form
    // does not guess and leaves NHI unprefilled.
    //
    //   - Cash leg: expectedCashAmount (eligibleQty × cashDividendPerShare)
    //   - Stock leg: expectedStockQuantity × authoritative par value
    //
    // This correctly handles all three event types:
    //   - CASH:           stock leg = 0, base = expectedCashAmount
    //   - STOCK:          cash leg = 0, base = stockQty × par value
    //   - CASH_AND_STOCK: both legs contribute (would otherwise understate)
    //
    // The row is still added when base < threshold (amount = 0) so the user
    // sees the prefill and can adjust manually.
    const cashPortionBase = row.event.expectedCashAmount;
    const stockPortionBase = authoritativeStockPremiumBase(row);
    if (stockPortionBase !== null) {
      const premiumBase = cashPortionBase + stockPortionBase;

      if (premiumBase > 0) {
        const aboveThreshold = premiumBase >= NHI_THRESHOLD_TWD;
        defaults.push({
          deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
          amount: aboveThreshold ? roundTwd(premiumBase * NHI_RATE) : 0,
          currencyCode: "TWD",
          withheldAtSource: true,
          source: "dividend_posting",
        });
      }
    }
  }

  if (isEtf && isTwd) {
    // ETF/BOND_ETF: NHI premium depends on source composition disclosure.
    // New postings start as "unknown_pending_disclosure" — push NHI at 0
    // as a placeholder. The reactive effect in the form component will
    // recompute the amount when the user enters source lines.
    defaults.push({
      deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
      amount: 0,
      currencyCode: "TWD",
      withheldAtSource: true,
      source: "dividend_posting",
    });
  }

  if (isTwd && row.event.expectedCashAmount > 0) {
    // Standard Taiwan bank wire fee for dividend receipts. Only applies when
    // actual cash is arriving — stock-only dividends skip this row.
    defaults.push({
      deductionType: "BANK_FEE",
      amount: DEFAULT_BANK_FEE_TWD,
      currencyCode: "TWD",
      withheldAtSource: true,
      source: "dividend_posting",
    });
  }

  return defaults;
}

function cashPerShareFromEvent(row: DividendCalendarRow): number | null {
  if (row.event.expectedCashAmount <= 0 || row.event.eligibleQuantity <= 0) return null;
  return row.event.expectedCashAmount / row.event.eligibleQuantity;
}

function createEmptyDeduction(): DividendDeductionInput {
  return {
    deductionType: "OTHER",
    amount: 0,
    currencyCode: "TWD",
    withheldAtSource: true,
    source: "dividend_posting",
  };
}

function createEmptySourceLine(): DividendSourceLineInput {
  return {
    sourceBucket: "DIVIDEND_INCOME",
    amount: 0,
    currencyCode: "TWD",
    source: "dividend_posting",
  };
}

function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

function formatRatio(value: number, locale: LocaleCode): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

function sumDeductions(
  deductions: DividendDeductionInput[],
  predicate: (deduction: DividendDeductionInput) => boolean,
): number {
  return deductions
    .filter(predicate)
    .reduce((sum, deduction) => sum + deduction.amount, 0);
}

export function DividendPostingForm({
  row,
  dict,
  locale,
  onDirtyChange,
  onCancel,
  onSaved,
}: DividendPostingFormProps) {
  const isEditMode = Boolean(row.ledgerEntry);
  const defaultDeductions = useMemo(
    () => (!isEditMode ? buildDefaultDeductions(row) : []),
    [isEditMode, row],
  );
  const cashPerShare = useMemo(() => cashPerShareFromEvent(row), [row]);
  const initialFormState = useMemo(() => ({
    receivedCashAmount: row.ledgerEntry?.receivedCashAmount ?? row.event.expectedCashAmount,
    receivedStockQuantity: row.ledgerEntry?.receivedStockQuantity ?? row.event.expectedStockQuantity,
    deductions: row.ledgerEntry?.deductions.map((entry) => ({ ...entry }))
      ?? defaultDeductions.map((entry) => ({ ...entry })),
    // New postings always start in "unknown_pending_disclosure" mode — users
    // who want to break down the source composition opt in explicitly via the
    // toggle. This avoids the confusing "provided + empty" state that shows
    // a variance error before the user has done anything.
    sourceCompositionStatus: row.ledgerEntry?.sourceCompositionStatus
      ?? "unknown_pending_disclosure",
    sourceLines: row.ledgerEntry?.sourceLines.map((entry) => ({ ...entry })) ?? [],
  }), [defaultDeductions, row]);

  const [receivedCashAmount, setReceivedCashAmount] = useState(initialFormState.receivedCashAmount);
  const [receivedStockQuantity, setReceivedStockQuantity] = useState(initialFormState.receivedStockQuantity);
  const [deductions, setDeductions] = useState<DividendDeductionInput[]>(initialFormState.deductions);
  const [sourceCompositionStatus, setSourceCompositionStatus] = useState(initialFormState.sourceCompositionStatus);
  const [sourceLines, setSourceLines] = useState<DividendSourceLineInput[]>(initialFormState.sourceLines);
  const [formError, setFormError] = useState("");

  const reconcileBaseline = useMemo(
    () => ({
      status: row.ledgerEntry?.reconciliationStatus ?? "open",
      note: row.ledgerEntry?.reconciliationNote ?? "",
    }),
    [row.ledgerEntry?.reconciliationStatus, row.ledgerEntry?.reconciliationNote],
  );
  const [reconcileStatus, setReconcileStatus] = useState<DividendReconciliationStatus>(
    reconcileBaseline.status,
  );
  const [reconcileNote, setReconcileNote] = useState<string>(reconcileBaseline.note);
  const [reconcileError, setReconcileError] = useState("");
  const [isReconcileSaving, setIsReconcileSaving] = useState(false);

  useEffect(() => {
    setReceivedCashAmount(initialFormState.receivedCashAmount);
    setReceivedStockQuantity(initialFormState.receivedStockQuantity);
    setDeductions(initialFormState.deductions);
    setSourceCompositionStatus(initialFormState.sourceCompositionStatus);
    setSourceLines(initialFormState.sourceLines);
    setFormError("");
    setReconcileStatus(reconcileBaseline.status);
    setReconcileNote(reconcileBaseline.note);
    setReconcileError("");
  }, [initialFormState, reconcileBaseline]);

  const { errorMessage, isSubmitting, submit } = useDividendPosting({
    versionConflictMessage: dict.dividends.form.error.versionConflict,
    stockEditNotAllowedMessage: dict.dividends.form.error.stockEditNotAllowed,
  });

  const isEtf = row.event.instrumentType === "ETF" || row.event.instrumentType === "BOND_ETF";
  const isEtfEstimate = isEtf && sourceCompositionStatus === "unknown_pending_disclosure";

  // Reactively recompute ETF NHI deduction when source composition changes
  useEffect(() => {
    if (!isEtf || row.event.cashDividendCurrency !== "TWD") return;

    setDeductions((prev) => {
      const nhiIndex = prev.findIndex((d) => d.deductionType === "NHI_SUPPLEMENTAL_PREMIUM");
      if (nhiIndex === -1) return prev;

      let nhiAmount = 0;
      if (sourceCompositionStatus === "provided") {
        const nhiSubjectTotal = sourceLines
          .filter((line) => NHI_SUBJECT_BUCKETS.has(line.sourceBucket))
          .reduce((sum, line) => sum + line.amount, 0);
        if (nhiSubjectTotal >= NHI_THRESHOLD_TWD) {
          nhiAmount = roundTwd(nhiSubjectTotal * NHI_RATE);
        }
      }
      // unknown_pending_disclosure → keep at 0

      if (prev[nhiIndex].amount === nhiAmount) return prev;
      return prev.map((d, i) => (i === nhiIndex ? { ...d, amount: nhiAmount } : d));
    });
  }, [isEtf, row.event.cashDividendCurrency, sourceCompositionStatus, sourceLines]);

  const grossAmount = receivedCashAmount + deductions
    .filter((entry) => entry.withheldAtSource)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const expectedGrossAmount = row.ledgerEntry?.expectedGrossAmount ?? row.event.expectedCashAmount;
  const expectedNhiAmount = row.ledgerEntry?.nhiAmount
    ?? sumDeductions(deductions, (entry) => entry.deductionType === "NHI_SUPPLEMENTAL_PREMIUM");
  const expectedBankFeeAmount = row.ledgerEntry?.bankFeeAmount
    ?? sumDeductions(deductions, (entry) => entry.deductionType === "BANK_FEE");
  const expectedOtherDeductionAmount = row.ledgerEntry?.otherDeductionAmount
    ?? sumDeductions(deductions, (entry) => (
      entry.deductionType !== "NHI_SUPPLEMENTAL_PREMIUM"
      && entry.deductionType !== "BANK_FEE"
    ));
  const expectedNetAmount = row.ledgerEntry?.expectedNetAmount
    ?? (expectedGrossAmount - expectedNhiAmount - expectedBankFeeAmount - expectedOtherDeductionAmount);
  const actualNetAmount = row.ledgerEntry?.actualNetAmount
    ?? (receivedCashAmount - expectedNhiAmount - expectedBankFeeAmount - expectedOtherDeductionAmount);
  const varianceAmount = row.ledgerEntry?.varianceAmount ?? (actualNetAmount - expectedNetAmount);
  const stockRatioState = row.ledgerEntry?.stockDistributionRatioState ?? null;
  const expectedStockCalcState = row.ledgerEntry?.expectedStockCalcState
    ?? (stockRatioState === "unresolved" ? "needs_action" : "resolved");
  const stockDistributionRatio = row.ledgerEntry?.stockDistributionRatio ?? null;
  const sourceLineTotal = sourceLines.reduce((sum, entry) => sum + entry.amount, 0);
  const sourceLineVariance = sourceLineTotal - grossAmount;
  const amountsDirty = JSON.stringify({
    receivedCashAmount,
    receivedStockQuantity,
    deductions,
    sourceCompositionStatus,
    sourceLines,
  }) !== JSON.stringify(initialFormState);
  const reconcileDirty =
    reconcileStatus !== reconcileBaseline.status || reconcileNote !== reconcileBaseline.note;
  const isDirty = amountsDirty || reconcileDirty;

  const showCashField = row.event.eventType !== "STOCK";
  const showStockField = row.event.eventType !== "CASH";
  const canEditStockField = showStockField && (!isEditMode || row.ledgerEntry?.correctionMode === "amend");
  const hasAuthoritativeStockRatio = Boolean(
    showStockField
    && stockRatioState === "authoritative"
    && stockDistributionRatio != null,
  );
  const needsStockRatioAction = Boolean(
    showStockField
    && (expectedStockCalcState === "needs_action" || !hasAuthoritativeStockRatio),
  );
  const postingStatus = row.ledgerEntry?.postingStatus;
  const showReconcileSection =
    isEditMode && (postingStatus === "posted" || postingStatus === "adjusted");

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => {
      onDirtyChange?.(false);
    };
  }, [isDirty, onDirtyChange]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");

    if (sourceCompositionStatus === "provided" && Math.abs(sourceLineVariance) > 1) {
      setFormError(
        formatTemplate(dict.dividends.form.error.sourceLineMismatch, {
          variance: formatCurrencyAmount(sourceLineVariance, row.event.cashDividendCurrency, locale),
        }),
      );
      return;
    }

    const payload: DividendPostingPayload = {
      dividendEventId: row.event.id,
      accountId: row.event.accountId,
      receivedCashAmount: showCashField ? receivedCashAmount : 0,
      receivedStockQuantity: showStockField ? receivedStockQuantity : 0,
      deductions: deductions
        .filter((entry) => entry.amount > 0)
        .map((entry) => ({
          ...entry,
          currencyCode: entry.currencyCode ?? row.event.cashDividendCurrency,
          source: entry.source || "dividend_posting",
        })),
      sourceCompositionStatus,
      sourceLines: sourceCompositionStatus === "provided"
        ? sourceLines
          .filter((entry) => entry.amount > 0)
          .map((entry) => ({
            ...entry,
            currencyCode: entry.currencyCode ?? "TWD",
            source: entry.source || "dividend_posting",
          }))
        : [],
      dividendLedgerEntryId: row.ledgerEntry?.id,
      expectedVersion: row.ledgerEntry?.version,
    };

    const result = await submit(payload);
    if (!result) {
      return;
    }

    await onSaved();
  }

  async function handleSaveReconciliation() {
    setReconcileError("");
    if (!row.ledgerEntry) return;
    if (reconcileStatus === "explained" && reconcileNote.trim().length === 0) {
      setReconcileError(dict.dividends.form.error.noteRequiredForExplained);
      return;
    }
    if (amountsDirty && typeof window !== "undefined") {
      const confirmed = window.confirm(dict.dividends.form.unsavedChangesConfirm);
      if (!confirmed) return;
    }
    setIsReconcileSaving(true);
    try {
      await updateDividendReconciliation(
        row.ledgerEntry.id,
        reconcileStatus,
        reconcileNote.trim() ? reconcileNote.trim() : undefined,
      );
      await onSaved();
    } catch (error) {
      setReconcileError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsReconcileSaving(false);
    }
  }

  const headerBlock = (
    <div className="rounded-[22px] border border-slate-200 bg-white/90 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-semibold text-slate-950">{row.event.ticker}</h3>
          <p className="mt-1 break-all text-[11px] uppercase tracking-[0.18em] text-slate-500">
            {eventAccountLabel(row)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            {dict.dashboardHome.paymentDateLabel}
          </p>
          <p className="mt-1 text-sm font-medium text-slate-700">
            {row.event.paymentDate ?? dict.dividends.paymentDateTbdSection}
          </p>
        </div>
      </div>
    </div>
  );

  const expectedSummaryBlock = (
    <section
      className="space-y-3 rounded-[22px] border border-slate-200 bg-white/90 p-4"
      data-testid="dividend-expected-summary"
    >
      <h4 className="text-sm font-semibold text-slate-900">{dict.dividends.form.expectedSectionTitle}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/90 bg-slate-50/85 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{dict.dividends.form.receivedCash}</p>
          <p className="mt-2 text-base font-semibold text-slate-950">
            {formatCurrencyAmount(row.event.expectedCashAmount, row.event.cashDividendCurrency, locale)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {formatTemplate(dict.dividends.form.expectedCashFormula, {
              quantity: formatNumber(row.event.eligibleQuantity, locale),
              rate: cashPerShare !== null
                ? formatCurrencyAmount(cashPerShare, row.event.cashDividendCurrency, locale)
                : formatCurrencyAmount(0, row.event.cashDividendCurrency, locale),
              total: formatCurrencyAmount(row.event.expectedCashAmount, row.event.cashDividendCurrency, locale),
            })}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/90 bg-slate-50/85 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{dict.dividends.form.receivedStockQty}</p>
          <p className="mt-2 text-base font-semibold text-slate-950">
            {showStockField ? formatNumber(row.event.expectedStockQuantity, locale) : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {showStockField
              ? hasAuthoritativeStockRatio
                ? formatTemplate(dict.dividends.form.expectedStockFormula, {
                  quantity: formatNumber(row.event.eligibleQuantity, locale),
                  ratio: formatRatio(stockDistributionRatio ?? 0, locale),
                  total: formatNumber(row.event.expectedStockQuantity, locale),
                })
                : formatTemplate(dict.dividends.form.expectedStockFormulaUnresolved, {
                  quantity: formatNumber(row.event.eligibleQuantity, locale),
                })
              : "—"}
          </p>
          {needsStockRatioAction ? (
            <p
              className="mt-2 text-xs font-medium text-amber-700"
              data-testid="dividend-expected-stock-needs-action"
              title={dict.dividends.form.unresolvedStockRatio}
            >
              {dict.dividends.overview.needsAction}: {dict.dividends.form.unresolvedStockRatio}
            </p>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryMetric
          label={dict.dividends.review.table.expected}
          value={formatCurrencyAmount(expectedGrossAmount, row.event.cashDividendCurrency, locale)}
        />
        <SummaryMetric
          label={dict.dividends.review.table.nhi}
          value={formatCurrencyAmount(expectedNhiAmount, row.event.cashDividendCurrency, locale)}
        />
        <SummaryMetric
          label={dict.dividends.review.table.bankFee}
          value={formatCurrencyAmount(expectedBankFeeAmount, row.event.cashDividendCurrency, locale)}
        />
        <SummaryMetric
          label={dict.dividends.review.table.otherDeduction}
          value={formatCurrencyAmount(expectedOtherDeductionAmount, row.event.cashDividendCurrency, locale)}
        />
        <SummaryMetric
          label={dict.dividends.form.expectedNetLabel}
          value={formatCurrencyAmount(expectedNetAmount, row.event.cashDividendCurrency, locale)}
        />
      </div>
      <p className="text-xs text-slate-500" data-testid="dividend-expected-net-formula">
        {formatTemplate(dict.dividends.form.expectedNetFormula, {
          gross: formatCurrencyAmount(expectedGrossAmount, row.event.cashDividendCurrency, locale),
          nhi: formatCurrencyAmount(expectedNhiAmount, row.event.cashDividendCurrency, locale),
          bankFee: formatCurrencyAmount(expectedBankFeeAmount, row.event.cashDividendCurrency, locale),
          other: formatCurrencyAmount(expectedOtherDeductionAmount, row.event.cashDividendCurrency, locale),
          net: formatCurrencyAmount(expectedNetAmount, row.event.cashDividendCurrency, locale),
        })}
      </p>
    </section>
  );

  const amountsFormBlock = (
    <form className="space-y-6" onSubmit={handleSubmit} data-testid="dividend-posting-form">
      <section
        className="space-y-4 rounded-[22px] border border-slate-200 bg-white/90 p-4"
        data-testid="dividend-actual-inputs"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">{dict.dividends.form.actualSectionTitle}</h4>
            <p className="mt-1 text-xs text-slate-500">
              {dict.dividends.form.varianceLabel}: {formatCurrencyAmount(varianceAmount, row.event.cashDividendCurrency, locale)}
            </p>
            <p className="mt-1 text-xs text-slate-500" data-testid="dividend-variance-formula">
              {formatTemplate(dict.dividends.form.varianceFormula, {
                actualNet: formatCurrencyAmount(actualNetAmount, row.event.cashDividendCurrency, locale),
                expectedNet: formatCurrencyAmount(expectedNetAmount, row.event.cashDividendCurrency, locale),
                variance: formatCurrencyAmount(varianceAmount, row.event.cashDividendCurrency, locale),
              })}
            </p>
          </div>
          {!canEditStockField && showStockField ? (
            <span
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
              data-testid="dividend-stock-edit-disabled-label"
            >
              {dict.dividends.action.stockEditDisabled}
            </span>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryMetric
            label={dict.dividends.form.actualNetLabel}
            value={formatCurrencyAmount(actualNetAmount, row.event.cashDividendCurrency, locale)}
          />
          <SummaryMetric
            label={dict.dividends.form.varianceLabel}
            value={formatCurrencyAmount(varianceAmount, row.event.cashDividendCurrency, locale)}
          />
        </div>

        {showCashField ? (
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-800">{dict.dividends.form.receivedCash}</span>
            <input
              className={fieldClassName}
              data-testid="dividend-received-cash"
              inputMode="numeric"
              min={0}
              type="number"
              value={receivedCashAmount}
              onChange={(event) => setReceivedCashAmount(Number(event.target.value))}
            />
            {cashPerShare !== null ? (
              <p className="text-xs text-slate-500" data-testid="dividend-received-cash-hint">
                {formatTemplate(dict.dividends.form.receivedCashHint, {
                  perShare: formatCurrencyAmount(cashPerShare, row.event.cashDividendCurrency, locale),
                  quantity: formatNumber(row.event.eligibleQuantity, locale),
                  total: formatCurrencyAmount(row.event.expectedCashAmount, row.event.cashDividendCurrency, locale),
                })}
              </p>
            ) : null}
          </label>
        ) : null}

        {showStockField ? (
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-800">{dict.dividends.form.receivedStockQty}</span>
            <input
              className={fieldClassName}
              data-testid="dividend-received-stock"
              inputMode="numeric"
              min={0}
              type="number"
              value={receivedStockQuantity}
              onChange={(event) => setReceivedStockQuantity(Number(event.target.value))}
              disabled={!canEditStockField}
            />
            {row.event.expectedStockQuantity > 0 && row.event.eligibleQuantity > 0 ? (
              <p className="text-xs text-slate-500" data-testid="dividend-received-stock-hint">
                {formatTemplate(dict.dividends.form.receivedStockHint, {
                  quantity: formatNumber(row.event.eligibleQuantity, locale),
                  total: formatNumber(row.event.expectedStockQuantity, locale),
                })}
              </p>
            ) : null}
          </label>
        ) : null}
      </section>

      <section className="space-y-3 rounded-[22px] border border-slate-200 bg-white/90 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">{dict.dividends.form.deductions.title}</h4>
            <p className="mt-1 text-xs text-slate-500">
              {formatCurrencyAmount(grossAmount, row.event.cashDividendCurrency, locale)}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDeductions((previous) => [...previous, createEmptyDeduction()])}
            data-testid="dividend-add-deduction"
          >
            {dict.dividends.form.deductions.addRow}
          </Button>
        </div>

        {deductions.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.dividends.form.deductions.title}</p>
        ) : (
          <div className="space-y-3">
            {deductions.map((deduction, index) => (
              <div key={`${deduction.id ?? "new"}-${index}`} className="grid gap-3 rounded-2xl border border-slate-200/90 bg-slate-50/85 p-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_auto]">
                  <select
                    className={fieldClassName}
                    data-testid={`dividend-deduction-type-${index}`}
                    aria-label={`${dict.dividends.form.deductions.type} ${index + 1}`}
                    value={deduction.deductionType}
                    onChange={(event) => {
                      const nextType = event.target.value as DividendDeductionType;
                      setDeductions((previous) => previous.map((entry, itemIndex) => itemIndex === index ? { ...entry, deductionType: nextType } : entry));
                    }}
                  >
                    {DEDUCTION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {resolveDeductionTypeLabel(dict, type)}
                      </option>
                    ))}
                  </select>
                  <input
                    className={fieldClassName}
                    data-testid={`dividend-deduction-amount-${index}`}
                    aria-label={`${dict.dividends.form.deductions.amount} ${index + 1}`}
                    inputMode="numeric"
                    min={0}
                    type="number"
                    value={deduction.amount}
                    onChange={(event) => {
                      const nextAmount = Number(event.target.value);
                      setDeductions((previous) => previous.map((entry, itemIndex) => itemIndex === index ? { ...entry, amount: nextAmount } : entry));
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`dividend-remove-deduction-${index}`}
                    onClick={() => setDeductions((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    {dict.dividends.form.deductions.removeRow}
                  </Button>
                </div>

                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    checked={deduction.withheldAtSource}
                    type="checkbox"
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setDeductions((previous) => previous.map((entry, itemIndex) => itemIndex === index ? { ...entry, withheldAtSource: checked } : entry));
                    }}
                  />
                  {dict.dividends.form.deductions.atSource}
                </label>
              </div>
            ))}
          </div>
        )}

        {isEtfEstimate && (
          <p
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
            data-testid="nhi-estimate-warning"
          >
            {dict.dividends.form.sourceComposition.estimateWarning}
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-[22px] border border-slate-200 bg-white/90 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-slate-900">{dict.dividends.form.sourceLines.title}</h4>
            <p className="mt-1 text-xs leading-5 text-slate-500" data-testid="dividend-source-helper">
              {dict.dividends.form.sourceLines.helper}
            </p>
            {sourceCompositionStatus === "provided" ? (
              <p className="mt-1 text-xs text-slate-500">
                {formatTemplate(dict.dividends.form.sourceLines.varianceLabel, {
                  variance: formatCurrencyAmount(sourceLineVariance, row.event.cashDividendCurrency, locale),
                })}
              </p>
            ) : null}
          </div>
          <label className="inline-flex shrink-0 items-center gap-2 text-sm text-slate-700">
            <input
              data-testid="dividend-source-unknown-toggle"
              checked={sourceCompositionStatus === "unknown_pending_disclosure"}
              type="checkbox"
              onChange={(event) => {
                const nextUnknown = event.target.checked;
                setSourceCompositionStatus(nextUnknown ? "unknown_pending_disclosure" : "provided");
                if (nextUnknown) {
                  setSourceLines([]);
                }
              }}
            />
            {dict.dividends.form.sourceLines.unknownToggle}
          </label>
        </div>

        {sourceCompositionStatus === "provided" ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSourceLines((previous) => [...previous, createEmptySourceLine()])}
              data-testid="dividend-add-source-line"
            >
              {dict.dividends.form.sourceLines.addRow}
            </Button>
            <div className="space-y-3">
              {sourceLines.map((sourceLine, index) => (
                <div key={`${sourceLine.id ?? "new"}-${index}`} className="grid gap-3 rounded-2xl border border-slate-200/90 bg-slate-50/85 p-3 md:grid-cols-[minmax(0,1fr)_8rem_auto]">
                  <select
                    className={fieldClassName}
                    data-testid={`dividend-source-bucket-${index}`}
                    aria-label={`${dict.dividends.form.sourceLines.title} ${index + 1}`}
                    value={sourceLine.sourceBucket}
                    onChange={(event) => {
                      const nextBucket = event.target.value as typeof SOURCE_BUCKETS[number];
                      setSourceLines((previous) => previous.map((entry, itemIndex) => itemIndex === index ? { ...entry, sourceBucket: nextBucket } : entry));
                    }}
                  >
                    {SOURCE_BUCKETS.map((bucket) => (
                      <option key={bucket} value={bucket}>
                        {resolveSourceBucketLabel(dict, bucket)}
                      </option>
                    ))}
                  </select>
                  <input
                    className={fieldClassName}
                    data-testid={`dividend-source-amount-${index}`}
                    aria-label={`${dict.dividends.form.sourceLines.amount} ${index + 1}`}
                    inputMode="numeric"
                    min={0}
                    type="number"
                    value={sourceLine.amount}
                    onChange={(event) => {
                      const nextAmount = Number(event.target.value);
                      setSourceLines((previous) => previous.map((entry, itemIndex) => itemIndex === index ? { ...entry, amount: nextAmount } : entry));
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`dividend-remove-source-line-${index}`}
                    onClick={() => setSourceLines((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    {dict.dividends.form.deductions.removeRow}
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </section>

      {isEtf && (
        <SourceCompositionCollapsible
          sourceLines={sourceLines}
          sourceCompositionStatus={sourceCompositionStatus}
          dict={dict}
          locale={locale}
        />
      )}

      {formError || errorMessage ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" data-testid="dividend-form-error">
          {formError || errorMessage}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
        <Button type="submit" disabled={isSubmitting} data-testid="dividend-save">
          {isSubmitting ? dict.feedback.loadingDashboard : dict.dividends.action.save}
        </Button>
      </div>
    </form>
  );

  const reconcileSection = (
    <section
      className="space-y-3 rounded-[22px] border border-slate-200 bg-white/90 p-4"
      data-testid="dividend-reconcile-section"
    >
      <h4 className="text-sm font-semibold text-slate-900">
        {dict.dividends.form.reconciliation.title}
      </h4>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-800">
          {dict.dividends.form.reconciliation.title}
        </span>
        <select
          className={fieldClassName}
          data-testid="dividend-reconcile-status-select"
          value={reconcileStatus}
          onChange={(event) =>
            setReconcileStatus(event.target.value as DividendReconciliationStatus)
          }
        >
          <option value="open">{dict.dividends.form.reconciliation.statusOpen}</option>
          <option value="matched">{dict.dividends.form.reconciliation.statusMatched}</option>
          <option value="explained">{dict.dividends.form.reconciliation.statusExplained}</option>
          <option value="resolved">{dict.dividends.form.reconciliation.statusResolved}</option>
        </select>
      </label>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-800">
          {dict.dividends.form.reconciliation.noteLabel}
        </span>
        <textarea
          className={fieldClassName}
          data-testid="dividend-reconcile-note"
          maxLength={500}
          rows={3}
          value={reconcileNote}
          onChange={(event) => setReconcileNote(event.target.value)}
        />
        {reconcileStatus === "explained" ? (
          <p className="text-xs text-slate-500">
            {dict.dividends.form.reconciliation.noteRequired}
          </p>
        ) : null}
      </label>

      {reconcileError ? (
        <p
          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          data-testid="dividend-reconcile-error"
        >
          {reconcileError}
        </p>
      ) : null}

      <div className="flex items-center justify-end">
        <Button
          type="button"
          onClick={() => void handleSaveReconciliation()}
          disabled={isReconcileSaving}
          data-testid="dividend-reconcile-save"
        >
          {isReconcileSaving ? dict.feedback.loadingDashboard : dict.dividends.action.save}
        </Button>
      </div>
    </section>
  );

  return (
    <div className="space-y-6" data-testid="dividend-posting-form-container">
      {headerBlock}
      {expectedSummaryBlock}
      {amountsFormBlock}
      {showReconcileSection ? reconcileSection : null}
      <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          data-testid="dividend-cancel"
        >
          {dict.dividends.action.cancel}
        </Button>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-slate-50/85 p-3">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function SourceCompositionCollapsible({
  sourceLines,
  sourceCompositionStatus,
  dict,
  locale,
}: {
  sourceLines: DividendSourceLineInput[];
  sourceCompositionStatus: "provided" | "unknown_pending_disclosure";
  dict: AppDictionary;
  locale: LocaleCode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const badgeWarning = sourceCompositionStatus === "unknown_pending_disclosure"
    ? dict.dividends.form.sourceComposition.badgeWarning
    : null;

  // Convert DividendSourceLineInput[] to the shape SourceCompositionTab expects
  const asSourceLines = sourceLines.map((line, i) => ({
    id: line.id ?? `local-${i}`,
    dividendLedgerEntryId: "",
    sourceBucket: line.sourceBucket,
    amount: line.amount,
    currencyCode: line.currencyCode ?? "TWD",
    source: line.source ?? "dividend_posting",
    sourceReference: line.sourceReference,
    note: line.note,
  }));

  return (
    <section className="space-y-3 rounded-[22px] border border-slate-200 bg-white/90 p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setIsOpen((prev) => !prev)}
        data-testid="source-composition-toggle"
      >
        <span className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-900">
            {dict.dividends.form.sourceComposition.tabLabel}
          </h4>
          {badgeWarning && (
            <span className="text-xs text-amber-600">{badgeWarning}</span>
          )}
        </span>
        <span className="text-xs text-slate-400">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <SourceCompositionTab
          sourceLines={asSourceLines}
          sourceCompositionStatus={sourceCompositionStatus}
          dict={dict}
          locale={locale}
        />
      )}
    </section>
  );
}

function resolveDeductionTypeLabel(dict: AppDictionary, value: DividendDeductionType): string {
  switch (value) {
    case "WITHHOLDING_TAX":
      return dict.dividends.form.deductionType.withholdingTax;
    case "NHI_SUPPLEMENTAL_PREMIUM":
      return dict.dividends.form.deductionType.nhiSupplementalPremium;
    case "BROKER_FEE":
      return dict.dividends.form.deductionType.brokerFee;
    case "BANK_FEE":
      return dict.dividends.form.deductionType.bankFee;
    case "TRANSFER_FEE":
      return dict.dividends.form.deductionType.transferFee;
    case "CASH_IN_LIEU_ADJUSTMENT":
      return dict.dividends.form.deductionType.cashInLieuAdjustment;
    case "ROUNDING_ADJUSTMENT":
      return dict.dividends.form.deductionType.roundingAdjustment;
    default:
      return dict.dividends.form.deductionType.other;
  }
}

function resolveSourceBucketLabel(dict: AppDictionary, value: typeof SOURCE_BUCKETS[number]): string {
  switch (value) {
    case "DIVIDEND_INCOME":
      return dict.dividends.form.sourceBucket.dividendIncome;
    case "INTEREST_INCOME":
      return dict.dividends.form.sourceBucket.interestIncome;
    case "SECURITIES_GAIN_INCOME":
      return dict.dividends.form.sourceBucket.securitiesGainIncome;
    case "REVENUE_EQUALIZATION":
      return dict.dividends.form.sourceBucket.revenueEqualization;
    case "CAPITAL_EQUALIZATION":
      return dict.dividends.form.sourceBucket.capitalEqualization;
    case "CAPITAL_RETURN":
      return dict.dividends.form.sourceBucket.capitalReturn;
    default:
      return dict.dividends.form.sourceBucket.other;
  }
}
