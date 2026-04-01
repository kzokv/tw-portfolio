"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AppDictionary } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { fieldClassName } from "../ui/fieldStyles";
import {
  filterInstrumentCatalog,
  useInstrumentCatalog,
  type TransactionInstrumentOption,
} from "../../features/portfolio/hooks/useInstrumentCatalog";

interface InstrumentComboboxProps {
  value: string;
  dict: AppDictionary;
  onSelect: (ticker: string) => void;
  readOnly?: boolean;
}

export function InstrumentCombobox({
  value,
  dict,
  onSelect,
  readOnly = false,
}: InstrumentComboboxProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const normalizedValue = value.trim().toUpperCase();
  const { catalog, isLoading, error } = useInstrumentCatalog();
  const selectedInstrument = catalog.find((instrument) => instrument.ticker === normalizedValue) ?? null;
  const committedValue = selectedInstrument ? formatInstrumentDisplay(selectedInstrument) : normalizedValue;
  const [inputValue, setInputValue] = useState(committedValue);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => filterInstrumentCatalog(catalog, query), [catalog, query]);
  const activeOption = filtered.items[activeIndex] ?? null;

  useEffect(() => {
    if (!isOpen) {
      setInputValue(committedValue);
    }
  }, [committedValue, isOpen]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (filtered.items.length === 0) {
        return 0;
      }
      return Math.min(current, filtered.items.length - 1);
    });
  }, [filtered.items.length]);

  useEffect(() => {
    function resetToCommitted() {
      setIsOpen(false);
      setQuery("");
      setActiveIndex(0);
      setInputValue(committedValue);
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        resetToCommitted();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [committedValue]);

  function closeAndReset() {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(0);
    setInputValue(committedValue);
  }

  function openList() {
    if (readOnly) {
      return;
    }
    setInputValue("");
    setQuery("");
    setActiveIndex(0);
    setIsOpen(true);
  }

  function commitSelection(instrument: TransactionInstrumentOption) {
    onSelect(instrument.ticker);
    setInputValue(formatInstrumentDisplay(instrument));
    setQuery("");
    setActiveIndex(0);
    setIsOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (readOnly) {
      return;
    }

    if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openList();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(filtered.items.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeOption) {
      event.preventDefault();
      commitSelection(activeOption);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeAndReset();
    }
  }

  const statusMessage = error
    ? error
    : filtered.total === 0
      ? (catalog.length === 0 && !isLoading
        ? dict.transactions.tickerEmptyCatalog
        : dict.transactions.tickerNoMatches.replace("{query}", query))
      : dict.transactions.tickerMatchCount
        .replace("{shown}", String(filtered.items.length))
        .replace("{total}", String(filtered.total));

  return (
    <div ref={rootRef} className="relative space-y-2">
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-activedescendant={isOpen && activeOption ? optionId(listboxId, activeOption.ticker) : undefined}
        aria-readonly={readOnly || undefined}
        readOnly={readOnly}
        value={inputValue}
        placeholder={dict.transactions.tickerPlaceholder}
        onFocus={openList}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
            closeAndReset();
          }
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          setInputValue(nextValue);
          setQuery(nextValue);
          setActiveIndex(0);
          setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          fieldClassName,
          readOnly && "cursor-not-allowed bg-slate-100 text-slate-500",
        )}
        data-testid="tx-ticker-combobox"
      />

      {isOpen ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-20 max-h-80 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
          data-testid="tx-ticker-listbox"
        >
          {isLoading ? (
            <p className="px-3 py-2 text-sm text-slate-500">{dict.transactions.tickerHint}</p>
          ) : filtered.items.length > 0 ? (
            <>
              <div className="space-y-1">
                {filtered.items.map((instrument, index) => (
                  <button
                    key={instrument.ticker}
                    id={optionId(listboxId, instrument.ticker)}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    tabIndex={-1}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition",
                      index === activeIndex ? "bg-slate-900 text-white" : "text-slate-900 hover:bg-slate-100",
                    )}
                    data-testid={`tx-ticker-option-${instrument.ticker}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commitSelection(instrument)}
                  >
                    <span className="w-16 shrink-0 font-mono text-sm">{instrument.ticker}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{instrument.name ?? instrument.ticker}</span>
                    <span className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]",
                      index === activeIndex ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500",
                    )}>
                      {formatInstrumentTypeLabel(instrument.instrumentType)}
                    </span>
                  </button>
                ))}
              </div>
              <p className="px-3 pt-2 text-xs text-slate-500" data-testid="tx-ticker-match-count">
                {statusMessage}
              </p>
            </>
          ) : (
            <p className="px-3 py-2 text-sm text-slate-500" data-testid="tx-ticker-empty-state">
              {statusMessage}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatInstrumentDisplay(instrument: { ticker: string; name: string | null }): string {
  return instrument.name ? `${instrument.ticker} — ${instrument.name}` : instrument.ticker;
}

function formatInstrumentTypeLabel(instrumentType: TransactionInstrumentOption["instrumentType"]): string {
  if (instrumentType === "STOCK") {
    return "Stock";
  }

  if (instrumentType === "BOND_ETF") {
    return "Bond ETF";
  }

  return "ETF";
}

function optionId(listboxId: string, ticker: string): string {
  return `${listboxId}-${ticker}`;
}
