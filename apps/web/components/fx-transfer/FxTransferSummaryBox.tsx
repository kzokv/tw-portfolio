"use client";

import type { LocaleCode } from "@tw-portfolio/shared-types";
import { formatCurrencyAmount } from "../../lib/utils";
import type { AppDictionary } from "../../lib/i18n";
import type { FxTransferEstimate } from "../../features/fx-transfer/services/fxTransferService";

interface FxTransferSummaryBoxProps {
  fromCurrency: string;
  toCurrency: string;
  toAmount: number;
  effectiveRate: number;
  estimate: FxTransferEstimate | null;
  loading: boolean;
  error: string;
  dict: AppDictionary;
  locale: LocaleCode;
}

export function FxTransferSummaryBox({
  fromCurrency,
  toCurrency,
  toAmount,
  effectiveRate,
  estimate,
  loading,
  error,
  dict,
  locale,
}: FxTransferSummaryBoxProps) {
  const d = dict.cashLedger;
  const rateText = effectiveRate > 0
    ? `${effectiveRate.toFixed(6)} ${toCurrency || "—"}/${fromCurrency || "—"}`
    : "—";
  const acquiredText = toAmount > 0 && toCurrency
    ? formatCurrencyAmount(toAmount, toCurrency, locale)
    : "—";
  const realizedText = toCurrency && toCurrency !== "USD"
    ? d.fxSummaryDeferredImpact.replace("{currency}", toCurrency)
    : formatCurrencyAmount(estimate?.realizedFxImpactUsd ?? 0, "USD", locale);

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm"
      data-testid="fx-transfer-summary"
    >
      <h3 className="text-sm font-semibold text-slate-900">{d.fxSummaryTitle}</h3>
      <dl className="mt-3 grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500">{d.fxSummaryEffectiveRate}</dt>
          <dd className="text-right font-medium text-slate-900">{rateText}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500">{d.fxSummaryAcquired}</dt>
          <dd className="text-right font-medium text-slate-900">{acquiredText}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500">{d.fxSummaryRealizedImpact}</dt>
          <dd className="text-right font-medium text-slate-900">{realizedText}</dd>
        </div>
      </dl>
      {loading ? <p className="mt-3 text-xs text-slate-500">{d.fxEstimateLoading}</p> : null}
      {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
      {estimate?.insufficientBalance ? (
        <p className="mt-3 text-xs text-rose-600">{d.fxInsufficientBalance}</p>
      ) : null}
    </div>
  );
}
