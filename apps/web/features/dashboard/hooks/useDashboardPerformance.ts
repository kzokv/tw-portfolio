"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardPerformanceDto, DashboardPerformanceRange, RouteCachePolicyDto } from "@vakwen/shared-types";
import {
  buildRouteDtoCacheTag,
  readRouteDtoCache,
  resolveRouteDtoCacheDurations,
  type RouteDtoCacheStatus,
  writeRouteDtoCache,
} from "../../../lib/routeDtoCache";
import { resolveErrorMessage } from "../../../lib/utils";
import { fetchDashboardPerformanceEnrichment } from "../services/dashboardService";

export const DASHBOARD_PERFORMANCE_REFRESH_TIMEOUT_MS = 90_000;
const DASHBOARD_PERFORMANCE_CACHE_TAGS = [buildRouteDtoCacheTag("route", "dashboard-performance")];

interface UseDashboardPerformanceOptions {
  cacheKey?: string;
  cachePolicy?: RouteCachePolicyDto | null;
  range: DashboardPerformanceRange;
  enabled?: boolean;
  timeoutMessage: string;
}

export function useDashboardPerformance({
  cacheKey,
  cachePolicy,
  range,
  enabled = true,
  timeoutMessage,
}: UseDashboardPerformanceOptions) {
  const cacheDurations = resolveRouteDtoCacheDurations(cachePolicy, "dashboard-performance");
  const initialCachedRef = useRef(cacheKey ? readRouteDtoCache<DashboardPerformanceDto>(cacheKey) : null);
  const [data, setData] = useState<DashboardPerformanceDto | null>(initialCachedRef.current?.payload ?? null);
  const [cacheStatus, setCacheStatus] = useState<RouteDtoCacheStatus | null>(initialCachedRef.current?.status ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [restoredAt, setRestoredAt] = useState<number | null>(initialCachedRef.current?.savedAt ?? null);
  const [restoredFromCache, setRestoredFromCache] = useState(initialCachedRef.current !== null);
  const activeControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeControllerRef.current?.abort();
    if (!enabled) {
      setData(null);
      setErrorMessage("");
      setIsLoading(false);
      activeControllerRef.current = null;
      return;
    }

    const controller = new AbortController();
    activeControllerRef.current = controller;
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, DASHBOARD_PERFORMANCE_REFRESH_TIMEOUT_MS);
    setIsLoading(true);
    try {
      const next = await fetchDashboardPerformanceEnrichment(range, { signal: controller.signal });
      if (activeControllerRef.current === controller) {
        setData(next);
        if (cacheKey) {
          writeRouteDtoCache(cacheKey, next, {
            staleTtlMs: cacheDurations.staleTtlMs,
            tags: DASHBOARD_PERFORMANCE_CACHE_TAGS,
            ttlMs: cacheDurations.ttlMs,
          });
        }
        setCacheStatus("fresh");
        setErrorMessage("");
        setRestoredAt(Date.now());
        setRestoredFromCache(false);
      }
    } catch (error) {
      if (activeControllerRef.current === controller) {
        setErrorMessage(isAbortError(error) ? timeoutMessage : resolveErrorMessage(error));
      }
    } finally {
      clearTimeout(timeoutId);
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [cacheDurations.staleTtlMs, cacheDurations.ttlMs, cacheKey, enabled, range, timeoutMessage]);

  useEffect(() => {
    const cached = cacheKey ? readRouteDtoCache<DashboardPerformanceDto>(cacheKey) : null;
    if (cached) {
      setData(cached.payload);
      setCacheStatus(cached.status);
      setRestoredAt(cached.savedAt);
      setRestoredFromCache(true);
      if (cached.status === "fresh") {
        return () => {
          activeControllerRef.current?.abort();
          activeControllerRef.current = null;
        };
      }
    } else {
      setCacheStatus(null);
      setRestoredAt(null);
      setRestoredFromCache(false);
      if (!enabled) {
        setData(null);
      }
    }
    void refresh();
    return () => {
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
    };
  }, [cacheKey, enabled, refresh]);

  return {
    cacheStatus,
    data,
    isLoading,
    errorMessage,
    refresh,
    restoredAt,
    restoredFromCache,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}
