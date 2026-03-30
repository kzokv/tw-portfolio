"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InstrumentCatalogItemDto, MonitoredTickerDto } from "@tw-portfolio/shared-types";
import {
  fetchInstrumentsCatalog,
  fetchMonitoredTickers,
  saveMonitoredTickers,
} from "../services/monitoredTickersService";

export interface UseMonitoredTickersReturn {
  /** Full monitored set (manual + position-derived) */
  monitoredTickers: MonitoredTickerDto[];
  /** Full instrument catalog */
  instruments: InstrumentCatalogItemDto[];
  /** Current manual selection tickers (mutable set) */
  selectedTickers: Set<string>;
  /** Whether the catalog is showing (full-screen mode) */
  showCatalog: boolean;
  setShowCatalog: (show: boolean) => void;
  /** Toggle a ticker in the manual selection */
  toggleTicker: (ticker: string) => void;
  /** Whether selections have changed from the saved state */
  isDirty: boolean;
  /** Save current selections */
  save: () => Promise<void>;
  isSaving: boolean;
  saveError: string;
  saveSuccess: string;
  isLoading: boolean;
}

export function useMonitoredTickers(open: boolean): UseMonitoredTickersReturn {
  const [monitoredTickers, setMonitoredTickers] = useState<MonitoredTickerDto[]>([]);
  const [instruments, setInstruments] = useState<InstrumentCatalogItemDto[]>([]);
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set());
  const [savedTickers, setSavedTickers] = useState<Set<string>>(new Set());
  const [showCatalog, setShowCatalog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Fetch data when drawer opens on the tickers tab
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const [tickersRes, catalogRes] = await Promise.all([
          fetchMonitoredTickers(),
          fetchInstrumentsCatalog(),
        ]);
        if (cancelled) return;
        setMonitoredTickers(tickersRes.tickers);
        setInstruments(catalogRes.instruments);

        // Initialize selected tickers from current manual selections
        const manual = new Set(
          tickersRes.tickers
            .filter((s) => s.source === "manual")
            .map((s) => s.ticker),
        );
        setSelectedTickers(manual);
        setSavedTickers(manual);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [open]);

  const toggleTicker = useCallback((ticker: string) => {
    setSaveError("");
    setSaveSuccess("");
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) {
        next.delete(ticker);
      } else {
        next.add(ticker);
      }
      return next;
    });
  }, []);

  const isDirty = selectedTickers.size !== savedTickers.size ||
    [...selectedTickers].some((t) => !savedTickers.has(t));

  const save = useCallback(async () => {
    setIsSaving(true);
    setSaveError("");
    setSaveSuccess("");
    try {
      const result = await saveMonitoredTickers([...selectedTickers]);
      if (!mounted.current) return;
      setMonitoredTickers(result.tickers);
      setSavedTickers(new Set(selectedTickers));
      setSaveSuccess("saved");
    } catch (err) {
      if (!mounted.current) return;
      setSaveError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (mounted.current) setIsSaving(false);
    }
  }, [selectedTickers]);

  return {
    monitoredTickers,
    instruments,
    selectedTickers,
    showCatalog,
    setShowCatalog,
    toggleTicker,
    isDirty,
    save,
    isSaving,
    saveError,
    saveSuccess,
    isLoading,
  };
}
