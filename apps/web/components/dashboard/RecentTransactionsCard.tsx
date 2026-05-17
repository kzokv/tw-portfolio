import Link from "next/link";
import type { LocaleCode, TransactionHistoryItemDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { Card } from "../ui/Card";
import { DataTable, type DataTableColumn } from "../ui/DataTable";

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
  // Phase 4 — single-DOM DataTable migration. Card-stack at <sm (per
  // scope-grill); scroll + sticky-first-column at <md.
  const columns: DataTableColumn<TransactionHistoryItemDto>[] = [
    {
      key: "ticker",
      header: dict.transactions.tickerTerm,
      render: (item) => (
        <Link
          href={`/tickers/${encodeURIComponent(item.ticker)}?accountId=${encodeURIComponent(item.accountId)}`}
          className="font-semibold text-foreground underline decoration-primary/30 underline-offset-4 transition hover:text-primary"
        >
          {item.ticker}
        </Link>
      ),
    },
    {
      key: "type",
      header: dict.transactions.typeTerm,
      render: (item) => <TypePill type={item.type} />,
    },
    {
      key: "tradeDate",
      header: dict.tickerHistory.tradeDateLabel,
      render: (item) => <span className="text-muted-foreground">{formatDateLabel(item.tradeDate, locale)}</span>,
    },
    {
      key: "quantity",
      header: dict.transactions.quantityTerm,
      render: (item) => <span className="text-right">{formatNumber(item.quantity, locale)}</span>,
      cellClassName: "text-right",
    },
    {
      key: "unitPrice",
      header: dict.transactions.unitPriceTerm,
      render: (item) => <span className="text-right">{formatCurrencyAmount(item.unitPrice, item.priceCurrency, locale)}</span>,
      cellClassName: "text-right",
    },
    {
      key: "realizedPnl",
      header: dict.tickerHistory.realizedPnlLabel,
      render: (item) => (
        <span className={cn("text-right font-medium", getRealizedPnlTone(item.realizedPnlAmount))}>
          {item.realizedPnlAmount === null
            ? dict.tickerHistory.noRealizedPnl
            : formatCurrencyAmount(item.realizedPnlAmount, item.realizedPnlCurrency ?? item.priceCurrency, locale)}
        </span>
      ),
      cellClassName: "text-right",
    },
  ];

  return (
    <Card className="border border-border bg-card" data-testid="recent-transactions-card">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/78">{dict.transactions.recentLedgerTitle}</p>
      <h2 className="mt-2 text-2xl text-foreground">{dict.transactions.recentLedgerTitle}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{dict.transactions.recentLedgerDescription}</p>

      {errorMessage ? (
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-6 grid gap-3" aria-hidden="true">
          <div className="skeleton-line h-14 rounded-xl" />
          <div className="skeleton-line skeleton-line--delay h-14 rounded-xl" />
          <div className="skeleton-line h-14 rounded-xl" />
        </div>
      ) : (
        <div className="mt-6">
          <DataTable
            data={items}
            columns={columns}
            rowKey={(item) => item.id}
            rowTestId={(item) => `recent-transactions-row-${item.id}`}
            data-testid="recent-transactions-table"
            stickyFirstColumn
            mobileRow={(item) => (
              <article className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/tickers/${encodeURIComponent(item.ticker)}?accountId=${encodeURIComponent(item.accountId)}`}
                      className="text-lg font-semibold text-foreground underline decoration-primary/30 underline-offset-4"
                    >
                      {item.ticker}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">{formatDateLabel(item.tradeDate, locale)}</p>
                  </div>
                  <TypePill type={item.type} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <HistoryDetail label={dict.transactions.quantityTerm} value={formatNumber(item.quantity, locale)} />
                  <HistoryDetail label={dict.transactions.unitPriceTerm} value={formatCurrencyAmount(item.unitPrice, item.priceCurrency, locale)} />
                  <HistoryDetail label={dict.holdings.accountTerm} value={item.accountId} />
                  <HistoryDetail
                    label={dict.tickerHistory.realizedPnlLabel}
                    value={item.realizedPnlAmount === null
                      ? dict.tickerHistory.noRealizedPnl
                      : formatCurrencyAmount(item.realizedPnlAmount, item.realizedPnlCurrency ?? item.priceCurrency, locale)}
                    valueClassName={getRealizedPnlTone(item.realizedPnlAmount)}
                  />
                </dl>
              </article>
            )}
            emptyState={
              <div className="rounded-xl border border-dashed border-border bg-muted/30 px-5 py-8 text-sm text-muted-foreground">
                {dict.transactions.recentLedgerEmpty}
              </div>
            }
          />
        </div>
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
      <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-sm font-medium text-foreground", valueClassName)}>{value}</dd>
    </div>
  );
}

function getRealizedPnlTone(value: number | null): string {
  if (value === null) {
    return "text-foreground";
  }
  if (value > 0) {
    return "text-emerald-600";
  }
  if (value < 0) {
    return "text-rose-600";
  }
  return "text-foreground";
}
