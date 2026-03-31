"use client";

import { useState, useMemo } from "react";
import type { InstrumentCatalogItemDto, MonitoredTickerDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import { Lock, RefreshCw, Search, X } from "lucide-react";

interface MonitoredTickersSectionProps {
  monitoredTickers: MonitoredTickerDto[];
  instruments: InstrumentCatalogItemDto[];
  selectedTickers: Set<string>;
  onToggleTicker: (ticker: string) => void;
  onBrowseCatalog: () => void;
  onRetryBackfill: (ticker: string) => void;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string;
  saveSuccess: string;
  onSave: () => void;
  isLoading: boolean;
  dict: AppDictionary;
}

export function MonitoredTickersSection({
  monitoredTickers,
  instruments,
  selectedTickers,
  onToggleTicker,
  onBrowseCatalog,
  onRetryBackfill,
  isDirty,
  isSaving,
  saveError,
  saveSuccess,
  onSave,
  isLoading,
  dict,
}: MonitoredTickersSectionProps) {
  const [search, setSearch] = useState("");

  const positionTickers = useMemo(
    () => monitoredTickers.filter((s) => s.source === "position"),
    [monitoredTickers],
  );

  // Build manual selections with instrument metadata
  const manualTickers = useMemo(() => {
    const instrumentMap = new Map(instruments.map((i) => [i.ticker, i]));
    return [...selectedTickers]
      .map((ticker) => {
        const instrument = instrumentMap.get(ticker);
        return {
          ticker,
          name: instrument?.name ?? null,
          instrumentType: instrument?.instrumentType ?? null,
          barsBackfillStatus: instrument?.barsBackfillStatus ?? null,
        };
      })
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [selectedTickers, instruments]);

  // Filter manual tickers by search
  const filteredManual = useMemo(() => {
    if (!search) return manualTickers;
    const q = search.toLowerCase();
    return manualTickers.filter(
      (s) => s.ticker.toLowerCase().includes(q) || (s.name?.toLowerCase().includes(q) ?? false),
    );
  }, [manualTickers, search]);

  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading...</p>;
  }

  return (
    <div className="space-y-4" data-testid="monitored-tickers-section">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{dict.settings.tickersSectionTitle}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{dict.settings.tickersSectionDescription}</p>
      </div>

      {/* Auto-included from positions */}
      {positionTickers.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-slate-600">{dict.settings.tickersAutoIncludedTitle}</h4>
          <p className="text-xs text-slate-400">{dict.settings.tickersAutoIncludedDescription}</p>
          <div className="space-y-1">
            {positionTickers.map((s) => (
              <div
                key={s.ticker}
                className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-sm"
                data-testid={`position-ticker-${s.ticker}`}
              >
                <Lock className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-mono font-medium text-slate-700">{s.ticker}</span>
                {s.name && <span className="text-slate-500">— {s.name}</span>}
                <span className="ml-auto text-xs text-slate-400">{dict.settings.tickersPositionLocked}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Your selections */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-slate-600">{dict.settings.tickersYourSelectionsTitle}</h4>

        {/* Search filter */}
        <div className="relative">
          <Search className="absolute left-[1.375rem] top-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={dict.settings.tickersSearchPlaceholder}
            className={`${fieldClassName} !pl-12`}
            data-testid="tickers-search"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {filteredManual.length === 0 && !search ? (
          <p className="py-3 text-center text-xs text-slate-400">{dict.settings.tickersYourSelectionsEmpty}</p>
        ) : (
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {filteredManual.map((s) => (
              <label
                key={s.ticker}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-slate-50"
                data-testid={`manual-ticker-${s.ticker}`}
              >
                <input
                  type="checkbox"
                  checked
                  onChange={() => onToggleTicker(s.ticker)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span className="font-mono font-medium text-slate-700">{s.ticker}</span>
                {s.name && <span className="text-slate-500">— {s.name}</span>}
                {s.barsBackfillStatus && (
                  <span className="ml-auto flex items-center gap-1">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      s.barsBackfillStatus === "ready"
                        ? "bg-green-50 text-green-700"
                        : s.barsBackfillStatus === "failed"
                          ? "bg-red-50 text-red-700"
                          : s.barsBackfillStatus === "backfilling"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-slate-100 text-slate-500"
                    }`}
                      data-testid={`backfill-badge-${s.ticker}`}
                    >
                      {s.barsBackfillStatus}
                    </span>
                    {s.barsBackfillStatus === "failed" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onRetryBackfill(s.ticker);
                        }}
                        className="rounded p-0.5 text-red-500 hover:bg-red-50 hover:text-red-700"
                        title="Retry backfill"
                        data-testid={`retry-backfill-${s.ticker}`}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Browse catalog button */}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onBrowseCatalog}
        data-testid="browse-catalog-btn"
      >
        {dict.settings.tickersBrowseCatalog}
      </Button>

      {/* Save footer */}
      <div className="flex items-center gap-3 border-t border-slate-200 pt-3">
        <Button
          type="button"
          size="sm"
          disabled={!isDirty || isSaving}
          onClick={onSave}
          data-testid="tickers-save-btn"
        >
          {isSaving ? dict.settings.tickersSaving : dict.settings.tickersSaveSelections}
        </Button>
        {saveSuccess && <span className="text-xs text-green-600">{dict.settings.tickersSaved}</span>}
        {saveError && <span className="text-xs text-red-600">{dict.settings.tickersSaveError}</span>}
      </div>
    </div>
  );
}
