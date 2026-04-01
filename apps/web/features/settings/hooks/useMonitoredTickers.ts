"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InstrumentCatalogItemDto, MonitoredTickerDto } from "@tw-portfolio/shared-types";
import { useEventStream } from "../../../hooks/useEventStream";
import {
  fetchInstrumentsCatalog,
  fetchMonitoredTickers,
  retryBackfill,
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
  /** Retry backfill for a failed ticker */
  retryTicker: (ticker: string) => Promise<void>;
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

  // SSE: listen for backfill events and update badge status (pre-connect pattern)
  const handleBackfillEvent = useCallback((data: unknown) => {
    const event = data as { type: string; ticker: string; barsCount?: number; dividendsCount?: number };
    if (!event.ticker) return;

    const updateStatus = (ticker: string, status: string) => {
      setMonitoredTickers((prev) =>
        prev.map((t) => (t.ticker === ticker ? { ...t, barsBackfillStatus: status } : t)),
      );
      setInstruments((prev) =>
        prev.map((i) => (i.ticker === ticker ? { ...i, barsBackfillStatus: status } : i)),
      );
    };

    switch (event.type) {
      case "backfill_started":
        updateStatus(event.ticker, "backfilling");
        break;
      case "backfill_complete":
        updateStatus(event.ticker, "ready");
        break;
      case "backfill_failed":
        updateStatus(event.ticker, "failed");
        break;
      case "daily_refresh_complete":
        updateStatus(event.ticker, "ready");
        break;
      case "daily_refresh_failed":
        updateStatus(event.ticker, "failed");
        break;
    }
  }, []);

  useEventStream({
    eventTypes: ["backfill_started", "backfill_complete", "backfill_failed", "daily_refresh_complete", "daily_refresh_failed"],
    onEvent: handleBackfillEvent,
    enabled: true,
  });

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

  const retryTicker = useCallback(async (ticker: string) => {
    // Optimistic update: set badge to pending
    setMonitoredTickers((prev) =>
      prev.map((t) => (t.ticker === ticker ? { ...t, barsBackfillStatus: "pending" } : t)),
    );
    setInstruments((prev) =>
      prev.map((i) => (i.ticker === ticker ? { ...i, barsBackfillStatus: "pending" } : i)),
    );
    try {
      await retryBackfill(ticker);
    } catch {
      // Revert on failure
      setMonitoredTickers((prev) =>
        prev.map((t) => (t.ticker === ticker ? { ...t, barsBackfillStatus: "failed" } : t)),
      );
      setInstruments((prev) =>
        prev.map((i) => (i.ticker === ticker ? { ...i, barsBackfillStatus: "failed" } : i)),
      );
    }
  }, []);

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
    retryTicker,
  };
}
