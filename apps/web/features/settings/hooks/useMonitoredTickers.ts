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
import { requestRepair, type RepairTargetRequest } from "../services/repairService";

function monitoredTickerKey(ticker: string, marketCode: string): string {
  return `${ticker}|${marketCode}`;
}

function parseMonitoredTickerKey(key: string): { ticker: string; marketCode: string } {
  const [ticker = "", marketCode = "TW"] = key.split("|");
  return { ticker, marketCode };
}

export interface UseMonitoredTickersReturn {
  monitoredTickers: MonitoredTickerDto[];
  instruments: InstrumentCatalogItemDto[];
  selectedTickers: Set<string>;
  showCatalog: boolean;
  setShowCatalog: (show: boolean) => void;
  toggleTicker: (ticker: string) => void;
  isDirty: boolean;
  save: () => Promise<void>;
  isSaving: boolean;
  saveError: string;
  saveSuccess: string;
  isLoading: boolean;
  retryTicker: (ticker: string) => Promise<void>;
  repairMode: boolean;
  setRepairMode: (enabled: boolean) => void;
  repairSelection: Set<string>;
  toggleRepairSelection: (ticker: string) => void;
  clearRepairSelection: () => void;
  submitRepairRequests: (requests: RepairTargetRequest[]) => Promise<void>;
  isRepairSubmitting: boolean;
  repairMessage: string;
  repairError: string;
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
  const [repairMode, setRepairMode] = useState(false);
  const [repairSelection, setRepairSelection] = useState<Set<string>>(new Set());
  const [isRepairSubmitting, setIsRepairSubmitting] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");
  const [repairError, setRepairError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const [tickersRes, catalogRes] = await Promise.all([fetchMonitoredTickers(), fetchInstrumentsCatalog()]);
        if (cancelled) return;
        setMonitoredTickers(tickersRes.tickers);
        setInstruments(catalogRes.instruments);

        const manual = new Set(
          tickersRes.tickers
            .filter((s) => s.source === "manual")
            .map((s) => monitoredTickerKey(s.ticker, s.marketCode)),
        );
        setSelectedTickers(manual);
        setSavedTickers(manual);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const updateStatus = useCallback((ticker: string, status: string) => {
    setMonitoredTickers((prev) => prev.map((t) => (t.ticker === ticker ? { ...t, barsBackfillStatus: status } : t)));
    setInstruments((prev) => prev.map((i) => (i.ticker === ticker ? { ...i, barsBackfillStatus: status } : i)));
  }, []);

  const handleBackfillEvent = useCallback(
    (data: unknown) => {
      const event = data as { type: string; ticker: string };
      if (!event.ticker) return;

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
        case "repair_started":
          break;
        case "repair_complete": {
          const now = new Date();
          const nowIso = now.toISOString();
          const optimisticAvailableAt = new Date(now.getTime() + 60 * 60_000).toISOString();
          setMonitoredTickers((prev) =>
            prev.map((t) =>
              t.ticker === event.ticker
                ? { ...t, lastRepairAt: nowIso, repairAvailableAt: optimisticAvailableAt }
                : t,
            ),
          );
          setInstruments((prev) =>
            prev.map((i) =>
              i.ticker === event.ticker
                ? { ...i, lastRepairAt: nowIso, repairAvailableAt: optimisticAvailableAt }
                : i,
            ),
          );
          break;
        }
        case "repair_failed":
          break;
      }
    },
    [updateStatus],
  );

  useEventStream({
    eventTypes: [
      "backfill_started",
      "backfill_complete",
      "backfill_failed",
      "daily_refresh_complete",
      "daily_refresh_failed",
      "repair_started",
      "repair_complete",
      "repair_failed",
    ],
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

  const isDirty = selectedTickers.size !== savedTickers.size || [...selectedTickers].some((t) => !savedTickers.has(t));

  // KZO-169 (D7a): manual selection state is keyed by `(ticker, marketCode)`
  // so the same ticker can be selected in multiple markets.
  const save = useCallback(async () => {
    setIsSaving(true);
    setSaveError("");
    setSaveSuccess("");
    try {
      const payload = [...selectedTickers].map(parseMonitoredTickerKey);
      const result = await saveMonitoredTickers(payload);
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

  const retryTicker = useCallback(
    async (key: string) => {
      const { ticker, marketCode } = parseMonitoredTickerKey(key);
      updateStatus(ticker, "pending");
      try {
        await retryBackfill(ticker, marketCode);
      } catch {
        updateStatus(ticker, "failed");
      }
    },
    [updateStatus],
  );

  const toggleRepairSelection = useCallback((ticker: string) => {
    setRepairSelection((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) {
        next.delete(ticker);
      } else {
        next.add(ticker);
      }
      return next;
    });
  }, []);

  const clearRepairSelection = useCallback(() => setRepairSelection(new Set()), []);

  const submitRepairRequests = useCallback(async (requests: RepairTargetRequest[]) => {
    setIsRepairSubmitting(true);
    setRepairMessage("");
    setRepairError("");

    try {
      const queued = new Set<string>();
      const rejected: string[] = [];

      for (const request of requests) {
        const response = await requestRepair(request);
        response.queued.forEach((ticker) => queued.add(ticker));
        response.rejected.forEach((item) => rejected.push(`${item.ticker}: ${item.reason}`));
      }

      if (!mounted.current) return;

      if (rejected.length > 0 && queued.size > 0) {
        setRepairMessage("partial");
        setRepairError(rejected.join(" | "));
      } else if (rejected.length > 0) {
        setRepairError(rejected.join(" | "));
      } else {
        setRepairMessage("queued");
      }

      setRepairMode(false);
      setRepairSelection(new Set());
    } catch (err) {
      if (!mounted.current) return;
      setRepairError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (mounted.current) setIsRepairSubmitting(false);
    }
  }, []);

  useEffect(() => {
    if (repairMode) return;
    setRepairSelection(new Set());
  }, [repairMode]);

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
    repairMode,
    setRepairMode,
    repairSelection,
    toggleRepairSelection,
    clearRepairSelection,
    submitRepairRequests,
    isRepairSubmitting,
    repairMessage,
    repairError,
  };
}
