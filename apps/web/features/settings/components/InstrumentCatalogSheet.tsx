"use client";

import { useState, useMemo } from "react";
import type { InstrumentCatalogItemDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import { ArrowLeft, Lock, Search, X } from "lucide-react";

type TypeFilter = "ALL" | "STOCK" | "ETF" | "BOND_ETF";

interface InstrumentCatalogSheetProps {
  instruments: InstrumentCatalogItemDto[];
  selectedTickers: Set<string>;
  positionTickers: Set<string>;
  onToggleTicker: (ticker: string) => void;
  onBack: () => void;
  dict: AppDictionary;
}

export function InstrumentCatalogSheet({
  instruments,
  selectedTickers,
  positionTickers,
  onToggleTicker,
  onBack,
  dict,
}: InstrumentCatalogSheetProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");

  const filtered = useMemo(() => {
    let results = instruments;
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (i) => i.ticker.toLowerCase().includes(q) || (i.name?.toLowerCase().includes(q) ?? false),
      );
    }
    if (typeFilter !== "ALL") {
      results = results.filter((i) => i.instrumentType === typeFilter);
    }
    return results;
  }, [instruments, search, typeFilter]);

  const filters: { value: TypeFilter; label: string }[] = [
    { value: "ALL", label: dict.settings.symbolsFilterAll },
    { value: "STOCK", label: dict.settings.symbolsFilterStock },
    { value: "ETF", label: dict.settings.symbolsFilterEtf },
    { value: "BOND_ETF", label: dict.settings.symbolsFilterBondEtf },
  ];

  return (
    <div className="flex h-full flex-col" data-testid="instrument-catalog-sheet">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          data-testid="catalog-back-btn"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h3 className="text-sm font-semibold text-slate-800">{dict.settings.symbolsCatalogTitle}</h3>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-[1.375rem] top-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={dict.settings.symbolsSearchPlaceholder}
            className={`${fieldClassName} !pl-12`}
            data-testid="catalog-search"
            autoFocus
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
        <div className="inline-flex gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTypeFilter(f.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                typeFilter === f.value
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
              data-testid={`catalog-filter-${f.value.toLowerCase()}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <p className="mb-2 text-xs text-slate-400">
        {filtered.length} instrument{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Instrument list */}
      <div className="flex-1 overflow-y-auto" data-testid="catalog-list">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No instruments found.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((instrument) => {
              const isPosition = positionTickers.has(instrument.ticker);
              const isSelected = selectedTickers.has(instrument.ticker);
              const isChecked = isPosition || isSelected;

              return (
                <label
                  key={instrument.ticker}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-slate-50 ${
                    isPosition ? "cursor-default opacity-80" : ""
                  }`}
                  data-testid={`catalog-item-${instrument.ticker}`}
                >
                  {isPosition ? (
                    <Lock className="h-4 w-4 shrink-0 text-slate-400" />
                  ) : (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggleTicker(instrument.ticker)}
                      className="h-4 w-4 shrink-0 rounded border-slate-300"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-800">
                        {instrument.ticker}
                      </span>
                      <span className="truncate text-xs text-slate-500">
                        {instrument.name ?? "—"}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                    {instrument.instrumentType}
                  </span>
                  {isPosition && (
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {dict.settings.symbolsPositionLocked}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
