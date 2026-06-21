"use client";

import Link from "next/link";
import type { LocaleCode, TransactionHistoryItemDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { transactionAccountDisplayName } from "../chatgpt/accountDisplay";
import { RealizedPnlBreakdownInline, RealizedPnlValue } from "../portfolio/RealizedPnlBreakdown";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { holdingsFinanceToneClass } from "../holdings/holdingsStyle";
import type {
  TransactionHistorySortBy,
  TransactionHistorySortOrder,
} from "../../features/portfolio/transactionHistoryRouteState";

export interface TransactionHistoryTableProps {
  dict: AppDictionary;
  items: TransactionHistoryItemDto[];
  locale: LocaleCode;
  mode: "compact" | "full";
  onSort?: (field: TransactionHistorySortBy) => void;
  sortBy?: TransactionHistorySortBy;
  sortOrder?: TransactionHistorySortOrder;
  tableTestId?: string;
}

export function TransactionHistoryTable({
  dict,
  items,
  locale,
  mode,
  onSort,
  sortBy,
  sortOrder,
  tableTestId = "transaction-history-table",
}: TransactionHistoryTableProps) {
  const isFull = mode === "full";
  const columns = isFull
    ? buildFullColumns(dict, locale, onSort, sortBy, sortOrder)
    : buildCompactColumns(dict, locale);

  return (
    <DataTable
      data={items}
      columns={columns}
      rowKey={(item) => item.id}
      rowTestId={(item) => `${tableTestId}-row-${item.id}`}
      data-testid={tableTestId}
      stickyFirstColumn
      tableClassName={isFull ? "min-w-[980px]" : undefined}
      mobileRow={(item) => (
        <article className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <TickerLink item={item} className="text-lg" />
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDateLabel(item.tradeDate, locale)}
                {isFull ? ` · ${item.marketCode}` : ""}
              </p>
            </div>
            <TypePill type={item.type} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <HistoryDetail label={dict.holdings.accountTerm} value={transactionAccountDisplayName(item)} />
            <HistoryDetail label={dict.transactions.quantityTerm} value={formatNumber(item.quantity, locale)} />
            <HistoryDetail label={dict.transactions.unitPriceTerm} value={formatCurrencyAmount(item.unitPrice, item.priceCurrency, locale)} />
            <HistoryDetail label={dict.tickerHistory.commissionLabel} value={formatCurrencyAmount(item.commissionAmount, item.priceCurrency, locale)} />
            {isFull ? (
              <HistoryDetail label={dict.tickerHistory.taxLabel} value={formatCurrencyAmount(item.taxAmount, item.priceCurrency, locale)} />
            ) : null}
            <HistoryDetail
              label={dict.tickerHistory.realizedPnlLabel}
              value={item.realizedPnlAmount === null
                ? dict.tickerHistory.noRealizedPnl
                : formatCurrencyAmount(item.realizedPnlAmount, item.realizedPnlCurrency ?? item.priceCurrency, locale)}
              valueClassName={getRealizedPnlTone(item.realizedPnlAmount)}
            />
          </dl>
          {item.type === "SELL" ? (
            <RealizedPnlBreakdownInline
              breakdown={item.realizedPnlBreakdown ?? null}
              dict={dict}
              locale={locale}
            />
          ) : null}
        </article>
      )}
      emptyState={
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-5 py-8 text-sm text-muted-foreground">
          {dict.transactions.historyEmpty}
        </div>
      }
    />
  );
}

function buildCompactColumns(
  dict: AppDictionary,
  locale: LocaleCode,
): DataTableColumn<TransactionHistoryItemDto>[] {
  return [
    {
      key: "ticker",
      header: dict.transactions.tickerTerm,
      render: (item) => <TickerLink item={item} />,
    },
    {
      key: "type",
      header: dict.transactions.typeTerm,
      render: (item) => <TypePill type={item.type} />,
    },
    {
      key: "account",
      header: dict.holdings.accountTerm,
      render: (item) => <span className="text-muted-foreground">{transactionAccountDisplayName(item)}</span>,
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
        <RealizedPnlValue
          amount={item.realizedPnlAmount}
          breakdown={item.type === "SELL" ? item.realizedPnlBreakdown ?? null : null}
          currency={item.realizedPnlCurrency ?? item.priceCurrency}
          dict={dict}
          locale={locale}
          toneClassName={getRealizedPnlTone(item.realizedPnlAmount)}
        />
      ),
      cellClassName: "text-right",
    },
  ];
}

function buildFullColumns(
  dict: AppDictionary,
  locale: LocaleCode,
  onSort?: (field: TransactionHistorySortBy) => void,
  sortBy?: TransactionHistorySortBy,
  sortOrder?: TransactionHistorySortOrder,
): DataTableColumn<TransactionHistoryItemDto>[] {
  return [
    {
      key: "tradeDate",
      header: <SortButton active={sortBy === "tradeDate"} field="tradeDate" label={dict.tickerHistory.tradeDateLabel} onSort={onSort} sortOrder={sortOrder} />,
      render: (item) => <span className="text-muted-foreground">{formatDateLabel(item.tradeDate, locale)}</span>,
    },
    {
      key: "ticker",
      header: <SortButton active={sortBy === "ticker"} field="ticker" label={dict.transactions.tickerTerm} onSort={onSort} sortOrder={sortOrder} />,
      render: (item) => (
        <div className="min-w-0">
          <TickerLink item={item} />
          <p className="mt-1 text-xs text-muted-foreground">{item.marketCode}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: <SortButton active={sortBy === "type"} field="type" label={dict.transactions.typeTerm} onSort={onSort} sortOrder={sortOrder} />,
      render: (item) => <TypePill type={item.type} />,
    },
    {
      key: "account",
      header: <SortButton active={sortBy === "account"} field="account" label={dict.holdings.accountTerm} onSort={onSort} sortOrder={sortOrder} />,
      render: (item) => <span className="text-muted-foreground">{transactionAccountDisplayName(item)}</span>,
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
      key: "commission",
      header: dict.tickerHistory.commissionLabel,
      render: (item) => <span className="text-right">{formatCurrencyAmount(item.commissionAmount, item.priceCurrency, locale)}</span>,
      cellClassName: "text-right",
    },
    {
      key: "tax",
      header: dict.tickerHistory.taxLabel,
      render: (item) => <span className="text-right">{formatCurrencyAmount(item.taxAmount, item.priceCurrency, locale)}</span>,
      cellClassName: "text-right",
    },
    {
      key: "realizedPnl",
      header: <SortButton active={sortBy === "realizedPnl"} field="realizedPnl" label={dict.tickerHistory.realizedPnlLabel} onSort={onSort} sortOrder={sortOrder} />,
      render: (item) => (
        <RealizedPnlValue
          amount={item.realizedPnlAmount}
          breakdown={item.type === "SELL" ? item.realizedPnlBreakdown ?? null : null}
          currency={item.realizedPnlCurrency ?? item.priceCurrency}
          dict={dict}
          locale={locale}
          toneClassName={getRealizedPnlTone(item.realizedPnlAmount)}
        />
      ),
      cellClassName: "text-right",
    },
  ];
}

function SortButton({
  active,
  field,
  label,
  onSort,
  sortOrder,
}: {
  active: boolean;
  field: TransactionHistorySortBy;
  label: string;
  onSort?: (field: TransactionHistorySortBy) => void;
  sortOrder?: TransactionHistorySortOrder;
}) {
  return (
    <button
      type="button"
      className={cn("inline-flex items-center gap-1 text-left", active ? "text-foreground" : "text-muted-foreground")}
      onClick={() => onSort?.(field)}
    >
      <span>{label}</span>
      <span aria-hidden="true">{active ? (sortOrder === "asc" ? "↑" : "↓") : ""}</span>
    </button>
  );
}

function TickerLink({ item, className }: { item: TransactionHistoryItemDto; className?: string }) {
  return (
    <Link
      href={`/tickers/${encodeURIComponent(item.ticker)}?marketCode=${encodeURIComponent(item.marketCode)}&accountId=${encodeURIComponent(item.accountId)}`}
      className={cn("font-semibold text-foreground underline decoration-primary/30 underline-offset-4 transition hover:text-primary", className)}
    >
      {item.ticker}
    </Link>
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
  return holdingsFinanceToneClass(value, "text-foreground");
}
