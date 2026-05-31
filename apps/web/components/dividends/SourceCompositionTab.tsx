"use client";

import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount } from "../../lib/utils";
import type {
  DividendSourceBucket,
  DividendSourceLine,
  LocaleCode,
  SourceCompositionStatus,
} from "@vakwen/shared-types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/shadcn/table";

interface SourceCompositionTabProps {
  sourceLines: DividendSourceLine[];
  sourceCompositionStatus: SourceCompositionStatus;
  dict: AppDictionary;
  locale: LocaleCode;
}

// Duplicated from @vakwen/domain to avoid runtime dep on domain lib in web.
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

  // Phase 4 — single-DOM table (drops legacy `sm:hidden` card variant).
  // Three narrow columns; horizontal scroll at very tight viewports.
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

      <Table className="text-sm">
        <TableHeader>
          <TableRow className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <TableHead className="py-2 pr-4">{d.tabLabel}</TableHead>
            <TableHead className="py-2 pr-4 text-right">{dict.dividends.form.sourceLines.amount}</TableHead>
            <TableHead className="py-2 text-center">{d.nhiSubjectColumn}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleBuckets.map((bucket) => (
            <TableRow key={bucket}>
              <TableCell className="py-2 pr-4 text-foreground">
                {bucketDisplayName(dict, bucket)}
              </TableCell>
              <TableCell className="py-2 pr-4 text-right text-foreground">
                {formatCurrencyAmount(amountByBucket.get(bucket) ?? 0, "TWD", locale)}
              </TableCell>
              <TableCell className="py-2 text-center">
                {NHI_SUBJECT_BUCKETS.has(bucket) ? (
                  <span className="text-emerald-600">✓</span>
                ) : (
                  <span className="text-muted-foreground">✗</span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {/* NHI-subject subtotal */}
          <TableRow className="border-t border-border font-medium">
            <TableCell className="py-2 pr-4 text-foreground">{d.nhiSubjectSubtotal}</TableCell>
            <TableCell
              className="py-2 pr-4 text-right text-foreground"
              data-testid="source-composition-nhi-subtotal"
            >
              {formatCurrencyAmount(nhiSubjectSubtotal, "TWD", locale)}
            </TableCell>
            <TableCell />
          </TableRow>
          {/* Projected premium */}
          <TableRow className="font-medium">
            <TableCell className="py-2 pr-4 text-foreground">{rateLabel}</TableCell>
            <TableCell className="py-2 pr-4 text-right text-foreground">
              {formatCurrencyAmount(projectedPremium, "TWD", locale)}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
