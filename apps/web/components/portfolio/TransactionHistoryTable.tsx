"use client";

import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { LocaleCode, TransactionHistoryItemDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import type { TransactionPatch } from "../../features/portfolio/hooks/useTransactionMutations";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { Card } from "../ui/Card";
import { EditableTransactionRow } from "./EditableTransactionRow";
import { useIsSmallScreen } from "../../lib/hooks/use-small-screen";
import { transactionAccountDisplayName } from "../chatgpt/accountDisplay";
import { holdingsFinanceToneClass } from "../holdings/holdingsStyle";
import { RealizedPnlBreakdownInline, RealizedPnlValue } from "./RealizedPnlBreakdown";

interface TransactionHistoryTableProps {
  transactions: TransactionHistoryItemDto[];
  dict: AppDictionary;
  locale: LocaleCode;
  onDeleteRequest?: (transaction: TransactionHistoryItemDto) => void;
  editingId?: string | null;
  onEditStart?: (id: string) => void;
  onEditCancel?: () => void;
  onEditSave?: (transactionId: string, patch: TransactionPatch) => Promise<void>;
  recomputingIds?: Set<string>;
}

export function TransactionHistoryTable({
  transactions,
  dict,
  locale,
  onDeleteRequest,
  editingId,
  onEditStart,
  onEditCancel,
  onEditSave,
  recomputingIds,
}: TransactionHistoryTableProps) {
  const hasMutationActions = !!(onDeleteRequest || onEditStart);
  const isSmallScreen = useIsSmallScreen();

  if (transactions.length === 0) {
    return (
      <Card data-testid="ticker-history-empty">
        <p className="text-sm leading-6 text-muted-foreground">{dict.tickerHistory.emptyState}</p>
      </Card>
    );
  }

  return (
    <Card data-testid="ticker-history-table-section">
      {/* Phase 4 — single-DOM responsive (drops legacy `lg:hidden` mobile cards).
          Card-stack at <sm via useIsSmallScreen; scroll + sticky-date at <md
          otherwise. Same `transaction-row` / `editable-transaction-row` /
          `edit-transaction-button` / `delete-transaction-button` testids in
          both renderings — only one variant is in DOM at a time. */}
      <p className="mb-3 rounded-lg border border-border bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
        {dict.tickerHistory.realizedPnlWeightedAverageNote}
      </p>
      {isSmallScreen ? (
        <div className="grid gap-3">
          {transactions.map((transaction) => {
            const isEditing = editingId === transaction.id;
            const isRecomputing = recomputingIds?.has(transaction.id);

            return (
              <article
                key={transaction.id}
                className={cn(
                  "rounded-xl border border-border bg-card p-4",
                  isRecomputing && "opacity-40",
                )}
                data-testid={isEditing ? "editable-transaction-row" : "transaction-row"}
              >
                {isEditing && onEditSave && onEditCancel ? (
                  <EditableTransactionRow
                    transaction={transaction}
                    locale={locale}
                    dict={dict}
                    onSave={(patch) => onEditSave(transaction.id, patch)}
                    onCancel={onEditCancel}
                    isMobile
                  />
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-foreground">{transaction.ticker}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{formatDateLabel(transaction.tradeDate, locale)}</p>
                      </div>
                      <TypePill type={transaction.type} />
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <HistoryDetail label={dict.holdings.accountTerm} value={transactionAccountDisplayName(transaction)} />
                      <HistoryDetail label={dict.transactions.quantityTerm} value={formatNumber(transaction.quantity, locale)} />
                      <HistoryDetail
                        label={dict.transactions.unitPriceTerm}
                        value={formatCurrencyAmount(transaction.unitPrice, transaction.priceCurrency, locale)}
                      />
                      <HistoryDetail
                        label={dict.tickerHistory.commissionLabel}
                        value={formatCurrencyAmount(transaction.commissionAmount, transaction.priceCurrency, locale)}
                      />
                      <HistoryDetail
                        label={dict.tickerHistory.taxLabel}
                        value={formatCurrencyAmount(transaction.taxAmount, transaction.priceCurrency, locale)}
                      />
                      <HistoryDetailNode
                        label={dict.tickerHistory.realizedPnlLabel}
                        value={transaction.realizedPnlAmount === null
                          ? dict.tickerHistory.noRealizedPnl
                          : formatCurrencyAmount(transaction.realizedPnlAmount, transaction.realizedPnlCurrency ?? transaction.priceCurrency, locale)}
                        valueClassName={getRealizedPnlTone(transaction.realizedPnlAmount)}
                      />
                      <HistoryDetail label={dict.tickerHistory.feeProfileLabel} value={transaction.feeProfileName} />
                    </dl>
                    {transaction.type === "SELL" ? (
                      <RealizedPnlBreakdownInline
                        breakdown={transaction.realizedPnlBreakdown ?? null}
                        dict={dict}
                        locale={locale}
                      />
                    ) : null}

                    {hasMutationActions && (
                      <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
                        {onEditStart && (
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
                            title={dict.mutations.editTooltip}
                            onClick={() => onEditStart(transaction.id)}
                            disabled={isRecomputing}
                            data-testid="edit-transaction-button"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {onDeleteRequest && (
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                            title={dict.mutations.deleteTooltip}
                            onClick={() => onDeleteRequest(transaction)}
                            disabled={isRecomputing}
                            data-testid="delete-transaction-button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto overflow-y-hidden rounded-xl border border-border bg-card">
          <table className="min-w-[1080px] border-collapse text-sm text-muted-foreground" data-testid="ticker-history-table">
            <thead>
              <tr className="bg-muted/50 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <th className="sticky left-0 z-10 bg-muted/50 border-r border-border md:static md:bg-transparent md:border-r-0 px-4 py-3 text-left font-medium">{dict.tickerHistory.tradeDateLabel}</th>
                <th className="px-4 py-3 text-left font-medium">{dict.holdings.accountTerm}</th>
                <th className="px-4 py-3 text-left font-medium">{dict.transactions.typeTerm}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.transactions.quantityTerm}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.transactions.unitPriceTerm}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.tickerHistory.commissionLabel}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.tickerHistory.taxLabel}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.tickerHistory.realizedPnlLabel}</th>
                <th className="px-4 py-3 text-left font-medium">{dict.tickerHistory.feeProfileLabel}</th>
                <th className="px-4 py-3 text-left font-medium">{dict.tickerHistory.bookedAtLabel}</th>
                {hasMutationActions && (
                  <th className="px-4 py-3 text-center font-medium">{dict.mutations.actionsColumnLabel}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => {
                const isEditing = editingId === transaction.id;
                const isRecomputing = recomputingIds?.has(transaction.id);

                if (isEditing && onEditSave && onEditCancel) {
                  return (
                    <tr key={transaction.id} className="border-b border-border last:border-0 bg-primary/5" data-testid="editable-transaction-row">
                      <EditableTransactionRow
                        transaction={transaction}
                        locale={locale}
                        dict={dict}
                        onSave={(patch) => onEditSave(transaction.id, patch)}
                        onCancel={onEditCancel}
                      />
                    </tr>
                  );
                }

                return (
                  <tr
                    key={transaction.id}
                    className={cn(
                      "border-b border-border last:border-0",
                      isRecomputing && "opacity-40",
                    )}
                    data-testid="transaction-row"
                  >
                    <td className="sticky left-0 z-10 bg-card border-r border-border md:static md:bg-transparent md:border-r-0 px-4 py-4">{formatDateLabel(transaction.tradeDate, locale)}</td>
                    <td className="px-4 py-4 text-muted-foreground">{transactionAccountDisplayName(transaction)}</td>
                    <td className="px-4 py-4">
                      <TypePill type={transaction.type} />
                    </td>
                    <td className="px-4 py-4 text-right">{formatNumber(transaction.quantity, locale)}</td>
                    <td className="px-4 py-4 text-right">{formatCurrencyAmount(transaction.unitPrice, transaction.priceCurrency, locale)}</td>
                    <td className="px-4 py-4 text-right">{formatCurrencyAmount(transaction.commissionAmount, transaction.priceCurrency, locale)}</td>
                    <td className="px-4 py-4 text-right">{formatCurrencyAmount(transaction.taxAmount, transaction.priceCurrency, locale)}</td>
                    <td className="px-4 py-4 text-right font-medium">
                      <RealizedPnlValue
                        amount={transaction.realizedPnlAmount}
                        breakdown={transaction.type === "SELL" ? transaction.realizedPnlBreakdown ?? null : null}
                        currency={transaction.realizedPnlCurrency ?? transaction.priceCurrency}
                        dict={dict}
                        locale={locale}
                        toneClassName={getRealizedPnlTone(transaction.realizedPnlAmount)}
                      />
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">{transaction.feeProfileName}</td>
                    <td className="px-4 py-4 text-muted-foreground">
                      {transaction.bookedAt ? formatDateLabel(transaction.bookedAt, locale) : dict.tickerHistory.noRealizedPnl}
                    </td>
                    {hasMutationActions && (
                      <td className="px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {onEditStart && (
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
                              title={dict.mutations.editTooltip}
                              onClick={() => onEditStart(transaction.id)}
                              disabled={isRecomputing}
                              data-testid="edit-transaction-button"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {onDeleteRequest && (
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                              title={dict.mutations.deleteTooltip}
                              onClick={() => onDeleteRequest(transaction)}
                              disabled={isRecomputing}
                              data-testid="delete-transaction-button"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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

function HistoryDetailNode({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
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
