"use client";

import { useCallback, useEffect, useState } from "react";
import type { LocaleCode } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { formatCurrencyAmount, formatDateLabel } from "../../../lib/utils";
import { useEventStream } from "../../../hooks/useEventStream";
import { fetchAccounts, fetchCashLedgerEntries } from "../services/cashLedgerService";
import {
  formatAccountOption,
  type AccountOptionInput,
} from "../utils/accountOptions";
import type {
  CashLedgerEntryType,
  CashLedgerListResponse,
  CashLedgerSortColumn,
  CashLedgerSummary,
  EnrichedCashLedgerEntry,
} from "../types";
import { CashLedgerDrawer } from "./CashLedgerDrawer";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";

interface CashLedgerClientProps {
  initialData: CashLedgerListResponse;
  dict: AppDictionary;
  locale: LocaleCode;
}

const PAGE_SIZE = 50;

function SortHeader({
  label,
  field,
  sortBy,
  sortOrder,
  onSort,
}: {
  label: string;
  field: CashLedgerSortColumn;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (field: CashLedgerSortColumn) => void;
}) {
  const isActive = sortBy === field;
  return (
    <th
      className="cursor-pointer px-3 py-3 hover:text-slate-700"
      onClick={() => onSort(field)}
    >
      <span className={isActive ? "text-slate-900 font-semibold" : ""}>
        {label}
        {isActive ? (sortOrder === "asc" ? " \u2191" : " \u2193") : ""}
      </span>
    </th>
  );
}

const ENTRY_TYPE_OPTIONS: CashLedgerEntryType[] = [
  "TRADE_SETTLEMENT_IN",
  "TRADE_SETTLEMENT_OUT",
  "DIVIDEND_RECEIPT",
  "DIVIDEND_DEDUCTION",
  "MANUAL_ADJUSTMENT",
  "REVERSAL",
];

function entryTypeLabel(entryType: CashLedgerEntryType, dict: AppDictionary): string {
  switch (entryType) {
    case "TRADE_SETTLEMENT_IN": return dict.cashLedger.entryTypeTradeSettlementIn;
    case "TRADE_SETTLEMENT_OUT": return dict.cashLedger.entryTypeTradeSettlementOut;
    case "DIVIDEND_RECEIPT": return dict.cashLedger.entryTypeDividendReceipt;
    case "DIVIDEND_DEDUCTION": return dict.cashLedger.entryTypeDividendDeduction;
    case "MANUAL_ADJUSTMENT": return dict.cashLedger.entryTypeManualAdjustment;
    case "REVERSAL": return dict.cashLedger.entryTypeReversal;
  }
}

// KZO-167: the account chip / dropdown label uses `formatAccountOption`
// from `../utils/accountOptions.ts` (extracted so the pure helper can be
// unit-tested at `apps/web/test/features/cash-ledger/accountOptions.test.ts`
// per scope-todo Phase 7). The helper lives outside the i18n dictionary
// per `.claude/rules/nextjs-i18n-serialization.md` — function values
// cannot cross the Next.js server→client boundary inside dictionaries.

export function CashLedgerClient({ initialData, dict, locale }: CashLedgerClientProps) {
  const [entries, setEntries] = useState<EnrichedCashLedgerEntry[]>(initialData.entries);
  const [summary, setSummary] = useState<CashLedgerSummary[]>(initialData.summary);
  const [total, setTotal] = useState(initialData.total ?? 0);
  const [drawerEntry, setDrawerEntry] = useState<EnrichedCashLedgerEntry | null>(null);

  // KZO-167: account chip metadata — name, defaultCurrency, accountType.
  // Empty until the GET /accounts fetch resolves; renders fall back to the
  // raw account ID until populated.
  const [accountMeta, setAccountMeta] = useState<Map<string, AccountOptionInput>>(new Map());

  // Filters
  const [fromEntryDate, setFromEntryDate] = useState("");
  const [toEntryDate, setToEntryDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [entryTypeFilter, setEntryTypeFilter] = useState<CashLedgerEntryType[]>([]);

  // Pagination & sorting
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<CashLedgerSortColumn>("entryDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    void fetchAccounts()
      .then((accounts) => {
        if (cancelled) return;
        const next = new Map<string, AccountOptionInput>();
        for (const account of accounts) {
          next.set(account.id, {
            name: account.name,
            defaultCurrency: account.defaultCurrency,
            accountType: account.accountType,
          });
        }
        setAccountMeta(next);
      })
      .catch(() => {
        // Leave accountMeta empty; dropdown + chips fall back to raw IDs.
      });
    return () => { cancelled = true; };
  }, []);

  const renderAccountLabel = useCallback(
    (id: string): string => {
      const meta = accountMeta.get(id);
      if (!meta) return id;
      return formatAccountOption(meta, {
        accountTypeBroker: dict.cashLedger.accountTypeBroker,
        accountTypeBank: dict.cashLedger.accountTypeBank,
        accountTypeWallet: dict.cashLedger.accountTypeWallet,
      });
    },
    [accountMeta, dict],
  );

  const fetchData = useCallback(async (opts: {
    pg?: number;
    sort?: CashLedgerSortColumn;
    order?: "asc" | "desc";
    // Explicit overrides for filter values that may not yet be reflected in
    // the closure (account select onChange, entry-type chip clicks).
    account?: string;
    entryTypes?: CashLedgerEntryType[];
  } = {}) => {
    const pg = opts.pg ?? page;
    const sort = opts.sort ?? sortBy;
    const order = opts.order ?? sortOrder;
    const resolvedAccount = "account" in opts ? (opts.account ?? "") : accountId;
    const resolvedEntryTypes = "entryTypes" in opts ? (opts.entryTypes ?? []) : entryTypeFilter;
    try {
      const data = await fetchCashLedgerEntries({
        fromEntryDate: fromEntryDate || undefined,
        toEntryDate: toEntryDate || undefined,
        accountId: resolvedAccount || undefined,
        entryType: resolvedEntryTypes.length > 0 ? resolvedEntryTypes : undefined,
        page: pg,
        sortBy: sort,
        sortOrder: order,
        limit: PAGE_SIZE,
      });
      const newTotal = data.total ?? 0;
      const newTotalPages = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
      if (pg > newTotalPages) {
        // Result set shrank under the current page (e.g. SSE refresh removed entries).
        // Clamp to page 1 and re-fetch so the user sees the remaining rows.
        setPage(1);
        void fetchData({ pg: 1, sort, order, account: resolvedAccount, entryTypes: resolvedEntryTypes });
        return;
      }
      // Commit page/sort state only on a successful fetch so that a failed
      // request leaves the controls consistent with the visible data.
      setPage(pg);
      setSortBy(sort);
      setSortOrder(order);
      setEntries(data.entries);
      setSummary(data.summary);
      setTotal(newTotal);
    } catch {
      // Keep current data and UI state on error
    }
  }, [fromEntryDate, toEntryDate, accountId, entryTypeFilter, page, sortBy, sortOrder]);

  // SSE: pre-connect pattern (always enabled)
  useEventStream({
    enabled: true,
    eventTypes: ["recompute_complete", "dividend_posted", "dividend_updated"],
    onEvent: () => { void fetchData(); },
  });

  // Derive unique accounts from summary (full filtered set, not just current page)
  const accountOptions = Array.from(new Set(summary.map((s) => s.accountId)));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSort = useCallback((col: CashLedgerSortColumn) => {
    const nextOrder = col === sortBy
      ? (sortOrder === "asc" ? "desc" : "asc")
      : "desc";
    // State is committed inside fetchData on success, keeping controls
    // consistent with the visible data even when the request fails.
    void fetchData({ pg: 1, sort: col, order: nextOrder });
  }, [sortBy, sortOrder, fetchData]);

  const handlePageChange = useCallback((newPage: number) => {
    void fetchData({ pg: newPage });
  }, [fetchData]);

  // Date inputs: onBlur fires after onChange has already re-rendered the component,
  // so the fetchData closure will already have the latest fromEntryDate/toEntryDate.
  const handleDateBlur = useCallback(() => {
    void fetchData({ pg: 1 });
  }, [fetchData]);

  // Account select: must pass the new value explicitly — the closure is stale
  // until the next render, which happens after this event handler returns.
  const handleAccountChange = useCallback((newAccountId: string) => {
    setAccountId(newAccountId);
    void fetchData({ pg: 1, account: newAccountId });
  }, [fetchData]);

  // Entry-type chips: same stale-closure issue — compute the toggled array and
  // pass it explicitly so the fetch sees the new value immediately.
  const handleEntryTypeToggle = useCallback((type: CashLedgerEntryType) => {
    const newFilter = entryTypeFilter.includes(type)
      ? entryTypeFilter.filter((t) => t !== type)
      : [...entryTypeFilter, type];
    setEntryTypeFilter(newFilter);
    void fetchData({ pg: 1, entryTypes: newFilter });
  }, [entryTypeFilter, fetchData]);

  const d = dict.cashLedger;

  return (
    <div className="grid gap-6">
      {/* Filter toolbar — each control triggers fetch immediately on change */}
      <Card data-testid="cash-ledger-filter-toolbar">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[8rem]">
            <label className="mb-1 block text-xs font-medium text-slate-500">{d.filterDateFrom}</label>
            <input
              type="date"
              value={fromEntryDate}
              onChange={(e) => setFromEntryDate(e.target.value)}
              onBlur={handleDateBlur}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div className="min-w-[8rem]">
            <label className="mb-1 block text-xs font-medium text-slate-500">{d.filterDateTo}</label>
            <input
              type="date"
              value={toEntryDate}
              onChange={(e) => setToEntryDate(e.target.value)}
              onBlur={handleDateBlur}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div className="min-w-[8rem]">
            <label className="mb-1 block text-xs font-medium text-slate-500">{d.filterAccount}</label>
            <select
              value={accountId}
              onChange={(e) => handleAccountChange(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">—</option>
              {accountOptions.map((id) => (
                <option key={id} value={id}>{renderAccountLabel(id)}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[10rem]">
            <label className="mb-1 block text-xs font-medium text-slate-500">{d.filterEntryType}</label>
            <div className="flex flex-wrap gap-1">
              {ENTRY_TYPE_OPTIONS.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleEntryTypeToggle(type)}
                  className={`rounded-full px-2 py-0.5 text-xs transition ${
                    entryTypeFilter.includes(type)
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  {entryTypeLabel(type, dict)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Summary bar */}
      {summary.length > 0 && (
        <div className="flex flex-wrap gap-3" data-testid="cash-ledger-summary">
          {summary.map((s) => (
            <div
              key={`${s.accountId}:${s.currency}`}
              className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {renderAccountLabel(s.accountId)} / {s.currency}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {d.summaryTotalLabel}: {formatCurrencyAmount(s.amount, s.currency, locale)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {entries.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-500" data-testid="cash-ledger-empty">
            {d.emptyState}
          </p>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Card className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="cash-ledger-table">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <SortHeader label={d.columnDate} field="entryDate" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                    <SortHeader label={d.columnType} field="entryType" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                    <th className="px-3 py-3">{d.columnTicker}</th>
                    <th className="px-3 py-3">{d.columnSide}</th>
                    <SortHeader label={d.columnAmount} field="amount" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                    <SortHeader label={d.columnCurrency} field="currency" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                    <SortHeader label={d.columnAccount} field="accountId" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      data-testid={`cash-ledger-row-${entry.id}`}
                      onClick={() => setDrawerEntry(entry)}
                      className="cursor-pointer border-b border-slate-100 transition hover:bg-slate-50"
                    >
                      <td className="px-3 py-3 whitespace-nowrap">{formatDateLabel(entry.entryDate, locale)}</td>
                      <td className="px-3 py-3">{entryTypeLabel(entry.entryType, dict)}</td>
                      <td className="px-3 py-3 whitespace-nowrap font-medium">{entry.ticker ?? "—"}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{entry.side ?? "—"}</td>
                      <td className={`px-3 py-3 whitespace-nowrap text-right font-medium ${entry.amount >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {formatCurrencyAmount(entry.amount, entry.currency, locale)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-500">{entry.currency}</td>
                      <td className="px-3 py-3 text-slate-500">{entry.accountId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Desktop pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3" data-testid="pagination">
                  <span className="text-sm text-slate-500" data-testid="pagination-info">
                    {d.pagination.page} {page} {d.pagination.of} {totalPages}{d.pagination.totalSuffix}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={page <= 1}
                      onClick={() => handlePageChange(page - 1)}
                      data-testid="pagination-prev"
                    >
                      {d.pagination.previous}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={page >= totalPages}
                      onClick={() => handlePageChange(page + 1)}
                      data-testid="pagination-next"
                    >
                      {d.pagination.next}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Mobile card grid */}
          <div className="grid gap-3 lg:hidden">
            {entries.map((entry) => (
              <Card
                key={entry.id}
                data-testid={`cash-ledger-card-${entry.id}`}
                onClick={() => setDrawerEntry(entry)}
                className="cursor-pointer transition hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">{formatDateLabel(entry.entryDate, locale)}</p>
                    <p className="mt-0.5 text-sm font-medium text-slate-800">{entryTypeLabel(entry.entryType, dict)}</p>
                  </div>
                  <span className={`shrink-0 text-base font-semibold ${entry.amount >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {formatCurrencyAmount(entry.amount, entry.currency, locale)}
                  </span>
                </div>
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                  {entry.ticker && (
                    <div className="flex gap-1">
                      <dt className="sr-only">{d.columnTicker}</dt>
                      <dd className="font-medium text-slate-700">
                        {entry.ticker}{entry.side ? ` · ${entry.side}` : ""}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="sr-only">{d.columnAccount}</dt>
                    <dd>{entry.accountId}</dd>
                  </div>
                </dl>
              </Card>
            ))}

            {/* Mobile pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-1 py-2" data-testid="mobile-pagination">
                <span className="text-sm text-slate-500">
                  {d.pagination.page} {page} {d.pagination.of} {totalPages}{d.pagination.totalSuffix}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => handlePageChange(page - 1)}
                    data-testid="mobile-pagination-prev"
                  >
                    {d.pagination.previous}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= totalPages}
                    onClick={() => handlePageChange(page + 1)}
                    data-testid="mobile-pagination-next"
                  >
                    {d.pagination.next}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Drawer */}
      <CashLedgerDrawer
        entry={drawerEntry}
        onClose={() => setDrawerEntry(null)}
        dict={dict}
        locale={locale}
      />
    </div>
  );
}
