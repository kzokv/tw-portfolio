"use client";

import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount } from "../../lib/utils";
import type {
  DividendSourceBucket,
  DividendSourceLine,
  LocaleCode,
  SourceCompositionStatus,
} from "@tw-portfolio/shared-types";

interface SourceCompositionTabProps {
  sourceLines: DividendSourceLine[];
  sourceCompositionStatus: SourceCompositionStatus;
  dict: AppDictionary;
  locale: LocaleCode;
}

// Duplicated from @tw-portfolio/domain to avoid runtime dep on domain lib in web.
// Same pattern as NHI_RATE duplication in DividendPostingForm.tsx.
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

export function SourceCompositionTab({
  sourceLines,
  sourceCompositionStatus,
  dict,
  locale,
}: SourceCompositionTabProps) {
  const isEstimate = sourceCompositionStatus === "unknown_pending_disclosure";
  const d = dict.dividends.form.sourceComposition;

  // Build amounts by bucket
  const amountByBucket = new Map<DividendSourceBucket, number>();
  for (const bucket of ALL_BUCKETS) {
    amountByBucket.set(bucket, 0);
  }
  if (!isEstimate) {
    for (const line of sourceLines) {
      amountByBucket.set(
        line.sourceBucket,
        (amountByBucket.get(line.sourceBucket) ?? 0) + line.amount,
      );
    }
  }

  // Filter to only buckets with amounts (or all if estimate)
  const visibleBuckets = isEstimate
    ? ALL_BUCKETS
    : ALL_BUCKETS.filter((b) => (amountByBucket.get(b) ?? 0) > 0);

  const nhiSubjectSubtotal = visibleBuckets
    .filter((b) => NHI_SUBJECT_BUCKETS.has(b))
    .reduce((sum, b) => sum + (amountByBucket.get(b) ?? 0), 0);

  const projectedPremium =
    nhiSubjectSubtotal >= NHI_THRESHOLD_TWD
      ? roundTwd(nhiSubjectSubtotal * NHI_RATE)
      : 0;

  const rateLabel = d.projectedPremium.replace("{rate}", String(NHI_RATE));

  return (
    <div data-testid="source-composition-tab" className="space-y-3">
      {isEstimate && (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
          data-testid="source-composition-estimate-warning"
        >
          {d.estimateWarning}
        </p>
      )}

      {/* Desktop table (sm and above) */}
      <div className="hidden sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
              <th className="py-2 pr-4">{d.tabLabel}</th>
              <th className="py-2 pr-4 text-right">{dict.dividends.form.sourceLines.amount}</th>
              <th className="py-2 text-center">{d.nhiSubjectColumn}</th>
            </tr>
          </thead>
          <tbody>
            {visibleBuckets.map((bucket) => (
              <tr key={bucket} className="border-b border-slate-100">
                <td className="py-2 pr-4 text-slate-900">
                  {bucketDisplayName(dict, bucket)}
                </td>
                <td className="py-2 pr-4 text-right text-slate-900">
                  {formatCurrencyAmount(amountByBucket.get(bucket) ?? 0, "TWD", locale)}
                </td>
                <td className="py-2 text-center">
                  {NHI_SUBJECT_BUCKETS.has(bucket) ? (
                    <span className="text-emerald-600">✓</span>
                  ) : (
                    <span className="text-slate-400">✗</span>
                  )}
                </td>
              </tr>
            ))}
            {/* NHI-subject subtotal */}
            <tr className="border-t border-slate-300 font-medium">
              <td className="py-2 pr-4 text-slate-900">{d.nhiSubjectSubtotal}</td>
              <td
                className="py-2 pr-4 text-right text-slate-900"
                data-testid="source-composition-nhi-subtotal"
              >
                {formatCurrencyAmount(nhiSubjectSubtotal, "TWD", locale)}
              </td>
              <td />
            </tr>
            {/* Projected premium */}
            <tr className="font-medium">
              <td className="py-2 pr-4 text-slate-900">{rateLabel}</td>
              <td className="py-2 pr-4 text-right text-slate-900">
                {formatCurrencyAmount(projectedPremium, "TWD", locale)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile cards (below sm) */}
      <div className="space-y-2 sm:hidden">
        {visibleBuckets.map((bucket) => (
          <div
            key={bucket}
            className="rounded-xl border border-slate-200 bg-slate-50/85 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-900">
                {bucketDisplayName(dict, bucket)}
              </span>
              {NHI_SUBJECT_BUCKETS.has(bucket) ? (
                <span className="text-xs text-emerald-600">✓ {d.nhiSubjectColumn}</span>
              ) : (
                <span className="text-xs text-slate-400">✗</span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-700">
              {formatCurrencyAmount(amountByBucket.get(bucket) ?? 0, "TWD", locale)}
            </p>
          </div>
        ))}

        {/* NHI subtotal card */}
        <div className="rounded-xl border border-slate-300 bg-white p-3">
          <p className="text-sm font-semibold text-slate-900">{d.nhiSubjectSubtotal}</p>
          <p
            className="mt-1 text-sm font-medium text-slate-900"
            data-testid="source-composition-nhi-subtotal-mobile"
          >
            {formatCurrencyAmount(nhiSubjectSubtotal, "TWD", locale)}
          </p>
        </div>

        {/* Projected premium card */}
        <div className="rounded-xl border border-slate-300 bg-white p-3">
          <p className="text-sm font-semibold text-slate-900">{rateLabel}</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {formatCurrencyAmount(projectedPremium, "TWD", locale)}
          </p>
        </div>
      </div>
    </div>
  );
}
