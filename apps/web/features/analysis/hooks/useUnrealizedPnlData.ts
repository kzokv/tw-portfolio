"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocaleCode, RouteCachePolicyDto } from "@vakwen/shared-types";
import {
  buildRouteDtoCacheKey,
  buildRouteDtoCacheTag,
  readRouteDtoCache,
  resolveRouteDtoCacheDurations,
  type RouteDtoCacheStatus,
  writeRouteDtoCache,
} from "../../../lib/routeDtoCache";
import { getDictionary } from "../../../lib/i18n";
import { resolveErrorMessage } from "../../../lib/utils";
import { fetchUnrealizedPnlAnalysis } from "../services/unrealizedPnlService";
import type { UnrealizedPnlAnalysisDto, UnrealizedPnlAnalysisRouteState } from "../unrealizedPnlTypes";

const ANALYSIS_REFRESH_TIMEOUT_MS = 90_000;
export function useUnrealizedPnlData({
  cachePolicy,
  cacheScope,
  contextRefreshSignal,
  initialData,
  locale,
  state,
}: {
  cachePolicy?: RouteCachePolicyDto | null;
  cacheScope: string;
  contextRefreshSignal: number;
  initialData: UnrealizedPnlAnalysisDto | null;
  locale: LocaleCode;
  state: UnrealizedPnlAnalysisRouteState;
}) {
  const cacheDurations = resolveRouteDtoCacheDurations(cachePolicy, "analysis-unrealized-pnl");
  const timeoutMessage = getDictionary(locale).analysis.timeoutMessage;
  const cacheKey = useMemo(
    () => buildRouteDtoCacheKey(
      "analysis-unrealized-pnl",
      cacheScope,
      locale,
      state.range,
      state.from,
      state.to,
      state.granularity,
      state.markets.join(","),
      state.accounts.join(","),
      state.tickers.join(","),
      state.selectionMode,
      state.selected.join(","),
      state.lineCount,
      state.holdingsState,
      state.reportingCurrency,
      state.includeProvisional ? "provisional" : "final",
      state.instrumentTypes.join(","),
    ),
    [
      cacheScope,
      locale,
      state.accounts,
      state.from,
      state.granularity,
      state.holdingsState,
      state.includeProvisional,
      state.instrumentTypes,
      state.lineCount,
      state.markets,
      state.range,
      state.reportingCurrency,
      state.selected,
      state.selectionMode,
      state.tickers,
      state.to,
    ],
  );
  const [data, setData] = useState<UnrealizedPnlAnalysisDto | null>(initialData);
  const [isBootstrapping, setIsBootstrapping] = useState(initialData === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [cacheStatus, setCacheStatus] = useState<RouteDtoCacheStatus | null>(null);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async ({ bypassCache = false }: { bypassCache?: boolean } = {}) => {
    requestVersionRef.current += 1;
    const version = requestVersionRef.current;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), ANALYSIS_REFRESH_TIMEOUT_MS);
    setIsRefreshing(true);
    try {
      if (!bypassCache) {
        const cached = readRouteDtoCache<UnrealizedPnlAnalysisDto>(cacheKey);
        if (cached) {
          setData(cached.payload);
          setCacheStatus(cached.status);
        }
      }
      const next = await fetchUnrealizedPnlAnalysis(state, { signal: controller.signal });
      if (version !== requestVersionRef.current) return;
      setData(next);
      writeRouteDtoCache(cacheKey, next, {
        ttlMs: cacheDurations.ttlMs,
        staleTtlMs: cacheDurations.staleTtlMs,
        tags: [buildRouteDtoCacheTag("route", "analysis-unrealized-pnl")],
      });
      setCacheStatus("fresh");
      setErrorMessage("");
    } catch (error) {
      if (version !== requestVersionRef.current) return;
      const isAbortError = error instanceof DOMException && error.name === "AbortError"
        || error instanceof Error && error.name === "AbortError";
      setErrorMessage(isAbortError ? timeoutMessage : resolveErrorMessage(error));
    } finally {
      clearTimeout(timeoutId);
      if (version === requestVersionRef.current) setIsRefreshing(false);
    }
  }, [cacheDurations.staleTtlMs, cacheDurations.ttlMs, cacheKey, state, timeoutMessage]);

  useEffect(() => {
    const cached = readRouteDtoCache<UnrealizedPnlAnalysisDto>(cacheKey);
    if (initialData) {
      setData(initialData);
      writeRouteDtoCache(cacheKey, initialData, {
        ttlMs: cacheDurations.ttlMs,
        staleTtlMs: cacheDurations.staleTtlMs,
        tags: [buildRouteDtoCacheTag("route", "analysis-unrealized-pnl")],
      });
      setCacheStatus("fresh");
      setIsBootstrapping(false);
      return;
    }
    if (cached) {
      setData(cached.payload);
      setCacheStatus(cached.status);
      setIsBootstrapping(false);
      if (cached.status === "stale") {
        void refresh({ bypassCache: true });
      }
      return;
    }
    setData(null);
    setIsBootstrapping(true);
    void refresh({ bypassCache: true }).finally(() => setIsBootstrapping(false));
  }, [cacheDurations.staleTtlMs, cacheDurations.ttlMs, cacheKey, contextRefreshSignal, initialData, refresh]);

  return {
    data,
    cacheStatus,
    errorMessage,
    isBootstrapping,
    isRefreshing,
    refresh,
  };
}
