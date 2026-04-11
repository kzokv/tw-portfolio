"use client";

import { useCallback, useState } from "react";
import type { LocaleCode } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { formatCurrencyAmount, formatDateLabel } from "../../../lib/utils";
import { useEventStream } from "../../../hooks/useEventStream";
import { fetchCashLedgerEntries } from "../services/cashLedgerService";
import type {
  CashLedgerEntryType,
  CashLedgerListResponse,
  CashLedgerSummary,
  EnrichedCashLedgerEntry,
} from "../types";
import { CashLedgerDrawer } from "./CashLedgerDrawer";
import { Card } from "../../../components/ui/Card";

interface CashLedgerClientProps {
  initialData: CashLedgerListResponse;
  dict: AppDictionary;
  locale: LocaleCode;
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

export function CashLedgerClient({ initialData, dict, locale }: CashLedgerClientProps) {
  const [entries, setEntries] = useState<EnrichedCashLedgerEntry[]>(initialData.entries);
  const [summary, setSummary] = useState<CashLedgerSummary[]>(initialData.summary);
  const [drawerEntry, setDrawerEntry] = useState<EnrichedCashLedgerEntry | null>(null);

  // Filters
  const [fromEntryDate, setFromEntryDate] = useState("");
  const [toEntryDate, setToEntryDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [entryTypeFilter, setEntryTypeFilter] = useState<CashLedgerEntryType[]>([]);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchCashLedgerEntries({
        fromEntryDate: fromEntryDate || undefined,
        toEntryDate: toEntryDate || undefined,
        accountId: accountId || undefined,
        entryType: entryTypeFilter.length > 0 ? entryTypeFilter : undefined,
      });
      setEntries(data.entries);
      setSummary(data.summary);
    } catch {
      // Keep current data on error
    }
  }, [fromEntryDate, toEntryDate, accountId, entryTypeFilter]);

  // SSE: pre-connect pattern (always enabled)
  useEventStream({
    enabled: true,
    eventTypes: ["recompute_complete", "dividend_posted", "dividend_updated"],
    onEvent: () => { void refresh(); },
  });

  // Derive unique accounts from current entries for account filter
  const accountOptions = Array.from(
    new Map(entries.map((e) => [e.accountId, e.accountId])).values(),
  );

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    void refresh();
  }

  function toggleEntryType(type: CashLedgerEntryType) {
    setEntryTypeFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  const d = dict.cashLedger;

  return (
    <div className="grid gap-6">
      {/* Filter toolbar */}
      <Card data-testid="cash-ledger-filter-toolbar">
        <form onSubmit={handleFilterSubmit} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[8rem]">
            <label className="mb-1 block text-xs font-medium text-slate-500">{d.filterDateFrom}</label>
            <input
              type="date"
              value={fromEntryDate}
              onChange={(e) => setFromEntryDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div className="min-w-[8rem]">
            <label className="mb-1 block text-xs font-medium text-slate-500">{d.filterDateTo}</label>
            <input
              type="date"
              value={toEntryDate}
              onChange={(e) => setToEntryDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div className="min-w-[8rem]">
            <label className="mb-1 block text-xs font-medium text-slate-500">{d.filterAccount}</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">—</option>
              {accountOptions.map((id) => (
                <option key={id} value={id}>{id}</option>
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
                  onClick={() => toggleEntryType(type)}
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
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
          >
            {d.applyFilter}
          </button>
        </form>
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
                {s.accountId} / {s.currency}
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
        <Card className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="cash-ledger-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-3">{d.columnDate}</th>
                <th className="px-3 py-3">{d.columnType}</th>
                <th className="px-3 py-3">{d.columnTicker}</th>
                <th className="px-3 py-3">{d.columnSide}</th>
                <th className="px-3 py-3 text-right">{d.columnAmount}</th>
                <th className="px-3 py-3">{d.columnCurrency}</th>
                <th className="px-3 py-3">{d.columnAccount}</th>
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
                  <td className="px-3 py-3 whitespace-nowrap">{entryTypeLabel(entry.entryType, dict)}</td>
                  <td className="px-3 py-3 whitespace-nowrap font-medium">{entry.ticker ?? "—"}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{entry.side ?? "—"}</td>
                  <td className={`px-3 py-3 whitespace-nowrap text-right font-medium ${entry.amount >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {formatCurrencyAmount(entry.amount, entry.currency, locale)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-500">{entry.currency}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-500">{entry.accountId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
