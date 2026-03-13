import Link from "next/link";
import type { LocaleCode, TransactionHistoryItemDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { Card } from "../ui/Card";

interface RecentTransactionsCardProps {
  items: TransactionHistoryItemDto[];
  locale: LocaleCode;
  dict: AppDictionary;
  isLoading: boolean;
  errorMessage: string;
}

export function RecentTransactionsCard({
  items,
  locale,
  dict,
  isLoading,
  errorMessage,
}: RecentTransactionsCardProps) {
  return (
    <Card className="border border-slate-200/80 bg-[rgba(255,255,255,0.96)]" data-testid="recent-transactions-card">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500/78">{dict.transactions.recentLedgerTitle}</p>
      <h2 className="mt-2 text-2xl text-slate-950">{dict.transactions.recentLedgerTitle}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{dict.transactions.recentLedgerDescription}</p>

      {errorMessage ? (
        <div className="mt-5 rounded-[20px] border border-[rgba(251,113,133,0.24)] bg-[rgba(254,226,226,0.92)] px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-6 grid gap-3" aria-hidden="true">
          <div className="skeleton-line h-14 rounded-[18px]" />
          <div className="skeleton-line skeleton-line--delay h-14 rounded-[18px]" />
          <div className="skeleton-line h-14 rounded-[18px]" />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-[22px] border border-dashed border-slate-300 bg-slate-50/90 px-5 py-8 text-sm text-slate-600">
          {dict.transactions.recentLedgerEmpty}
        </div>
      ) : (
        <>
          <div className="mt-6 hidden overflow-hidden rounded-[22px] border border-slate-200 bg-white/92 lg:block">
            <table className="min-w-full border-collapse text-sm text-slate-700" data-testid="recent-transactions-table">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  <th className="px-4 py-3 text-left font-medium">{dict.transactions.symbolTerm}</th>
                  <th className="px-4 py-3 text-left font-medium">{dict.transactions.typeTerm}</th>
                  <th className="px-4 py-3 text-left font-medium">{dict.symbolHistory.tradeDateLabel}</th>
                  <th className="px-4 py-3 text-right font-medium">{dict.transactions.quantityTerm}</th>
                  <th className="px-4 py-3 text-right font-medium">{dict.transactions.unitPriceTerm}</th>
                  <th className="px-4 py-3 text-right font-medium">{dict.symbolHistory.realizedPnlLabel}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-200 last:border-0">
                    <td className="px-4 py-4 font-semibold text-slate-950">
                      <Link
                        href={`/symbols/${encodeURIComponent(item.symbol)}?accountId=${encodeURIComponent(item.accountId)}`}
                        className="underline decoration-indigo-200 underline-offset-4 transition hover:text-indigo-600 hover:decoration-indigo-400"
                      >
                        {item.symbol}
                      </Link>
                    </td>
                    <td className="px-4 py-4">
                      <TypePill type={item.type} />
                    </td>
                    <td className="px-4 py-4 text-slate-600">{formatDateLabel(item.tradeDate, locale)}</td>
                    <td className="px-4 py-4 text-right">{formatNumber(item.quantity, locale)}</td>
                    <td className="px-4 py-4 text-right">{formatCurrencyAmount(item.unitPrice, item.priceCurrency, locale)}</td>
                    <td className={cn("px-4 py-4 text-right font-medium", getRealizedPnlTone(item.realizedPnlAmount))}>
                      {item.realizedPnlAmount === null
                        ? dict.symbolHistory.noRealizedPnl
                        : formatCurrencyAmount(item.realizedPnlAmount, item.realizedPnlCurrency ?? item.priceCurrency, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-3 lg:hidden">
            {items.map((item) => (
              <article key={item.id} className="rounded-[22px] border border-slate-200 bg-white/92 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/symbols/${encodeURIComponent(item.symbol)}?accountId=${encodeURIComponent(item.accountId)}`}
                      className="text-lg font-semibold text-slate-950 underline decoration-indigo-200 underline-offset-4"
                    >
                      {item.symbol}
                    </Link>
                    <p className="mt-1 text-sm text-slate-500">{formatDateLabel(item.tradeDate, locale)}</p>
                  </div>
                  <TypePill type={item.type} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <HistoryDetail label={dict.transactions.quantityTerm} value={formatNumber(item.quantity, locale)} />
                  <HistoryDetail label={dict.transactions.unitPriceTerm} value={formatCurrencyAmount(item.unitPrice, item.priceCurrency, locale)} />
                  <HistoryDetail label={dict.holdings.accountTerm} value={item.accountId} />
                  <HistoryDetail
                    label={dict.symbolHistory.realizedPnlLabel}
                    value={item.realizedPnlAmount === null
                      ? dict.symbolHistory.noRealizedPnl
                      : formatCurrencyAmount(item.realizedPnlAmount, item.realizedPnlCurrency ?? item.priceCurrency, locale)}
                    valueClassName={getRealizedPnlTone(item.realizedPnlAmount)}
                  />
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function TypePill({ type }: { type: TransactionHistoryItemDto["type"] }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]",
        type === "BUY"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-rose-200 bg-rose-50 text-rose-700",
      )}
    >
      {type}
    </span>
  );
}

function HistoryDetail({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className={cn("mt-1 text-sm font-medium text-slate-900", valueClassName)}>{value}</dd>
    </div>
  );
}

function getRealizedPnlTone(value: number | null): string {
  if (value === null) {
    return "text-slate-900";
  }
  if (value > 0) {
    return "text-emerald-600";
  }
  if (value < 0) {
    return "text-rose-600";
  }
  return "text-slate-900";
}
