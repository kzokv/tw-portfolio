import React from "react";
import type { LocaleCode, TransactionHistoryItemDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { Card } from "../ui/Card";

interface TransactionHistoryTableProps {
  transactions: TransactionHistoryItemDto[];
  dict: AppDictionary;
  locale: LocaleCode;
}

export function TransactionHistoryTable({ transactions, dict, locale }: TransactionHistoryTableProps) {
  if (transactions.length === 0) {
    return (
      <Card data-testid="symbol-history-empty">
        <p className="text-sm leading-6 text-slate-300">{dict.symbolHistory.emptyState}</p>
      </Card>
    );
  }

  return (
    <Card data-testid="symbol-history-table-section">
      <div className="hidden overflow-x-auto overflow-y-hidden rounded-[22px] border border-white/10 bg-slate-950/35 lg:block">
        <table className="min-w-[1080px] border-collapse text-sm text-slate-200" data-testid="symbol-history-table">
          <thead>
            <tr className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-slate-400">
              <th className="px-4 py-3 text-left font-medium">{dict.symbolHistory.tradeDateLabel}</th>
              <th className="px-4 py-3 text-left font-medium">{dict.holdings.accountTerm}</th>
              <th className="px-4 py-3 text-left font-medium">{dict.transactions.typeTerm}</th>
              <th className="px-4 py-3 text-right font-medium">{dict.transactions.quantityTerm}</th>
              <th className="px-4 py-3 text-right font-medium">{dict.transactions.unitPriceTerm}</th>
              <th className="px-4 py-3 text-right font-medium">{dict.symbolHistory.commissionLabel}</th>
              <th className="px-4 py-3 text-right font-medium">{dict.symbolHistory.taxLabel}</th>
              <th className="px-4 py-3 text-right font-medium">{dict.symbolHistory.realizedPnlLabel}</th>
              <th className="px-4 py-3 text-left font-medium">{dict.symbolHistory.feeProfileLabel}</th>
              <th className="px-4 py-3 text-left font-medium">{dict.symbolHistory.bookedAtLabel}</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr key={transaction.id} className="border-b border-white/8 last:border-0">
                <td className="px-4 py-4">{formatDateLabel(transaction.tradeDate, locale)}</td>
                <td className="px-4 py-4 text-slate-300">{transaction.accountId}</td>
                <td className="px-4 py-4 font-medium text-slate-100">{transaction.type}</td>
                <td className="px-4 py-4 text-right">{formatNumber(transaction.quantity, locale)}</td>
                <td className="px-4 py-4 text-right">{formatCurrencyAmount(transaction.unitPrice, transaction.priceCurrency, locale)}</td>
                <td className="px-4 py-4 text-right">{formatCurrencyAmount(transaction.commissionAmount, transaction.priceCurrency, locale)}</td>
                <td className="px-4 py-4 text-right">{formatCurrencyAmount(transaction.taxAmount, transaction.priceCurrency, locale)}</td>
                <td className={cn("px-4 py-4 text-right font-medium", getRealizedPnlTone(transaction.realizedPnlAmount))}>
                  {transaction.realizedPnlAmount === null
                    ? dict.symbolHistory.noRealizedPnl
                    : formatCurrencyAmount(transaction.realizedPnlAmount, transaction.realizedPnlCurrency ?? transaction.priceCurrency, locale)}
                </td>
                <td className="px-4 py-4 text-slate-300">{transaction.feeProfileName}</td>
                <td className="px-4 py-4 text-slate-300">
                  {transaction.bookedAt ? formatDateLabel(transaction.bookedAt, locale) : dict.symbolHistory.noRealizedPnl}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:hidden">
        {transactions.map((transaction) => (
          <article key={transaction.id} className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4" data-testid="symbol-history-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-slate-50">{transaction.type}</p>
                <p className="mt-1 text-sm text-slate-400">{formatDateLabel(transaction.tradeDate, locale)}</p>
              </div>
              <p className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-300">
                {transaction.accountId}
              </p>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <HistoryDetail label={dict.transactions.quantityTerm} value={formatNumber(transaction.quantity, locale)} />
              <HistoryDetail
                label={dict.transactions.unitPriceTerm}
                value={formatCurrencyAmount(transaction.unitPrice, transaction.priceCurrency, locale)}
              />
              <HistoryDetail
                label={dict.symbolHistory.commissionLabel}
                value={formatCurrencyAmount(transaction.commissionAmount, transaction.priceCurrency, locale)}
              />
              <HistoryDetail
                label={dict.symbolHistory.taxLabel}
                value={formatCurrencyAmount(transaction.taxAmount, transaction.priceCurrency, locale)}
              />
              <HistoryDetail
                label={dict.symbolHistory.realizedPnlLabel}
                value={transaction.realizedPnlAmount === null
                  ? dict.symbolHistory.noRealizedPnl
                  : formatCurrencyAmount(transaction.realizedPnlAmount, transaction.realizedPnlCurrency ?? transaction.priceCurrency, locale)}
                valueClassName={getRealizedPnlTone(transaction.realizedPnlAmount)}
              />
              <HistoryDetail label={dict.symbolHistory.feeProfileLabel} value={transaction.feeProfileName} />
            </dl>
          </article>
        ))}
      </div>
    </Card>
  );
}

function HistoryDetail({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</dt>
      <dd className={cn("mt-1 text-sm font-medium text-slate-100", valueClassName)}>{value}</dd>
    </div>
  );
}

function getRealizedPnlTone(value: number | null): string {
  if (value === null) {
    return "text-slate-100";
  }
  if (value > 0) {
    return "text-emerald-300";
  }
  if (value < 0) {
    return "text-rose-300";
  }
  return "text-slate-100";
}
