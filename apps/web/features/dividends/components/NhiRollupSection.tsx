"use client";

import { useMemo } from "react";
import type { AppDictionary } from "../../../lib/i18n";
import { formatCurrencyAmount } from "../../../lib/utils";
import type {
  DividendSourceBucket,
  DividendSourceLine,
  LocaleCode,
} from "@vakwen/shared-types";
import type { DividendLedgerEntryDetails } from "../types";
import { Card } from "../../../components/ui/Card";

// Duplicated from @vakwen/domain — web avoids runtime dep on domain lib.
const NHI_SUBJECT_BUCKETS = new Set<DividendSourceBucket>([
  "DIVIDEND_INCOME",
  "INTEREST_INCOME",
]);

const NHI_RATE = 0.0211;
const NHI_THRESHOLD_TWD = 20_000;

const ALL_BUCKETS: DividendSourceBucket[] = [
  "DIVIDEND_INCOME",
  "INTEREST_INCOME",
  "SECURITIES_GAIN_INCOME",
  "REVENUE_EQUALIZATION",
  "CAPITAL_EQUALIZATION",
  "CAPITAL_RETURN",
  "OTHER",
];

function bucketDisplayName(
  dict: AppDictionary,
  bucket: DividendSourceBucket,
): string {
  switch (bucket) {
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

function roundTwd(value: number): number {
  return Math.round(value + Number.EPSILON);
}

interface BucketAggregate {
  bucket: DividendSourceBucket;
  totalAmount: number;
  isNhiSubject: boolean;
}

/**
 * Aggregate source lines from ETF/BOND_ETF entries by bucket.
 * Exported as a named function for unit testing.
 */
export function aggregateEtfSourceLines(
  ledgerEntries: DividendLedgerEntryDetails[],
): {
  bucketAggregates: BucketAggregate[];
  nhiSubjectTotal: number;
  projectedPremium: number;
  pendingCount: number;
} {
  const etfEntries = ledgerEntries.filter(
    (e) => e.instrumentType === "ETF" || e.instrumentType === "BOND_ETF",
  );

  const pendingCount = etfEntries.filter(
    (e) => e.sourceCompositionStatus === "unknown_pending_disclosure",
  ).length;

  // Flatten all source lines from ETF entries
  const allSourceLines: DividendSourceLine[] = etfEntries.flatMap(
    (e) => e.sourceLines,
  );

  // Sum amounts by bucket
  const amountByBucket = new Map<DividendSourceBucket, number>();
  for (const line of allSourceLines) {
    amountByBucket.set(
      line.sourceBucket,
      (amountByBucket.get(line.sourceBucket) ?? 0) + line.amount,
    );
  }

  // Build aggregates for buckets with amounts
  const bucketAggregates: BucketAggregate[] = ALL_BUCKETS
    .filter((b) => (amountByBucket.get(b) ?? 0) > 0)
    .map((b) => ({
      bucket: b,
      totalAmount: amountByBucket.get(b) ?? 0,
      isNhiSubject: NHI_SUBJECT_BUCKETS.has(b),
    }));

  const nhiSubjectTotal = bucketAggregates
    .filter((a) => a.isNhiSubject)
    .reduce((sum, a) => sum + a.totalAmount, 0);

  // Per-entry threshold: NT$20,000 threshold applies per dividend payment,
  // not on the aggregate annual total. Only entries with provided source
  // composition and per-entry NHI-subject sum >= threshold contribute premium.
  let projectedPremium = 0;
  for (const entry of etfEntries) {
    if (entry.sourceCompositionStatus !== "provided") continue;
    const perEntryNhiSubject = entry.sourceLines
      .filter((line) => NHI_SUBJECT_BUCKETS.has(line.sourceBucket))
      .reduce((sum, line) => sum + line.amount, 0);
    if (perEntryNhiSubject >= NHI_THRESHOLD_TWD) {
      projectedPremium += roundTwd(perEntryNhiSubject * NHI_RATE);
    }
  }

  return { bucketAggregates, nhiSubjectTotal, projectedPremium, pendingCount };
}

interface NhiRollupSectionProps {
  ledgerEntries: DividendLedgerEntryDetails[];
  dict: AppDictionary;
  locale: LocaleCode;
  onFilterPending: () => void;
}

function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

export function NhiRollupSection({
  ledgerEntries,
  dict,
  locale,
  onFilterPending,
}: NhiRollupSectionProps) {
  const d = dict.dividends.review.nhiRollup;

  const { bucketAggregates, nhiSubjectTotal, projectedPremium, pendingCount } =
    useMemo(() => aggregateEtfSourceLines(ledgerEntries), [ledgerEntries]);

  const hasEtfEntries = ledgerEntries.some(
    (e) => e.instrumentType === "ETF" || e.instrumentType === "BOND_ETF",
  );

  if (!hasEtfEntries) {
    return (
      <Card
        className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/90 px-5 py-8 text-center"
        data-testid="nhi-rollup-empty"
      >
        <p className="text-sm text-slate-600">
          {formatTemplate(d.emptyState, { year: new Date().getFullYear() })}
        </p>
      </Card>
    );
  }

  return (
    <Card
      className="space-y-4 rounded-[24px] border border-slate-200 bg-white/92 p-4 shadow-[0_16px_36px_rgba(148,163,184,0.12)]"
      data-testid="nhi-rollup-section"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{d.title}</h3>
        {pendingCount > 0 && (
          <button
            type="button"
            className="text-xs font-medium text-amber-600 hover:text-amber-700"
            onClick={onFilterPending}
            data-testid="nhi-rollup-pending-link"
          >
            {formatTemplate(d.pendingLink, { count: pendingCount })}
          </button>
        )}
      </div>

      {/* Desktop table (sm and above) */}
      <div className="hidden sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
              <th className="py-2 pr-4">{dict.dividends.form.sourceComposition.tabLabel}</th>
              <th className="py-2 pr-4 text-right">{dict.dividends.form.sourceLines.amount}</th>
              <th className="py-2 text-center">{dict.dividends.form.sourceComposition.nhiSubjectColumn}</th>
            </tr>
          </thead>
          <tbody>
            {bucketAggregates.map((agg) => (
              <tr key={agg.bucket} className="border-b border-slate-100">
                <td className="py-2 pr-4 text-slate-900">
                  {bucketDisplayName(dict, agg.bucket)}
                </td>
                <td className="py-2 pr-4 text-right text-slate-900">
                  {formatCurrencyAmount(agg.totalAmount, "TWD", locale)}
                </td>
                <td className="py-2 text-center">
                  {agg.isNhiSubject ? (
                    <span className="text-emerald-600">✓</span>
                  ) : (
                    <span className="text-slate-400">✗</span>
                  )}
                </td>
              </tr>
            ))}
            {/* NHI-subject total */}
            <tr className="border-t border-slate-300 font-medium">
              <td className="py-2 pr-4 text-slate-900">{d.nhiSubjectTotal}</td>
              <td className="py-2 pr-4 text-right text-slate-900">
                {formatCurrencyAmount(nhiSubjectTotal, "TWD", locale)}
              </td>
              <td />
            </tr>
            {/* Projected premium */}
            <tr className="font-medium">
              <td className="py-2 pr-4 text-slate-900">{d.projectedPremium}</td>
              <td
                className="py-2 pr-4 text-right text-slate-900"
                data-testid="nhi-rollup-premium"
              >
                {formatCurrencyAmount(projectedPremium, "TWD", locale)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile cards (below sm) */}
      <div className="space-y-2 sm:hidden">
        {bucketAggregates.map((agg) => (
          <div
            key={agg.bucket}
            className="rounded-xl border border-slate-200 bg-slate-50/85 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-900">
                {bucketDisplayName(dict, agg.bucket)}
              </span>
              {agg.isNhiSubject ? (
                <span className="text-xs text-emerald-600">✓ {dict.dividends.form.sourceComposition.nhiSubjectColumn}</span>
              ) : (
                <span className="text-xs text-slate-400">✗</span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-700">
              {formatCurrencyAmount(agg.totalAmount, "TWD", locale)}
            </p>
          </div>
        ))}

        {/* NHI total card */}
        <div className="rounded-xl border border-slate-300 bg-white p-3">
          <p className="text-sm font-semibold text-slate-900">{d.nhiSubjectTotal}</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {formatCurrencyAmount(nhiSubjectTotal, "TWD", locale)}
          </p>
        </div>

        {/* Projected premium card */}
        <div className="rounded-xl border border-slate-300 bg-white p-3">
          <p className="text-sm font-semibold text-slate-900">{d.projectedPremium}</p>
          <p
            className="mt-1 text-sm font-medium text-slate-900"
            data-testid="nhi-rollup-premium-mobile"
          >
            {formatCurrencyAmount(projectedPremium, "TWD", locale)}
          </p>
        </div>
      </div>
    </Card>
  );
}
